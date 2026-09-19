// Renders "Your launches" from the SAME localStorage key launch-solana.js
// writes to, only after a real launch actually confirms. This file only
// reads and displays — it never writes an entry itself, so there's no
// path for a fake launch to appear here.
//
// "Collect Fees" is shown ONLY when the entry's recorded creatorAddress
// matches the currently connected wallet — an entry from a token this
// browser happens to have a LOCAL RECORD of, launched by some OTHER
// wallet, never gets a collect button. The actual click handling lives
// in collect-fees.js (separate file, separate concern); this file only
// decides whether the button should exist at all.
(function () {
  const emptyEl = document.getElementById('launches-empty');
  const listEl = document.getElementById('launches-list');
  const countEl = document.getElementById('launches-count');
  if (!listEl) return;

  const LAUNCHES_KEY = 'signal_real_launches_v1';

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function render() {
    let launches = [];
    try {
      launches = JSON.parse(localStorage.getItem(LAUNCHES_KEY) || '[]');
    } catch {
      launches = [];
    }

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
        const isOwnLaunch = connectedAddress && l.creatorAddress && l.creatorAddress === connectedAddress;
        // Entries recorded before this feature existed have no
        // creatorAddress at all — never show the action for those
        // either; an absent value is not a match, on purpose.
        const collectButton = isOwnLaunch
          ? `<button class="btn btn-ghost" data-collect-mint="${escapeHtml(l.mint)}" data-decimals="${escapeHtml(String(l.decimals ?? 6))}" style="padding:4px 12px;">Collect Fees</button>`
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
})();

