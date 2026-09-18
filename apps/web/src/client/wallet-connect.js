// Real Phantom detection and connection — no fabricated wallet state.
// If Phantom isn't installed, or the user declines, that's shown exactly
// as it is; nothing here ever invents an address or a balance.
//
// Exposes window.launchpadWallet = { address } and fires a
// 'launchpad:wallet-connected' event on document, so other scripts
// (launch-solana.js) can react without being tightly coupled to this
// file's internals.
window.launchpadWallet = window.launchpadWallet || { address: null };

(function () {
  const btn = document.getElementById('wallet-connect-btn');
  if (!btn) return;

  function shortAddr(addr) {
    return addr.slice(0, 4) + '\u2026' + addr.slice(-4);
  }

  function broadcastConnected(address) {
    window.launchpadWallet.address = address;
    document.querySelectorAll('[data-dashboard-state="disconnected"]').forEach((el) => (el.hidden = true));
    document.querySelectorAll('[data-dashboard-state="connected"]').forEach((el) => (el.hidden = false));
    const addrEl = document.getElementById('dashboard-wallet-addr');
    if (addrEl) addrEl.textContent = shortAddr(address);
    document.dispatchEvent(new CustomEvent('launchpad:wallet-connected', { detail: { address } }));
  }

  async function connect() {
    if (!window.solana || !window.solana.isPhantom) {
      btn.textContent = 'Phantom not found';
      return;
    }
    try {
      const resp = await window.solana.connect();
      const address = resp.publicKey.toString();
      btn.textContent = shortAddr(address);
      btn.disabled = true;
      broadcastConnected(address);
    } catch (err) {
      btn.textContent = 'Connect wallet';
    }
  }

  btn.addEventListener('click', connect);

  // "Connect wallet" CTA on the dashboard's empty state does the same thing.
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (target instanceof HTMLElement && target.matches('[data-action="connect-from-dashboard"]')) {
      connect();
    }
  });
})();
