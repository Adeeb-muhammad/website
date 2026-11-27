// Browser-independent helpers for the Utility Desk converters. The DOM code in
// tools.js calls these so the rules can be covered by Node's test runner.

const XML_NAME = /^[A-Za-z_][\w.:-]*$/;
const escapeXML = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const elementName = key => XML_NAME.test(key) && !key.startsWith('@') ? key : 'item';

function xmlNode(value, name) {
  if (Array.isArray(value)) return value.map(item => xmlNode(item, name)).join('');
  if (value && typeof value === 'object') {
    // XML -> JSON writes attributes as "@name" keys, so JSON -> XML turns them
    // back into attributes on the parent element instead of losing them.
    const attributes = Object.entries(value)
      .filter(([key, item]) => key.startsWith('@') && item !== null && typeof item !== 'object' && XML_NAME.test(key.slice(1)))
      .map(([key, item]) => ` ${key.slice(1)}="${escapeXML(item)}"`).join('');
    const children = Object.entries(value)
      .filter(([key]) => !key.startsWith('@'))
      .map(([key, item]) => Array.isArray(item)
        ? item.map(entry => xmlNode(entry, elementName(key))).join('')
        : xmlNode(item, elementName(key)))
      .join('');
    return `<${name}${attributes}>${children}</${name}>`;
  }
  return `<${name}>${escapeXML(value == null ? '' : value)}</${name}>`;
}

// A JSON object becomes one XML element per key. An array repeats its key so
// every item keeps its own element; the previous version concatenated primitive
// items, turning ["a", "b"] into "ab".
export function jsonToXML(value, root = 'root') {
  return xmlNode(value, elementName(root));
}

// Base64 copied from email or a document is usually wrapped at 76 characters.
// atob rejects every line break, so strip whitespace first and explain the
// remaining failures instead of surfacing the DOMException message.
export function decodeBase64(value) {
  const clean = String(value ?? '').replace(/\s+/g, '');
  if (!clean) throw new Error('Enter Base64 text to decode.');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error('This is not valid Base64. Line breaks are ignored; other characters are not supported.');
  let binary;
  try { binary = atob(clean); } catch { throw new Error('This Base64 text is incomplete or malformed.'); }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0))); }
  catch { throw new Error('This Base64 text does not decode to UTF-8 text.'); }
}
