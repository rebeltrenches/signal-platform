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
  const requests = new WeakMap();

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
    const title = el('h3', 'xray-title', data.kind === 'wallet' ? 'Wallet ' + short(data.address) : data.kind === 'account' ? 'Account ' + short(data.address) : data.name ? data.name + (data.symbol ? ' (' + data.symbol + ')' : '') : 'Token ' + short(data.mint));
    const mint = el('p', 'xray-mint', data.address || data.mint);
    header.append(title, mint);
    if (data.address && FULL_ADDRESS.test(data.address)) header.append(addressControl(data.address));
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
        if (entry.signature) body.append(transactionLink(entry.signature));
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
            const label = valueWithAddresses((holder.label || 'pool') + (holder.excluded ? ' · not counted' : ''), holder.labelAddress ? [holder.labelAddress] : []);
            label.className = 'xray-holder-label';
            row.append(label);
          }
          holders.append(row);
        }
        details.append(holders);
        block.append(details);
      }
      root.append(block);
    }
    if (data.kind === 'wallet') renderWallet(root, data, container);
    const checked = data.generatedAt ? new Date(data.generatedAt).toLocaleString() : '';
    root.append(el('p', 'xray-note', 'Facts, not a verdict. Checked ' + checked + '; conditions can change at any time.'));
    const report = el('a', 'xray-solscan', 'Report an error');
    report.href = '/support';
    root.append(report);
    container.replaceChildren(root);
  }

  function transactionLink(signature) {
    const link = el('a', 'xray-solscan', 'Transaction ↗');
    link.href = 'https://solscan.io/tx/' + encodeURIComponent(signature);
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    return link;
  }

  function renderWallet(root, data, container) {
    const holdings = el('section', 'xray-section');
    holdings.append(el('h4', 'xray-section-title', 'Token holdings'));
    if (!data.tokens?.length) holdings.append(el('p', 'xray-note', data.tokenDataComplete ? 'No non-zero token balances returned.' : 'Token balances are incomplete or unavailable.'));
    for (const token of data.tokens || []) {
      const row = el('div', 'xray-wallet-row');
      row.append(el('strong', '', token.name || token.symbol || 'Token'), addressControl(token.mint));
      row.append(el('span', '', token.amount + (token.symbol ? ' ' + token.symbol : '') + (token.frozenAccounts ? ' · frozen accounts present' : '')));
      row.append(el('span', 'xray-note', token.usdValue === null ? 'Price unavailable' : '≈ $' + Number(token.usdValue).toFixed(2)));
      const scan = el('button', 'btn btn-ghost', 'X-Ray coin');
      scan.type = 'button'; scan.addEventListener('click', () => load(container, token.mint));
      row.append(scan); holdings.append(row);
    }
    root.append(holdings);

    const map = el('section', 'xray-section xray-wallet-map');
    map.append(el('h4', 'xray-section-title', 'Transfer bubble map'));
    map.append(el('p', 'xray-note', 'Links show successful SOL transfers in the checked sample. They do not establish shared ownership. Token transfers and older history are not mapped.'));
    const connections = data.connections || [];
    if (!connections.length) map.append(el('p', 'xray-note', data.history?.available ? 'No explicit SOL transfers found in the readable sample.' : 'Transfer data unavailable.'));
    else {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 600 400'); svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'SOL transfers involving this wallet. Evidence and amounts are listed below.');
      function shape(tag, attrs, label) {
        const node = document.createElementNS(ns, tag);
        for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
        if (label) { const title = document.createElementNS(ns, 'title'); title.textContent = label; node.append(title); }
        svg.append(node); return node;
      }
      const shown = connections.slice(0, 16);
      for (let i = 0; i < shown.length; i++) {
        const peer = shown[i], angle = i * Math.PI * 2 / shown.length;
        const x = 300 + Math.cos(angle) * 225, y = 200 + Math.sin(angle) * 145;
        shape('line', { x1: 300, y1: 200, x2: x, y2: y, class: 'xray-map-edge' });
        const radius = 15 + Math.min(15, Math.log2(1 + peer.signatures.length) * 4);
        shape('circle', { cx: x, cy: y, r: radius, class: 'xray-map-peer' }, peer.address + ': sent ' + peer.sentSol + ' SOL; received ' + peer.receivedSol + ' SOL');
        const text = shape('text', { x, y: y + radius + 16, 'text-anchor': 'middle', class: 'xray-map-label' }); text.textContent = short(peer.address);
      }
      shape('circle', { cx: 300, cy: 200, r: 34, class: 'xray-map-center' }, data.address);
      const center = shape('text', { x: 300, y: 204, 'text-anchor': 'middle', class: 'xray-map-label' }); center.textContent = 'Wallet';
      map.append(svg);
      if (connections.length > shown.length) map.append(el('p', 'xray-note', 'Map shows the first 16 connections; all observed connections are listed below.'));
      for (const peer of connections) {
        const details = el('details', 'xray-wallet-row');
        details.append(el('summary', '', short(peer.address) + ' · sent ' + peer.sentSol + ' SOL · received ' + peer.receivedSol + ' SOL'));
        details.append(addressControl(peer.address));
        const scan = el('button', 'btn btn-ghost', 'X-Ray wallet');
        scan.type = 'button'; scan.addEventListener('click', () => load(container, peer.address, true));
        details.append(scan);
        for (const transfer of peer.transfers || []) {
          const evidence = el('p', 'xray-note', (transfer.source === data.address ? 'Sent ' : 'Received ') + transfer.amount + ' SOL · ');
          evidence.append(transactionLink(transfer.signature)); details.append(evidence);
        }
        map.append(details);
      }
    }
    root.append(map);
    const history = el('section', 'xray-section');
    history.append(el('h4', 'xray-section-title', 'Recent transaction history'));
    history.append(el('p', 'xray-note', 'SOL change includes any network fee paid by this wallet. Balance changes may include swaps, rent or account closures; they are not profit or loss.'));
    if (!data.transactions?.length) history.append(el('p', 'xray-note', data.history?.available ? 'No readable transactions returned.' : 'History unavailable.'));
    for (const tx of data.transactions || []) {
      const row = el('details', 'xray-wallet-row');
      const time = tx.blockTime ? new Date(tx.blockTime * 1000).toLocaleString() : 'Time unavailable';
      row.append(el('summary', '', time + ' · ' + tx.status + ' · SOL change ' + (tx.solChange ?? 'Unavailable')));
      row.append(transactionLink(tx.signature));
      row.append(el('p', 'xray-note', tx.feePaidByWallet ? 'Fee paid by this wallet: ' + (tx.feeSol ?? 'Unavailable') + ' SOL' : 'Network fee paid by another account.'));
      for (const change of tx.tokenChanges || []) {
        const line = el('p', 'xray-note', 'Token change ' + change.amount + ' · ');
        line.append(addressControl(change.mint)); row.append(line);
      }
      history.append(row);
    }
    const explorer = el('a', 'xray-solscan', 'View more history on Solscan ↗');
    explorer.href = 'https://solscan.io/account/' + encodeURIComponent(data.address) + '#transfers';
    explorer.target = '_blank'; explorer.rel = 'noopener noreferrer'; history.append(explorer);
    root.append(history);
  }

  async function load(container, mint, addressMode = false) {
    const requestId = {};
    requests.set(container, requestId);
    status(container, 'X-Raying ' + short(mint) + '…');
    container.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('/api/xray?' + (addressMode ? 'address=' : 'mint=') + encodeURIComponent(mint), { signal: AbortSignal.timeout(90_000) });
      const body = await response.json().catch(() => ({}));
      if (requests.get(container) !== requestId) return;
      if (response.ok && body.sections) render(container, body);
      else if (response.status === 404) status(container, "That address isn't a Solana token mint.", 'error');
      else if (response.status === 429) status(container, 'Too many X-Rays; try again in a minute.', 'error');
      else if (response.status === 400) status(container, addressMode ? 'Enter a Solana coin or wallet address.' : 'Enter a Solana token mint address.', 'error');
      else status(container, 'Solana data is unavailable right now; please try again shortly.', 'error');
    } catch {
      if (requests.get(container) !== requestId) return;
      status(container, "Couldn't reach Signal; please try again shortly.", 'error');
    } finally {
      if (requests.get(container) === requestId) container.removeAttribute('aria-busy');
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
        requests.set(results, {});
        results.removeAttribute('aria-busy');
        status(results, 'Enter a Solana coin or wallet address (32–44 letters and numbers).', 'error');
        return;
      }
      load(results, mint, true);
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

