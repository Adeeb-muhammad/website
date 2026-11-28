import test from 'node:test';
import assert from 'node:assert/strict';
import { initNotebook } from '../assets/js/notebook.js';

const KEY = 'adeeb-vault-notebook-v2';
// The notebook waits this long before writing, which is the window another tab
// can write into.
const SAVE_DELAY = 400;
const SETTLE = SAVE_DELAY + 150;

// Minimal browser surface for initNotebook. The point of these tests is the
// storage-event/timer interaction, so everything else is a deliberately inert
// element or canvas.
class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { for (const name of names) this.values.add(name); }
  remove(...names) { for (const name of names) this.values.delete(name); }
  toggle(name, force) {
    if (force === undefined) force = !this.values.has(name);
    if (force) this.values.add(name); else this.values.delete(name);
    return force;
  }
  contains(name) { return this.values.has(name); }
}

const noopContext = () => new Proxy({}, {
  get: (target, property) => property in target ? target[property] : () => {},
  set: (target, property, value) => { target[property] = value; return true; }
});

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.attributes = new Map();
    this.textContent = '';
    this.innerHTML = '';
    this.value = id === 'notes-color' ? '#1a1a1a' : id === 'notes-width' ? '4' : '';
    this.hidden = false;
    this.disabled = false;
    this.width = 1400;
    this.height = 900;
    this.clientWidth = 1000;
    this.clientHeight = 700;
    this.offsetLeft = 0;
    this.offsetTop = 0;
    this.offsetWidth = 40;
    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.offsetParent = {};
    this.files = [];
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatch(type, extra = {}) {
    const event = { target: this, currentTarget: this, preventDefault() {}, ...extra };
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  querySelector() { return null; }
  closest() { return null; }
  contains() { return false; }
  focus() { document.activeElement = this; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight }; }
  getContext() { return noopContext(); }
  toBlob() {}
}

function notebook(title) {
  return {
    kind: 'adeeb-vault-notebook',
    version: 2,
    title,
    activePage: 0,
    pages: [{
      title: 'Page 1',
      text: '',
      orientation: 'landscape',
      strokes: [{ erase: false, color: '#1a1a1a', width: 4, points: [[10, 10], [20, 20]] }]
    }]
  };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Opens the Notes Canvas against a fake browser whose localStorage starts with
// `stored`. Returns handles for editing, for another tab writing, and for
// reading back the saved value.
function openTab(stored) {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, new FakeElement(selector));
    return elements.get(selector);
  };
  const storage = new Map(stored === undefined ? [] : [[KEY, stored]]);
  const windowListeners = new Map();
  const documentListeners = new Map();
  const fakeDocument = {
    activeElement: null,
    body: new FakeElement('body'),
    fullscreenElement: null,
    hidden: false,
    querySelector: element,
    getElementById: id => element('#' + id),
    createElement: () => new FakeElement('canvas'),
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(listener);
    }
  };
  const fakeWindow = {
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(listener);
    }
  };
  const fakeStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem(key, value) { storage.set(key, String(value)); }
  };
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    location: globalThis.location,
    ResizeObserver: globalThis.ResizeObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame
  };
  globalThis.window = fakeWindow;
  globalThis.document = fakeDocument;
  globalThis.localStorage = fakeStorage;
  globalThis.location = { hash: '#notes' };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.requestAnimationFrame = callback => { callback(16); return 1; };
  globalThis.cancelAnimationFrame = () => {};

  initNotebook({ download() {}, confirmChange: async () => true });

  return {
    click: selector => element(selector).dispatch('click'),
    status: () => element('#notes-status').textContent,
    saved: () => storage.get(KEY),
    // Another tab writing the key, with the storage event the browser delivers.
    async writeFromOtherTab(value) {
      storage.set(KEY, value);
      for (const listener of windowListeners.get('storage') || []) listener({ key: KEY, newValue: value });
    },
    // Another tab writing the key before this tab's storage event arrives.
    writeWithoutEvent(value) { storage.set(KEY, value); },
    close() {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[name];
        else globalThis[name] = value;
      }
    }
  };
}

test('a cross-tab change cancels and pauses a pending notebook save', async t => {
  const tab = openTab(JSON.stringify(notebook('Tab A')));
  t.after(tab.close);

  // Undo leaves Tab A with a save waiting in its timer.
  tab.click('#notes-undo');
  assert.match(tab.status(), /Saving/);

  // Tab B writes a newer notebook before Tab A's timer fires.
  const incoming = JSON.stringify(notebook('Tab B'));
  await tab.writeFromOtherTab(incoming);
  assert.match(tab.status(), /Saving is paused/);

  await wait(SETTLE);
  assert.equal(tab.saved(), incoming, 'Tab A overwrote the newer notebook after warning');

  // A later edit (redo) must not resume autosave and overwrite Tab B either.
  tab.click('#notes-redo');
  await wait(SETTLE);
  assert.equal(tab.saved(), incoming, 'a paused tab scheduled another overwrite');
});

test('a save started before the storage event arrives still leaves the newer notebook alone', async t => {
  const tab = openTab(JSON.stringify(notebook('Tab A')));
  t.after(tab.close);

  // Tab A edits, then Tab B writes before the storage event can reach Tab A.
  tab.click('#notes-undo');
  const incoming = JSON.stringify(notebook('Tab B'));
  tab.writeWithoutEvent(incoming);

  await wait(SETTLE);
  assert.equal(tab.saved(), incoming, 'the queued save replaced the newer notebook');
  assert.match(tab.status(), /Saving is paused/);
});
