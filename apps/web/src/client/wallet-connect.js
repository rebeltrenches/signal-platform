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

  function phantomProvider() {
    return window.phantom?.solana || window.solana || null;
  }

  function isMobileDevice() {
    if (navigator.userAgentData?.mobile) return true;
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;
    // iPadOS and privacy-focused mobile browsers can identify themselves as
    // desktop Safari. Touch capability plus a phone/tablet-sized screen is a
    // safer fallback than relying on the user-agent string alone.
    return navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900;
  }

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
    const publicKey = resp?.publicKey || phantomProvider()?.publicKey;
    if (!publicKey) return false;
    const address = publicKey.toString();
    btn.textContent = shortAddr(address);
    btn.disabled = true;
    broadcastConnected(address);
    return true;
  }

  async function connect() {
    const provider = phantomProvider();
    if (!provider?.isPhantom) {
      if (isMobileDevice()) {
        const target = encodeURIComponent(window.location.href);
        const ref = encodeURIComponent(window.location.origin);
        window.location.href = `https://phantom.app/ul/browse/${target}?ref=${ref}`;
        return;
      }
      btn.textContent = 'Phantom not found';
      return;
    }
    try {
      const resp = await provider.connect();
      acceptConnection(resp);
    } catch (err) {
      btn.textContent = 'Connect wallet';
    }
  }

  btn.addEventListener('click', connect);

  function installProviderListeners() {
    const provider = phantomProvider();
    if (!provider?.isPhantom || window.__signalPhantomListenersInstalled) return;
    window.__signalPhantomListenersInstalled = true;

    provider.on?.('accountChanged', (publicKey) => {
      if (!publicKey) {
        broadcastDisconnected();
        return;
      }
      acceptConnection({ publicKey });
    });
    provider.on?.('disconnect', broadcastDisconnected);
  }

  // Restore a connection that the user already approved in Phantom. The
  // onlyIfTrusted flag never opens a permission prompt; it simply restores
  // the existing trusted session after a reload or page navigation.
  async function restoreTrustedConnection() {
    const provider = phantomProvider();
    if (!provider?.isPhantom || window.launchpadWallet.address) return;
    installProviderListeners();
    try {
      const resp = await provider.connect({ onlyIfTrusted: true });
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
