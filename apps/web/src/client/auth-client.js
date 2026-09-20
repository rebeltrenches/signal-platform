// Real sign-in-with-wallet for the browser — the client-side half of
// apps/api/src/auth/AuthSession.ts, which existed with no caller at
// all until this file (checked directly: no client file called
// /api/v1/auth/challenge or /api/v1/auth/session before this).
//
// A classic script (like chat.js, dashboard.js), not a module — so
// this is shared with other classic scripts via window.signalAuth
// rather than an ES import, the same pattern api-config.js uses for
// module scripts.
//
// Session persistence: the raw token is kept in localStorage alongside
// the wallet address it was issued for. On use, getSessionToken()
// checks the stored address still matches the currently connected
// wallet — if the wallet changed, the old token is for someone else
// now and is treated as absent, not silently reused. Actual expiry is
// re-checked server-side on every request regardless (verifySessionToken
// in apps/api), so this is a convenience cache, not the real boundary.
window.signalAuth = window.signalAuth || {};

(function () {
  const STORAGE_KEY = 'signal_session_v1';
  const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  function base58Encode(bytes) {
    let num = 0n;
    for (const b of bytes) num = num * 256n + BigInt(b);
    let out = '';
    while (num > 0n) {
      out = BASE58_ALPHABET[Number(num % 58n)] + out;
      num = num / 58n;
    }
    for (const b of bytes) {
      if (b === 0) out = '1' + out;
      else break;
    }
    return out || '1';
  }

  function apiPath(path) {
    const base = window.SIGNAL_API_BASE_URL;
    return base ? `${base.replace(/\/$/, '')}${path}` : path;
  }

  function loadStored() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  function saveStored(entry) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
    } catch {
      // storage unavailable — sign-in still works, just won't persist
      // across page loads; never fake success
    }
  }

  /** Returns a session token usable RIGHT NOW for the currently
   *  connected wallet, or null if none is cached — never returns a
   *  stale token for a DIFFERENT wallet than the one connected now. */
  window.signalAuth.getSessionToken = function () {
    const connected = window.launchpadWallet && window.launchpadWallet.address;
    if (!connected) return null;
    const stored = loadStored();
    if (!stored || stored.address !== connected) return null;
    return stored.token;
  };

  /** Performs a real sign-in for the currently connected wallet:
   *  request a challenge, sign it with the wallet's own signMessage,
   *  exchange for a real session token. Throws on any failure — never
   *  returns a fake token. */
  window.signalAuth.signIn = async function () {
    const connected = window.launchpadWallet && window.launchpadWallet.address;
    if (!connected) throw new Error('No wallet connected.');
    if (!window.solana || typeof window.solana.signMessage !== 'function') {
      throw new Error('This wallet cannot sign messages.');
    }

    const challengeRes = await fetch(apiPath(`/api/v1/auth/challenge?address=${connected}&chain=solana`));
    if (!challengeRes.ok) throw new Error('Could not get a sign-in challenge.');
    const challenge = await challengeRes.json();

    const encoded = new TextEncoder().encode(challenge.message);
    const { signature } = await window.solana.signMessage(encoded, 'utf8');
    const signatureBase58 = base58Encode(signature instanceof Uint8Array ? signature : new Uint8Array(signature));

    const sessionRes = await fetch(apiPath('/api/v1/auth/session'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        address: connected,
        chain: 'solana',
        nonce: challenge.nonce,
        timestamp: challenge.timestamp,
        signature: signatureBase58,
      }),
    });
    if (!sessionRes.ok) {
      const body = await sessionRes.json().catch(() => ({}));
      throw new Error(body.message || 'Sign-in was rejected.');
    }
    const { sessionToken } = await sessionRes.json();
    saveStored({ address: connected, token: sessionToken });
    return sessionToken;
  };

  /** getSessionToken() if already valid for the current wallet,
   *  otherwise performs a real sign-in and returns the new token. */
  window.signalAuth.ensureSignedIn = async function () {
    const existing = window.signalAuth.getSessionToken();
    if (existing) return existing;
    return window.signalAuth.signIn();
  };
})();
