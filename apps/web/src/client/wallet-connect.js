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

  function broadcastDisconnected() {
    window.launchpadWallet.address = null;
    btn.textContent = 'Connect wallet';
    btn.disabled = false;
    document.querySelectorAll('[data-dashboard-state="disconnected"]').forEach((el) => (el.hidden = false));
    document.querySelectorAll('[data-dashboard-state="connected"]').forEach((el) => (el.hidden = true));
    document.dispatchEvent(new CustomEvent('launchpad:wallet-disconnected'));
  }

  function acceptConnection(resp) {
    const publicKey = resp?.publicKey || window.solana?.publicKey;
    if (!publicKey) return false;
    const address = publicKey.toString();
    btn.textContent = shortAddr(address);
    btn.disabled = true;
    broadcastConnected(address);
    return true;
  }

  async function connect() {
    if (!window.solana || !window.solana.isPhantom) {
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isMobile) {
        const target = encodeURIComponent(window.location.href);
        const ref = encodeURIComponent(window.location.origin);
        window.location.href = `https://phantom.app/ul/browse/${target}?ref=${ref}`;
        return;
      }
      btn.textContent = 'Phantom not found';
      return;
    }
    try {
      const resp = await window.solana.connect();
      acceptConnection(resp);
    } catch (err) {
      btn.textContent = 'Connect wallet';
    }
  }

  btn.addEventListener('click', connect);

  function installProviderListeners() {
    if (!window.solana?.isPhantom || window.__signalPhantomListenersInstalled) return;
    window.__signalPhantomListenersInstalled = true;

    window.solana.on?.('accountChanged', (publicKey) => {
      if (!publicKey) {
        broadcastDisconnected();
        return;
      }
      acceptConnection({ publicKey });
    });
    window.solana.on?.('disconnect', broadcastDisconnected);
  }

  // Restore a connection that the user already approved in Phantom. The
  // onlyIfTrusted flag never opens a permission prompt; it simply restores
  // the existing trusted session after a reload or page navigation.
  async function restoreTrustedConnection() {
    if (!window.solana?.isPhantom || window.launchpadWallet.address) return;
    installProviderListeners();
    try {
      const resp = await window.solana.connect({ onlyIfTrusted: true });
      acceptConnection(resp);
    } catch {
      // No prior approval (or a locked wallet) is a normal disconnected state.
    }
  }

  installProviderListeners();
  restoreTrustedConnection();
  window.addEventListener('phantom#initialized', restoreTrustedConnection, { once: true });
  window.addEventListener('load', restoreTrustedConnection, { once: true });

  // "Connect wallet" CTA on the dashboard's empty state does the same thing.
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (target instanceof HTMLElement && target.matches('[data-action="connect-from-dashboard"]')) {
      connect();
    }
  });
})();
