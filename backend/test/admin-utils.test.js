'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function ui() {
  let document;
  class Element {
    constructor() {
      this.listeners = new Map(); this.isConnected = true; this.children = [];
      this.classes = new Set();
      this.classList = { add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c), toggle: (c, on) => on ? this.classes.add(c) : this.classes.delete(c) };
    }
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
    removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
    fire(name, props = {}) { const event = { target: this, preventDefault() {}, ...props }; for (const fn of [...(this.listeners.get(name) || [])]) fn(event); }
    focus() { document.activeElement = this; }
    setAttribute() {}
    getClientRects() { return [1]; }
    contains(el) { return this === el || this.children.includes(el); }
    querySelectorAll() { return this.children; }
    querySelector(selector) { return selector === '.modal-content' ? this : this.children[0]; }
  }
  const ids = {};
  for (const id of ['confirm-modal', 'confirm-modal-title', 'confirm-modal-message', 'confirm-modal-ok-btn', 'confirm-modal-cancel-btn']) ids[id] = new Element();
  ids['confirm-modal'].children = [ids['confirm-modal-ok-btn'], ids['confirm-modal-cancel-btn']];
  document = new Element(); document.getElementById = (id) => ids[id];
  const opener = new Element(); opener.focus();
  const context = { document, window: {}, console, setTimeout, clearTimeout };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/public/js/admin-utils.js'), 'utf8'), context);
  return { ...context, ids, opener, Element };
}

test('HTML escaping neutralizes markup and attribute delimiters without corrupting Arabic', () => {
  const u = ui();
  assert.equal(u.esc('<img src=x onerror="alert(1)"> & \'عربي\''), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;عربي&#39;');
  assert.equal(u.esc(null), '');
});
test('confirmation cleans listeners, restores focus, and Enter on cancel cancels', async () => {
  const u = ui();
  for (let i = 0; i < 3; i++) {
    const p = u.confirmAction({});
    u.ids['confirm-modal-cancel-btn'].focus();
    u.document.fire('keydown', { key: 'Enter' });
    assert.equal(await p, false);
    assert.equal(u.document.activeElement, u.opener);
    assert.equal(u.document.listeners.get('keydown').size, 0);
    assert.equal(u.ids['confirm-modal-ok-btn'].listeners.get('click').size, 0);
  }
});
test('new confirmation resolves displaced promise and traps Tab inside current dialog', async () => {
  const u = ui();
  const first = u.confirmAction({}), second = u.confirmAction({});
  assert.equal(await first, false);
  u.ids['confirm-modal-cancel-btn'].focus();
  u.document.fire('keydown', { key: 'Tab' });
  assert.equal(u.document.activeElement, u.ids['confirm-modal-ok-btn']);
  u.document.fire('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(u.document.activeElement, u.ids['confirm-modal-cancel-btn']);
  u.document.fire('keydown', { key: 'Escape' });
  assert.equal(await second, false);
});
test('Escape in stacked confirmation leaves edit modal open; closing edit removes handlers', async () => {
  const u = ui(), edit = new u.Element(), close = new u.Element();
  edit.children = [close];
  let closed = 0;
  u.openEditModal(edit, { onClose: () => closed++ });
  const p = u.confirmAction({});
  u.document.fire('keydown', { key: 'Escape' });
  assert.equal(await p, false); assert.equal(closed, 0);
  u.document.fire('keydown', { key: 'Escape' });
  assert.equal(closed, 1);
  assert.equal(close.listeners.get('click').size, 0);
  assert.equal(u.document.activeElement, u.opener);
});
