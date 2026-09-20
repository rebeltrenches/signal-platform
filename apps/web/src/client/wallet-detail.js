// Wallet detail page tab switching — same real pattern as
// token-detail.js. Every panel already renders its own honest state.
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

  // Real "Created tokens" + Passport "Tokens launched" count — reuses
  // the EXISTING GET /api/v1/tokens/mine endpoint (Stage 2), the same
  // one Dashboard's "Your launches" already relies on. No new backend
  // code. Holdings, Trades, "First observed activity", and Wallet
  // relationships are deliberately untouched — genuinely still blocked
  // on Stage 11/live RPC, not addressed here.
  function apiPath(path) {
    const base = window.SIGNAL_API_BASE_URL;
    return base ? `${base.replace(/\/$/, '')}${path}` : path;
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  (async function loadCreatedTokens() {
    const address = window.location.pathname.split('/').filter(Boolean).pop();
    if (!address) return;

    let tokens;
    try {
      const res = await fetch(apiPath(`/api/v1/tokens/mine?creatorWalletAddress=${encodeURIComponent(address)}`));
      if (!res.ok) return; // leave the honest existing placeholders showing
      tokens = (await res.json()).tokens;
    } catch {
      return; // network/backend unreachable — leave the honest placeholders exactly as they are, never guess
    }
    if (!tokens || tokens.length === 0) return; // genuinely none registered for this wallet — placeholders are correct as-is

    const listEl = document.getElementById('wallet-created-tokens-list');
    const emptyEl = document.getElementById('wallet-created-tokens-empty');
    if (listEl && emptyEl) {
      emptyEl.hidden = true;
      listEl.innerHTML =
        '<div class="card">' +
        tokens
          .map(
            (t) => `
        <div class="review-row">
          <span class="k">${escapeHtml(t.name)} (${escapeHtml(t.symbol)})</span>
          <span class="v" style="font-family:monospace;font-size:0.75rem;">${escapeHtml(t.chain)}</span>
        </div>`
          )
          .join('') +
        '</div>';
    }

    const countRow = document.getElementById('wallet-tokens-launched-row');
    if (countRow) {
      // Replaces this ONE SourcedRow's rendered "Unavailable" state
      // with a real value — not touching the shared SourcedRow
      // component itself, which other pages also use.
      const unavailableSpan = countRow.querySelector('.data-unavailable');
      if (unavailableSpan) unavailableSpan.outerHTML = escapeHtml(String(tokens.length));
    }
  })();
})();
