// Renders "Your launches" from the SAME localStorage key launch-solana.js
// writes to, only after a real launch actually confirms. This file only
// reads and displays — it never writes an entry itself, so there's no
// path for a fake launch to appear here.
//
// "Collect Fees" is shown ONLY when the CONNECTED wallet matches the
// token creator (window.SIGNAL_PLATFORM_WALLET, injected at
// build time) — not when it matches the token's creator. Under the
// current fee model, 100% of the Signal Fee goes to the platform
// wallet, so only its own holder can ever actually collect anything;
// showing this button to an ordinary creator (who will never be able
// to successfully sign the real withdrawal, since they don't hold
// withdrawWithheldAuthority) would be misleading UI, not just an
// unreachable one. The actual click handling lives in collect-fees.js
// (separate file, separate concern); this file only decides whether
// the button should exist at all.
(function () {
  const emptyEl = document.getElementById('launches-empty');
  const listEl = document.getElementById('launches-list');
  const countEl = document.getElementById('launches-count');
  if (!listEl) return;

  const LAUNCHES_KEY = 'signal_real_launches_v1';

  function apiPath(path) {
    const base = window.SIGNAL_API_BASE_URL;
    return base ? `${base.replace(/\/$/, '')}${path}` : path;
  }

  function loadLocal() {
    try {
      return JSON.parse(localStorage.getItem(LAUNCHES_KEY) || '[]');
    } catch {
      return [];
    }
  }
  function saveLocal(launches) {
    try {
      localStorage.setItem(LAUNCHES_KEY, JSON.stringify(launches));
    } catch {
      // storage unavailable — sync still works for this page view, it
      // just won't persist locally; never fake success
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function render() {
    const launches = loadLocal();

    if (countEl) {
      // A real count of what's actually recorded, nothing more — hidden
      // entirely at zero rather than showing a badge that just says "0".
      countEl.hidden = launches.length === 0;
      countEl.textContent = String(launches.length);
    }

    if (launches.length === 0) {
      emptyEl.hidden = false;
      listEl.innerHTML = '';
      return;
    }

    const connectedAddress = (window.launchpadWallet && window.launchpadWallet.address) || null;

    emptyEl.hidden = true;
    listEl.innerHTML = launches
      .slice()
      .reverse()
      .map((l) => {
        const isCreator = connectedAddress && l.creatorAddress && connectedAddress === l.creatorAddress;
        const collectButton = isCreator
          ? `<button class="btn btn-ghost" data-collect-mint="${escapeHtml(l.mint)}" data-creator-address="${escapeHtml(l.creatorAddress)}" data-decimals="${escapeHtml(String(l.decimals ?? 6))}" style="padding:4px 12px;">Collect Fees</button>`
          : '';
        return `
      <div class="card" style="margin-bottom:10px;" data-launch-card="${escapeHtml(l.mint)}">
        <div class="review-row"><span class="k">${escapeHtml(l.name)} (${escapeHtml(l.symbol)})</span>
          <span style="display:flex; gap:14px;">
            <a href="/token/example?mint=${encodeURIComponent(l.mint)}#community" style="color:var(--brand)">Chat</a>
            <a href="https://explorer.solana.com/address/${escapeHtml(l.mint)}" target="_blank" style="color:var(--brand)">View on Explorer</a>
          </span>
        </div>
        <div class="review-row"><span class="k" style="font-family:monospace;font-size:11px">${escapeHtml(l.mint)}</span><span class="v" style="color:var(--ink-faint)">${new Date(l.launchedAt).toLocaleString()}</span></div>
        ${collectButton ? `<div class="review-row"><span class="k" style="color:var(--ink-faint)">Accumulated Transfer Fee</span>${collectButton}</div><div data-collect-status style="font-size:0.8125rem;color:var(--ink-dim);margin-top:6px;"></div>` : ''}
      </div>`;
      })
      .join('');
  }

  render();
  // Re-render on wallet connect/disconnect so the right set of buttons
  // appears without needing a page reload.
  document.addEventListener('launchpad:wallet-connected', render);

  /** Real cross-device sync: merges what the backend knows this
   *  wallet registered (GET /api/v1/tokens/mine — real, tested,
   *  unauthenticated by its own existing design, no session needed)
   *  into the local cache. Never replaces the local list outright —
   *  only ADDS backend entries this browser doesn't already have,
   *  matched by mint/address — so a local-only entry (e.g. one whose
   *  own registration call happened to fail at launch time) is never
   *  silently lost. Does not touch launch-solana.js's own registration
   *  logic at all; this only reads what's already there. */
  async function syncWithBackend() {
    const connectedAddress = window.launchpadWallet && window.launchpadWallet.address;
    if (!connectedAddress) return;

    let backendTokens;
    try {
      const res = await fetch(apiPath(`/api/v1/tokens/mine?creatorWalletAddress=${encodeURIComponent(connectedAddress)}`));
      if (!res.ok) return; // real fetch, real failure — leave the existing local list exactly as it is
      backendTokens = (await res.json()).tokens;
    } catch {
      return; // network/backend unreachable — same: leave local data untouched, never assume anything
    }
    if (!backendTokens || backendTokens.length === 0) return;

    const local = loadLocal();
    const knownMints = new Set(local.map((l) => l.mint));
    let addedAny = false;
    for (const t of backendTokens) {
      if (knownMints.has(t.address)) continue; // already have it locally — don't duplicate
      local.push({
        name: t.name,
        symbol: t.symbol,
        mint: t.address,
        creatorAddress: t.creatorWalletAddress,
        decimals: t.decimals,
        launchedAt: t.createdAt,
      });
      addedAny = true;
    }
    if (addedAny) {
      saveLocal(local);
      render();
    }
  }

  syncWithBackend();
  document.addEventListener('launchpad:wallet-connected', syncWithBackend);
})();

