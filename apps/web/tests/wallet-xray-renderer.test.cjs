const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.value = ''; this.classList = { add() {}, remove() {} }; }
  set textContent(v) { this.text = String(v); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(n => typeof n === 'string' ? n : n.textContent).join(''); }
  append(...n) { this.children.push(...n); }
  prepend(...n) { this.children.unshift(...n); }
  replaceChildren(...n) { this.text = ''; this.children = n; }
  setAttribute(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(k, fn) { this.listeners[k] = fn; }
  contains(n) { return this === n || this.children.some(c => typeof c !== 'string' && c.contains(n)); }
  get dataset() { return this.data ||= {}; }
}
const container = new Node('div');
let copied, requested;
const document = { createElement: t => new Node(t), createElementNS: (_, t) => new Node(t), getElementById: () => null, querySelector: () => null };
const window = { isSecureContext: true };
vm.runInNewContext(fs.readFileSync('apps/web/src/client/xray.js', 'utf8'), { document, window, navigator: { clipboard: { writeText: async v => { copied = v; } } }, setTimeout: () => 0, clearTimeout() {}, AbortSignal, fetch: async url => { requested = url; return { ok: true, json: async () => older }; } });
const wallet = '11111111111111111111111111111111', peer = 'So11111111111111111111111111111111111111112';
const data = { kind: 'wallet', address: wallet, sections: [], tokens: [
  { mint: wallet, name: 'Exactly ten', amount: '1', usdValue: 10 },
  { mint: peer, name: 'Small holding', amount: '1', usdValue: 9.99 },
  { mint: peer, name: 'Unknown price', amount: '1000000', usdValue: null }
], transactions: [{ signature: 'new', blockTime: 1700000000, status: 'confirmed' }], connections: [{ address: peer, sentSol: '1', receivedSol: '2', signatures: ['new'], transfers: [] }], history: { loaded: 1, listed: 1, available: true, nextCursor: 'a'.repeat(88), hasMore: true } };
const older = { ...data, tokens: [], transactions: [{ signature: 'old', blockTime: 1600000000, status: 'confirmed' }], connections: [{ address: peer, sentSol: '3', receivedSol: '4', signatures: ['old'], transfers: [] }], history: { loaded: 1, listed: 1, available: true, nextCursor: null } };
function all(node = container) { return [node, ...node.children.filter(n => typeof n !== 'string').flatMap(all)]; }
function byClass(cls) { return all().find(n => (n.className || n.attrs.class || '').split(' ').includes(cls)); }
(async () => {
  window.signalXray.render(container, data);
  assert.match(byClass('xray-holdings-main').textContent, /Exactly ten/);
  const groups = all().filter(n => n.className === 'xray-holdings-group');
  assert.match(groups[0].textContent, /Holdings under \$10 \(1\).*Small holding/);
  assert.match(groups[1].textContent, /Price unavailable \(1\).*Unknown price/);
  assert.ok(!groups[0].textContent.includes('Unknown price'));
  assert.equal(groups[0].attrs.open, undefined);
  const search = byClass('xray-holdings-search'); search.value = 'small'; search.listeners.input();
  assert.ok(!byClass('xray-holdings-list').textContent.includes('Exactly ten'));
  search.value = ''; search.listeners.input();
  const bubble = byClass('xray-map-peer'); assert.equal(bubble.attrs.tabindex, '0');
  bubble.listeners.keydown({ key: 'Enter', preventDefault() {} });
  const panel = byClass('xray-map-panel'); assert.ok(panel.textContent.includes(peer));
  panel.children.find(n => n.className === 'xray-address-wrap').children[0].listeners.click();
  await Promise.resolve(); assert.equal(copied, peer);
  const more = all().find(n => n.tag === 'button' && n.textContent === 'Load more history');
  await more.listeners.click(); assert.ok(requested.includes('&before='));
  assert.match(byClass('xray-wallet-map').textContent, /sent 4 SOL · received 6 SOL/);
  assert.equal(all().filter(n => n.tag === 'button' && n.textContent === 'Load more history').length, 0);
  assert.match(container.textContent, /2 readable transactions from 2 checked/);
  console.log('Wallet renderer checks passed: $10 boundary, unknown-price grouping, collapsed sections, search, keyboard bubbles, copying and paginated history aggregation.');
})().catch(e => { console.error(e); process.exitCode = 1; });
