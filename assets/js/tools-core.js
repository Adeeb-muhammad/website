// Shared, browser-independent utilities. All document bytes stay on the device.
const encoder = new TextEncoder();
const ascii = value => encoder.encode(value);

export function safeFilename(value, fallback = 'vault-export') {
  return (String(value).trim().replace(/[^a-zA-Z0-9 _.-]/g, '').replace(/^\.+|\.+$/g, '').slice(0, 80) || fallback);
}

export function imagePlacement(width, height, pageWidth, pageHeight, margin = 28) {
  if (![width, height, pageWidth, pageHeight].every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid image dimensions.');
  const scale = Math.min((pageWidth - margin * 2) / width, (pageHeight - margin * 2) / height);
  const w = width * scale, h = height * scale;
  return { x: (pageWidth - w) / 2, y: (pageHeight - h) / 2, width: w, height: h };
}

// Each image is already converted to an opaque RGB JPEG by the browser canvas.
// PDF offsets use byte lengths, so embedded image data never corrupts the xref.
export function createImagePDF(images, { size = 'a4', orientation = 'auto', margin = 28 } = {}) {
  if (!images.length || images.length > 20) throw new Error('Choose between 1 and 20 images.');
  const paper = size === 'letter' ? [612, 792] : [595.28, 841.89];
  const objects = [ascii('<< /Type /Catalog /Pages 2 0 R >>'), null];
  const pageRefs = [];
  const stream = (dict, bytes) => [ascii(`<< ${dict} /Length ${bytes.length} >>\nstream\n`), bytes, ascii('\nendstream')];
  for (const image of images) {
    if (!(image.bytes instanceof Uint8Array) || image.bytes.length < 4 || image.bytes[0] !== 255 || image.bytes[1] !== 216) throw new Error('Invalid JPEG data.');
    const landscape = orientation === 'landscape' || (orientation === 'auto' && image.width > image.height);
    const [pw, ph] = landscape ? [paper[1], paper[0]] : paper;
    const p = imagePlacement(image.width, image.height, pw, ph, margin);
    const pageID = objects.length + 1, imageID = pageID + 1, contentID = pageID + 2;
    pageRefs.push(`${pageID} 0 R`);
    const n = value => value.toFixed(3);
    const commands = ascii(`q\n${n(p.width)} 0 0 ${n(p.height)} ${n(p.x)} ${n(p.y)} cm\n/Photo Do\nQ`);
    objects.push(ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Photo ${imageID} 0 R >> >> /Contents ${contentID} 0 R >>`));
    objects.push(stream(`/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, image.bytes));
    objects.push(stream('', commands));
  }
  objects[1] = ascii(`<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${images.length} >>`);
  const parts = [ascii('%PDF-1.4\n%Vault\n')], offsets = [0];
  let length = parts[0].length;
  const append = part => { parts.push(part); length += part.length; };
  objects.forEach((obj, i) => {
    offsets.push(length);
    append(ascii(`${i + 1} 0 obj\n`));
    for (const part of Array.isArray(obj) ? obj : [obj]) append(part);
    append(ascii('\nendobj\n'));
  });
  const xref = length;
  append(ascii(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

export function analyzeLinks(text) {
  const seen = new Set();
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 50).map(raw => {
    try {
      if (/\s/.test(raw)) throw new Error('Use one URL per line, with no spaces.');
      const explicit = /^[a-z][a-z\d+.-]*:/i.test(raw);
      const url = new URL(explicit ? raw : `https://${raw}`);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS links are supported.');
      if (url.username || url.password) throw new Error('Remove the username or password from this URL.');
      if (!url.hostname || (!url.hostname.includes('.') && url.hostname !== 'localhost' && !url.hostname.includes(':'))) throw new Error('Enter a complete website address.');
      const key = new URL(url.href); key.hash = '';
      const duplicate = seen.has(key.href); seen.add(key.href);
      return { raw, url: url.href, duplicate, state: 'valid', message: duplicate ? 'Duplicate page URL.' : explicit ? 'Valid URL. Availability not checked.' : 'Added https://. Availability not checked.' };
    } catch (error) {
      return { raw, url: '', duplicate: false, state: 'invalid', message: error.message || 'Invalid URL.' };
    }
  });
}

export function classifyHTTP(status) {
  if (status >= 200 && status < 400) return { state: 'available', message: `HTTP ${status} · Responding` };
  if (status === 404 || status === 410) return { state: 'unavailable', message: `HTTP ${status} · Page unavailable` };
  if (status === 401 || status === 403 || status === 429) return { state: 'restricted', message: `HTTP ${status} · Access restricted or rate limited` };
  if (status >= 500) return { state: 'error', message: `HTTP ${status} · Server error` };
  return { state: 'unverified', message: `HTTP ${status} · Could not confirm availability` };
}

export function linksCSV(rows) {
  const cell = value => '"' + String(value).replace(/^[=+@-]/, "'$&").replace(/"/g, '""') + '"';
  return [['URL', 'Result', 'Details', 'Duplicate'], ...rows.map(r => [r.url || r.raw, r.state, r.message, r.duplicate ? 'Yes' : 'No'])].map(r => r.map(cell).join(',')).join('\r\n');
}

export function validateNotebook(data) {
  if (!data || data.kind !== 'adeeb-vault-notebook' || ![1, 2].includes(data.version) || typeof data.title !== 'string' || data.title.length > 120) throw new Error('This is not a supported Vault notebook backup.');
  const pages = data.version === 1 ? [data] : data.pages;
  if (!Array.isArray(pages) || !pages.length || pages.length > 20 || (data.version === 2 && (!Number.isInteger(data.activePage) || data.activePage < 0 || data.activePage >= pages.length))) throw new Error('A notebook must have 1 to 20 pages and a valid selected page.');
  let count = 0;
  let textLength = 0;
  for (const page of pages) {
    if (!page || (data.version === 2 && (typeof page.title !== 'string' || page.title.length > 120)) || typeof page.text !== 'string' || page.text.length > 100000 || !Array.isArray(page.strokes) || page.strokes.length > 1000) throw new Error('The backup contains an invalid page.');
    textLength += page.text.length;
    if (textLength > 200000) throw new Error('The notebook text is too large.');
    let pageCount = 0;
    for (const stroke of page.strokes) {
      if (!stroke || typeof stroke.erase !== 'boolean' || !/^#[0-9a-f]{6}$/i.test(stroke.color) || !Number.isFinite(stroke.width) || stroke.width < 1 || stroke.width > 60 || !Array.isArray(stroke.points) || !stroke.points.length) throw new Error('The backup contains an invalid drawing.');
      count += stroke.points.length;
      pageCount += stroke.points.length;
      if (pageCount > 60000 || count > 120000 || !stroke.points.every(p => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] >= 0 && p[0] <= 1400 && p[1] >= 0 && p[1] <= 900)) throw new Error('The drawing is too large or contains invalid points.');
    }
  }
  return data;
}

export function upgradeNotebook(data) {
  validateNotebook(data);
  if (data.version === 2) return data;
  return { kind: data.kind, version: 2, title: data.title, activePage: 0, pages: [{ title: 'Page 1', text: data.text, strokes: data.strokes }] };
}
