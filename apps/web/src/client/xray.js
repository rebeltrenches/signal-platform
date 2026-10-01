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

  const FULL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

  /** Copies text to the clipboard (with a fallback for older browsers). */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise((resolve, reject) => {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }

  /** A shortened address that copies the full one when tapped (full address
   *  on hover), followed by a "Solscan ↗" link to its account page. */
  function addressControl(address) {
    const wrap = el('span', 'xray-address-wrap');
    const button = el('button', 'xray-address', short(address));
    button.type = 'button';
    button.title = address;
    button.dataset.address = address;
    button.setAttribute('aria-label', 'Copy address ' + address);
    button.addEventListener('click', () => {
      copyText(address).then(() => {
        button.textContent = 'Copied';
        button.classList.add('xray-address-copied');
        clearTimeout(button.copiedTimer);
        button.copiedTimer = setTimeout(() => {
          button.textContent = short(address);
          button.classList.remove('xray-address-copied');
        }, 1500);
      }).catch(() => {
        button.textContent = "Couldn't copy";
        setTimeout(() => { button.textContent = short(address); }, 1500);
      });
    });
    const solscan = el('a', 'xray-solscan', 'Solscan \u2197');
    solscan.href = 'https://solscan.io/account/' + encodeURIComponent(address);
    solscan.target = '_blank';
    solscan.rel = 'noopener noreferrer';
    solscan.setAttribute('aria-label', 'View ' + address + ' on Solscan');
    wrap.append(button, ' ', solscan);
    return wrap;
  }

  /** A line's value, with each of its shortened addresses made usable. */
  function valueWithAddresses(value, addresses) {
    const span = el('span', 'xray-value');
    const usable = (addresses || []).filter((address) => typeof address === 'string' && FULL_ADDRESS.test(address));
    let rest = String(value);
    while (rest) {
      let next = null;
      for (const address of usable) {
        const index = rest.indexOf(short(address));
        if (index >= 0 && (!next || index < next.index)) next = { index, address };
      }
      if (!next) {
        span.append(rest);
        break;
      }
      if (next.index > 0) span.append(rest.slice(0, next.index));
      span.append(addressControl(next.address));
      rest = rest.slice(next.index + short(next.address).length);
    }
    return span;
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
        line.append(el('span', 'xray-label', entry.label + ': '), valueWithAddresses(entry.value, entry.addresses));
        body.append(line);
        if (entry.reason) body.append(el('p', 'xray-reason', entry.reason));
        body.append(el('p', 'xray-why', entry.why));
        row.append(marker, body);
        list.append(row);
      }
      block.append(list);
      // Largest holders: percentage, short address and label on each row;
      // rows without an address or percentage are left out, and the list
      // isn't shown at all when none are complete.
      const holderRows = section.id === 'holders' && Array.isArray(data.holders)
        ? data.holders.filter((holder) => holder && typeof holder.owner === 'string' && holder.owner && typeof holder.percent === 'number' && isFinite(holder.percent))
        : [];
      if (holderRows.length) {
        const details = el('details', 'xray-holders');
        details.append(el('summary', '', 'Largest holders'));
        const holders = el('ol', 'xray-holder-list');
        for (const holder of holderRows) {
          const row = el('li', 'xray-holder' + (holder.excluded ? ' xray-holder-excluded' : ''));
          row.append(
            el('span', 'xray-holder-percent', holder.percent.toFixed(2) + '%'),
            FULL_ADDRESS.test(holder.owner) ? addressControl(holder.owner) : el('span', 'xray-holder-address', short(holder.owner)),
          );
          if (holder.label || holder.excluded) {
            row.append(el('span', 'xray-holder-label', (holder.label || 'pool') + (holder.excluded ? ' · not counted' : '')));
          }
          holders.append(row);
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
