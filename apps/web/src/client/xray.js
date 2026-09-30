// Signal X-Ray: shows /api/xray results for a Solana token, on the front
// page ("X-Ray any token") and in the token page's Signal Check tab, with
// the same renderer so both always match.
//
// Every line is a fact from the server: a marker (✅ / ⚠️), the fact and
// a one-line "why it matters". Unavailable data says "Unavailable". There
// is never an overall verdict. Everything is added with textContent.
(function () {
  const MINT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const MARKERS = { ok: '✅', warn: '⚠️', info: '•', unavailable: '–' };
  const MARKER_TEXT = { ok: 'OK', warn: 'Warning', info: 'Fact', unavailable: 'Unavailable' };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function short(address) {
    return address && address.length > 10 ? address.slice(0, 4) + '…' + address.slice(-4) : address || '';
  }

  function status(container, text, kind) {
    container.replaceChildren(el('p', 'xray-status' + (kind ? ' xray-status-' + kind : ''), text));
  }

  function render(container, data) {
    const root = el('div', 'xray');
    const header = el('div', 'xray-header');
    const title = el('h3', 'xray-title', data.name ? data.name + (data.symbol ? ' (' + data.symbol + ')' : '') : 'Token ' + short(data.mint));
    const mint = el('p', 'xray-mint', data.mint);
    header.append(title, mint);
    root.append(header);

    for (const section of data.sections || []) {
      const block = el('section', 'xray-section');
      block.dataset.section = section.id;
      block.append(el('h4', 'xray-section-title', section.title));
      const list = el('ul', 'xray-list');
      for (const entry of section.items || []) {
        const row = el('li', 'xray-item xray-' + entry.status);
        row.dataset.check = entry.id;
        const marker = el('span', 'xray-marker', MARKERS[entry.status] || '•');
        marker.setAttribute('role', 'img');
        marker.setAttribute('aria-label', MARKER_TEXT[entry.status] || 'Fact');
        const body = el('div', 'xray-body');
        const line = el('p', 'xray-line');
        line.append(el('span', 'xray-label', entry.label + ': '), el('span', 'xray-value', entry.value));
        body.append(line);
        if (entry.reason) body.append(el('p', 'xray-reason', entry.reason));
        body.append(el('p', 'xray-why', entry.why));
        row.append(marker, body);
        list.append(row);
      }
      block.append(list);
      if (section.id === 'holders' && data.holders && data.holders.length) {
        const details = el('details', 'xray-holders');
        details.append(el('summary', '', 'Largest holders'));
        const holders = el('ol', 'xray-holder-list');
        for (const holder of data.holders) {
          const item = el('li', holder.excluded ? 'xray-holder-excluded' : '');
          item.textContent = (holder.percent === null ? '?' : holder.percent + '%') + ' — ' + short(holder.owner) + (holder.label ? ' (' + holder.label + (holder.excluded ? ', not counted' : '') + ')' : '');
          holders.append(item);
        }
        details.append(holders);
        block.append(details);
      }
      root.append(block);
    }
    const checked = data.generatedAt ? new Date(data.generatedAt).toLocaleString() : '';
    root.append(el('p', 'xray-note', 'Facts, not a verdict. Checked ' + checked + '; conditions can change at any time.'));
    container.replaceChildren(root);
  }

  async function load(container, mint) {
    status(container, 'X-Raying ' + short(mint) + '…');
    container.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('/api/xray?mint=' + encodeURIComponent(mint));
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.sections) render(container, body);
      else if (response.status === 404) status(container, "That address isn't a Solana token mint.", 'error');
      else if (response.status === 429) status(container, 'Too many X-Rays; try again in a minute.', 'error');
      else if (response.status === 400) status(container, 'Enter a Solana token mint address.', 'error');
      else status(container, 'Solana data is unavailable right now; please try again shortly.', 'error');
    } catch {
      status(container, "Couldn't reach Signal; please try again shortly.", 'error');
    } finally {
      container.removeAttribute('aria-busy');
    }
  }

  // Front page: "X-Ray any token".
  const form = document.getElementById('xray-form');
  if (form) {
    const input = document.getElementById('xray-mint');
    const results = document.getElementById('xray-results');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const mint = input.value.trim();
      if (!MINT_PATTERN.test(mint)) {
        status(results, 'Enter a Solana token mint address (32–44 letters and numbers).', 'error');
        return;
      }
      load(results, mint);
    });
  }

  // Token page: the Signal Check tab, loaded the first time it's opened.
  const tokenResults = document.getElementById('xray-token-results');
  if (tokenResults) {
    const params = new URLSearchParams(window.location.search);
    const chain = (params.get('chain') || 'solana').toLowerCase();
    const mint = params.get('mint') || window.location.pathname.split('/').filter(Boolean).pop() || '';
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      if (chain !== 'solana') status(tokenResults, 'X-Ray covers Solana tokens for now.');
      else if (!MINT_PATTERN.test(mint)) status(tokenResults, 'Open this tab from a Solana token to X-Ray it.');
      else load(tokenResults, mint);
    };
    const tab = document.querySelector('[data-tab="Signal Check"]');
    if (tab) tab.addEventListener('click', start);
    if (window.location.hash.replace('#', '').toLowerCase() === 'signal check' || window.location.hash === '#signal-check') start();
  }

  window.signalXray = { render, load };
})();
