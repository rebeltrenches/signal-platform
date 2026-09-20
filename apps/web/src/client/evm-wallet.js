// Real EIP-1193 wallet detection and connection for Base/BNB — the
// same "never fabricate state" discipline as wallet-connect.js's
// Phantom handling, applied to window.ethereum instead. If no EVM
// wallet extension is installed, or the user declines, or they're on
// the wrong network, that's shown exactly as it is.
//
// Deliberately kept SEPARATE from window.launchpadWallet (the Solana
// connection) rather than overloading the same global with ambiguous
// chain semantics — chat.js, dashboard.js, collect-fees.js, and
// launch-solana.js all assume window.launchpadWallet.address is a
// Solana address usable with window.solana.signMessage; conflating
// that with an EVM address would silently break all of them. This
// exposes window.launchpadEvmWallet = { address, chainId, chainName }
// instead, and fires 'launchpad:evm-wallet-connected' on document.
//
// Base and BNB adapters are not implemented yet (adapterImplemented:
// false in packages/config/src/chains.ts) — connecting an EVM wallet
// here does not unlock launching or trading on either chain. This is
// real, tested connectivity infrastructure ahead of that work, not a
// claim that the work is done.
window.launchpadEvmWallet = window.launchpadEvmWallet || { address: null, chainId: null, chainName: null };

export const EVM_CHAINS = {
  '0x2105': 'base', // Base mainnet, 8453
  '0x38': 'bnb', // BNB Smart Chain mainnet, 56
};

function chainNameFor(chainIdHex) {
  return EVM_CHAINS[chainIdHex.toLowerCase()] ?? null;
}

export function isEvmWalletAvailable() {
  return typeof window.ethereum !== 'undefined';
}

/** Real connection: requests accounts, reads the actual connected
 *  chain, and reports both — never assumes a chain from what the UI
 *  wanted the user to be on. Throws on user rejection or no wallet
 *  found; callers decide how to display that, this never swallows it
 *  into a fake success. */
export async function connectEvmWallet() {
  if (!isEvmWalletAvailable()) {
    throw new Error('No EVM wallet extension found.');
  }
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  if (!accounts || accounts.length === 0) {
    throw new Error('No account was returned by the wallet.');
  }
  const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
  const address = accounts[0];
  const chainName = chainNameFor(chainIdHex);

  window.launchpadEvmWallet = { address, chainId: chainIdHex, chainName };
  document.dispatchEvent(new CustomEvent('launchpad:evm-wallet-connected', { detail: { address, chainId: chainIdHex, chainName } }));
  return { address, chainId: chainIdHex, chainName };
}

/** Real reactivity — a genuine wallet fires these when the user
 *  switches accounts or networks in the extension itself, not just on
 *  the initial connect() call. Registered once; safe to call from
 *  multiple mount points since it only ever updates the one shared
 *  window.launchpadEvmWallet state and re-fires the same event. */
export function watchEvmWalletChanges() {
  if (!isEvmWalletAvailable() || window.__signalEvmWatchersRegistered) return;
  window.__signalEvmWatchersRegistered = true;

  window.ethereum.on?.('accountsChanged', (accounts) => {
    if (!accounts || accounts.length === 0) {
      window.launchpadEvmWallet = { address: null, chainId: null, chainName: null };
      document.dispatchEvent(new CustomEvent('launchpad:evm-wallet-disconnected'));
      return;
    }
    window.launchpadEvmWallet.address = accounts[0];
    document.dispatchEvent(new CustomEvent('launchpad:evm-wallet-connected', { detail: { ...window.launchpadEvmWallet } }));
  });

  window.ethereum.on?.('chainChanged', (chainIdHex) => {
    window.launchpadEvmWallet.chainId = chainIdHex;
    window.launchpadEvmWallet.chainName = chainNameFor(chainIdHex);
    document.dispatchEvent(new CustomEvent('launchpad:evm-wallet-connected', { detail: { ...window.launchpadEvmWallet } }));
  });
}

// ---------------------------------------------------------------------
// CreatePage wiring — purely additive to the existing chain-selection
// buttons, not a replacement for anything in wizard.js. Only shows/
// hides the two informational connect panels and reports connection
// status honestly; never touches the "Continue" button or wizard.js's
// own state/validation, since Base/BNB launching still isn't real
// regardless of wallet connection (see the panels' own copy in
// CreatePage.tsx). Runs only if the chain grid this page uses actually
// exists — a no-op everywhere else in the app.
// ---------------------------------------------------------------------
(function initCreatePageEvmPanels() {
  const grid = document.getElementById('chain-grid');
  if (!grid) return;

  const panels = { base: document.getElementById('evm-connect-base'), bnb: document.getElementById('evm-connect-bnb') };

  grid.querySelectorAll('.chain-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const chain = btn.getAttribute('data-chain');
      Object.entries(panels).forEach(([key, panel]) => {
        if (panel) panel.hidden = key !== chain;
      });
    });
  });

  document.querySelectorAll('[data-evm-connect]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const expectedChain = btn.getAttribute('data-evm-connect');
      const statusEl = document.querySelector(`[data-evm-status="${expectedChain}"]`);
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Connecting\u2026';
      try {
        const { address, chainName } = await connectEvmWallet();
        watchEvmWalletChanges();
        const short = address.slice(0, 6) + '\u2026' + address.slice(-4);
        if (chainName === expectedChain) {
          btn.textContent = 'Connected';
          if (statusEl) statusEl.textContent = `Connected: ${short}`;
        } else {
          // Real, honest mismatch — never silently treated as success.
          btn.textContent = originalText;
          btn.disabled = false;
          if (statusEl) statusEl.textContent = `Connected wallet is on a different network (expected ${expectedChain}). Switch networks in your wallet and try again.`;
        }
      } catch (err) {
        btn.textContent = originalText;
        btn.disabled = false;
        if (statusEl) statusEl.textContent = err instanceof Error ? err.message : 'Could not connect.';
      }
    });
  });
})();
