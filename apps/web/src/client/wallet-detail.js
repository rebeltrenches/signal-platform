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
