// Wallet Intelligence page: tab switching plus evidence-backed indexed data.
(function () {
  const tabs = document.querySelectorAll('#wallet-tabs [role="tab"]');
  if (tabs.length === 0) return;

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.setAttribute('aria-selected', 'false'));
      tab.setAttribute('aria-selected', 'true');
      const target = tab.getAttribute('data-tab');
      document.querySelectorAll('#wallet-panels [data-panel]').forEach((panel) => {
        panel.hidden = panel.getAttribute('data-panel') !== target;
      });
    });
  });

  function apiPath(path) {
    const base = window.SIGNAL_API_BASE_URL;
    return base ? `${base.replace(/\/$/, '')}${path}` : path;
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function currentWallet() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    // Static preview is /wallet/example; future dynamic routes are
    // /wallet/:chain/:address. Keep the current preview honest by
    // defaulting only the missing chain, never the address.
    if (parts[0] !== 'wallet') return null;
    return parts.length >= 3
      ? { chain: parts[1], address: parts[2] }
      : { chain: 'solana', address: parts[1] };
  }
  function rows(items) {
    return '<div class="card">' + items.join('') + '</div>';
  }
  function reviewRow(label, value) {
    return `<div class="review-row"><span class="k">${escapeHtml(label)}</span><span class="v">${value}</span></div>`;
  }

  const identity = currentWallet();
  if (!identity?.address) return;

  // Preserve the already-working registered-token path as a fallback
  // for local/in-memory API runs where Wallet Intelligence intentionally
  // returns 404 rather than inventing a wallet record.
  (async function loadCreatedTokensFallback() {
    let tokens;
    try {
      const res = await fetch(apiPath(`/api/v1/tokens/mine?creatorWalletAddress=${encodeURIComponent(identity.address)}`));
      if (!res.ok) return;
      tokens = (await res.json()).tokens;
    } catch { return; }
    if (!tokens?.length) return;
    renderCreatedTokens(tokens);
  })();

  function renderCreatedTokens(tokens) {
    const listEl = document.getElementById('wallet-created-tokens-list');
    const emptyEl = document.getElementById('wallet-created-tokens-empty');
    if (listEl && emptyEl) {
      emptyEl.hidden = true;
      listEl.innerHTML = rows(tokens.map((t) => reviewRow(
        `${t.name} (${t.symbol})`,
        `<span style="font-family:monospace;font-size:.75rem">${escapeHtml(t.chain)}</span>`
      )));
    }
    const countRow = document.getElementById('wallet-tokens-launched-row');
    const unavailable = countRow?.querySelector('.data-unavailable');
    if (unavailable) unavailable.outerHTML = escapeHtml(String(tokens.length));
  }

  function renderIntelligence(wallet) {
    const status = document.getElementById('wallet-intelligence-status');
    if (status) status.textContent = `Indexed evidence · ${wallet.chain}`;

    const title = document.querySelector('.page-head h1');
    if (title) title.textContent = wallet.address;

    if (wallet.holdings?.length) {
      const list = document.getElementById('wallet-holdings-list');
      const empty = document.getElementById('wallet-holdings-empty');
      if (empty) empty.hidden = true;
      if (list) list.innerHTML = rows(wallet.holdings.map((h) => reviewRow(
        `${h.token.name} (${h.token.symbol})`,
        `<span style="font-family:monospace">${escapeHtml(h.balance)}</span>`
      )));
    }

    if (wallet.activities?.length) {
      const list = document.getElementById('wallet-activity-list');
      const empty = document.getElementById('wallet-activity-empty');
      if (empty) empty.hidden = true;
      if (list) list.innerHTML = rows(wallet.activities.map((a) => reviewRow(
        a.kind,
        escapeHtml(new Date(a.occurredAt).toLocaleString())
      )));
    }

    if (wallet.createdTokens?.length) renderCreatedTokens(wallet.createdTokens);

    if (wallet.firstObservedActivity) {
      const row = document.getElementById('wallet-first-observed-row');
      const unavailable = row?.querySelector('.data-unavailable');
      if (unavailable) unavailable.outerHTML = escapeHtml(new Date(wallet.firstObservedActivity).toLocaleString());
    }

    if (wallet.relationships?.length) {
      const list = document.getElementById('wallet-relationships-list');
      const empty = document.getElementById('wallet-relationships-empty');
      if (empty) empty.hidden = true;
      if (list) list.innerHTML = wallet.relationships.map((r) => `
        <div class="card" style="margin-bottom:10px">
          ${reviewRow('Relationship', escapeHtml(r.relationshipType))}
          ${reviewRow('Related wallet', `<span style="font-family:monospace;font-size:.75rem">${escapeHtml(r.relatedWallet.address)}</span>`)}
          ${reviewRow('Direction', escapeHtml(r.direction))}
          ${reviewRow('Evidence', escapeHtml(r.evidenceDescription))}
          ${reviewRow('Evidence source', escapeHtml(r.evidenceSource))}
          ${reviewRow('Evidence strength', escapeHtml(r.confidenceLevel))}
          ${r.observedTxSignature ? reviewRow('Transaction', `<span style="font-family:monospace;font-size:.72rem">${escapeHtml(r.observedTxSignature)}</span>`) : ''}
        </div>`).join('');
    }
  }


  function renderBubbleMap(trace) {
    const host = document.getElementById('wallet-bubble-map');
    const empty = document.getElementById('wallet-bubble-map-empty');
    if (!host || !trace?.nodes?.length) return;
    if (empty) empty.hidden = true;

    const sourceNodes = trace.nodes.filter((n) => n.role !== 'ROOT');
    const positions = new Map();
    trace.nodes.forEach((node) => {
      if (node.role === 'ROOT') {
        positions.set(node.address, { x: 50, y: 50 });
        return;
      }
      const index = sourceNodes.findIndex((n) => n.address === node.address);
      const radius = Math.min(38, 17 + (Math.max(1, node.depth) - 1) * 10);
      const angle = ((index / Math.max(1, sourceNodes.length)) * Math.PI * 2) - Math.PI / 2;
      positions.set(node.address, { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius });
    });

    const lines = trace.edges.map((edge) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) return '';
      return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" vector-effect="non-scaling-stroke" style="stroke:currentColor;opacity:.22;stroke-width:1.25" />`;
    }).join('');

    const bubbles = trace.nodes.map((node) => {
      const p = positions.get(node.address);
      const size = node.role === 'ROOT' ? 88 : 72;
      const label = node.address.length <= 12 ? node.address : `${node.address.slice(0, 6)}…${node.address.slice(-4)}`;
      const roleLabel = node.role === 'ROOT' ? 'Root wallet' : `Funding source · depth ${node.depth}`;
      return `<button type="button" class="btn btn-ghost" aria-pressed="false" data-wallet-address="${escapeHtml(node.address)}" title="${escapeHtml(node.address)}" style="position:absolute;left:${p.x}%;top:${p.y}%;transform:translate(-50%,-50%);width:${size}px;height:${size}px;border-radius:50%;padding:6px;font-family:monospace;font-size:.68rem;z-index:1"><span style="display:block;font-family:inherit;font-size:.58rem;opacity:.7;margin-bottom:2px">${escapeHtml(roleLabel)}</span>${escapeHtml(label)}</button>`;
    }).join('');

    host.insertAdjacentHTML('afterbegin', `
      <div class="card">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;margin-bottom:12px">
          <div><h3 style="margin:0;font:var(--text-h2);font-size:1rem">Signal Bubble Map</h3><p style="margin:5px 0 0;font-size:.82rem;opacity:.72">Observed funding relationships · ${escapeHtml(trace.chain)}</p></div>
          <span class="badge">${trace.nodes.length} wallets</span>
        </div>
        <div style="position:relative;min-height:360px;overflow:hidden;border:1px solid var(--border);border-radius:16px">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%">${lines}</svg>
          ${bubbles}
        </div>
        <div class="how-box" style="margin-top:12px">Each line represents an observed blockchain transaction path. Bubble size does not represent holdings yet.${trace.truncated ? ' This trace was truncated at its evidence limit.' : ''}</div>
      </div>`);

    host.querySelectorAll('[data-wallet-address]').forEach((bubble) => {
      bubble.addEventListener('click', () => {
        const address = bubble.getAttribute('data-wallet-address');
        if (!address) return;

        host.querySelectorAll('[data-wallet-address]').forEach((node) => {
          const selected = node.getAttribute('data-wallet-address') === address;
          node.setAttribute('aria-pressed', selected ? 'true' : 'false');
          node.style.outline = selected ? '2px solid var(--brand)' : '';
          node.style.outlineOffset = selected ? '3px' : '';
          node.style.transform = selected ? 'translate(-50%,-50%) scale(1.08)' : 'translate(-50%,-50%)';
        });

        const evidence = trace.edges.filter((edge) => edge.from === address || edge.to === address);
        const existing = document.getElementById('wallet-bubble-evidence');
        if (existing) existing.remove();

        const details = document.createElement('div');
        details.id = 'wallet-bubble-evidence';
        details.className = 'card';
        details.style.marginTop = '12px';
        details.innerHTML = `
          <h3 style="margin-top:0;font:var(--text-h2);font-size:1rem">Wallet evidence</h3>
          ${reviewRow('Wallet', `<span style="font-family:monospace;font-size:.75rem">${escapeHtml(address)}</span>`)}
          ${evidence.length ? evidence.map((edge) => [
            reviewRow('Relationship', 'funded'),
            reviewRow('Evidence source', escapeHtml(edge.evidenceSource)),
            reviewRow('Transaction', `<span style="font-family:monospace;font-size:.72rem">${escapeHtml(edge.observedTxSignature)}</span>`)
          ].join('')).join('') : reviewRow('Evidence', 'Root wallet for this trace')}
          ${address !== trace.root ? `<div style="margin-top:12px"><a class="btn btn-ghost" href="/wallet/${encodeURIComponent(trace.chain.toLowerCase())}/${encodeURIComponent(address)}">Open wallet intelligence</a></div>` : ''}
          <div class="how-box" style="margin-top:12px">Observed transaction evidence only. This does not claim common ownership or identity.</div>
        `;
        host.appendChild(details);
      });
    });
  }

  function renderHistoryReplay(replay) {
    const host = document.getElementById('wallet-history-replay');
    const empty = document.getElementById('wallet-history-replay-empty');
    if (!host || !replay?.events?.length) return;
    if (empty) empty.hidden = true;

    const events = replay.events.map((event, index) => {
      const from = event.from.length <= 16 ? event.from : `${event.from.slice(0, 7)}…${event.from.slice(-5)}`;
      const to = event.to.length <= 16 ? event.to : `${event.to.slice(0, 7)}…${event.to.slice(-5)}`;
      return `
        <div class="card" data-replay-step="${index + 1}" style="margin-bottom:10px">
          <button type="button" class="btn btn-ghost" data-replay-toggle="${index + 1}" aria-expanded="false" style="width:100%;justify-content:space-between;text-align:left;padding:8px 10px">
            <span style="display:flex;align-items:center;gap:10px"><span class="badge">Step ${index + 1}</span><strong style="font-size:.88rem">Funding evidence · depth ${escapeHtml(event.depth)}</strong></span>
            <span aria-hidden="true">+</span>
          </button>
          <div data-replay-details="${index + 1}" hidden style="margin-top:10px">
            ${reviewRow('From', `<span style="font-family:monospace;font-size:.75rem">${escapeHtml(from)}</span>`)}
            ${reviewRow('To', `<span style="font-family:monospace;font-size:.75rem">${escapeHtml(to)}</span>`)}
            ${reviewRow('Relationship', escapeHtml(event.relationshipType))}
            ${reviewRow('Evidence source', escapeHtml(event.evidenceSource))}
            ${reviewRow('Transaction', `<span style="font-family:monospace;font-size:.72rem">${escapeHtml(event.observedTxSignature)}</span>`)}
          </div>
        </div>`;
    }).join('');

    host.insertAdjacentHTML('afterbegin', `
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;margin-bottom:12px">
        <div><h3 style="margin:0;font:var(--text-h2);font-size:1rem">Wallet History Replay</h3><p style="margin:5px 0 0;font-size:.82rem;opacity:.72">Evidence trace · ${escapeHtml(replay.chain)}</p></div>
        <span class="badge">${replay.events.length} evidence steps</span>
      </div>
      ${events}
      <div class="how-box" style="margin-top:12px">These steps replay the current evidence trace, not verified transaction time. Every step retains its blockchain evidence and transaction signature.${replay.truncated ? ' This replay was truncated at its evidence limit.' : ''}</div>
    `);

    host.querySelectorAll('[data-replay-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const step = button.getAttribute('data-replay-toggle');
        const details = host.querySelector(`[data-replay-details="${step}"]`);
        if (!details) return;
        const expanded = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        details.hidden = expanded;
        const marker = button.querySelector('[aria-hidden="true"]');
        if (marker) marker.textContent = expanded ? '+' : '−';
      });
    });
  }

  (async function loadHistoryReplay() {
    try {
      const res = await fetch(apiPath(`/api/v1/wallets/${encodeURIComponent(identity.chain)}/${encodeURIComponent(identity.address)}/history-replay?depth=3`));
      if (!res.ok) return;
      const body = await res.json();
      if (body.replay) renderHistoryReplay(body.replay);
    } catch {
      // Keep the honest empty state when replay evidence is unavailable.
    }
  })();

  (async function loadSignalTrace() {
    try {
      const res = await fetch(apiPath(`/api/v1/wallets/${encodeURIComponent(identity.chain)}/${encodeURIComponent(identity.address)}/signal-trace?depth=3`));
      if (!res.ok) return;
      const body = await res.json();
      if (body.trace) renderBubbleMap(body.trace);
    } catch {
      // Keep the honest empty state when trace evidence is unavailable.
    }
  })();

  (async function loadWalletIntelligence() {
    try {
      const res = await fetch(apiPath(`/api/v1/wallets/${encodeURIComponent(identity.chain)}/${encodeURIComponent(identity.address)}`));
      if (res.status === 404) {
        const status = document.getElementById('wallet-intelligence-status');
        if (status) status.textContent = 'No indexed Wallet Intelligence available';
        return;
      }
      if (!res.ok) return;
      const body = await res.json();
      if (body.wallet) renderIntelligence(body.wallet);
    } catch {
      // Keep the server-rendered unavailable/empty states. Never turn
      // network failure into guessed wallet facts.
    }
  })();
})();
