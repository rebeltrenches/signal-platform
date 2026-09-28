// Regional restrictions, terms acceptance and wallet sanctions screening in
// the browser. Levels come from /api/geo (the Worker applies
// config/restrictions.json to Cloudflare's location), screening from
// /api/wallet-screen. The Worker enforces the same rules itself on launch
// registration and trade building; these checks exist so people see why,
// and so launches (sent from the browser to Solana) are stopped here too.
//
//   blocked   -> notice banner; connecting, launching and trading disabled
//   regulated -> the terms screen adds the region's warning to tick
//   any       -> terms accepted once per browser per terms version (a new
//                version re-prompts everyone), shown at wallet connect
//
// Exposes window.signalCompliance; loaded before wallet-connect.js.
(function () {
  const STORE_KEY = 'signal_terms_acceptance';
  const TERMS_VERSION = window.SIGNAL_TERMS_VERSION || '';
  const IS_DEVNET = window.SIGNAL_SOLANA_CLUSTER === 'devnet';
  // Each point the visitor confirms, in plain words (see /terms).
  const POINTS = [
    'I am 18 or older.',
    'I understand nothing on Signal is financial advice.',
    'I understand meme coins are extremely risky and can go to zero; I could lose everything I put in.',
    'I understand Signal is non-custodial: it never holds my funds or keys.',
    'I am responsible for my own wallet and every transaction I approve.',
    "I am not in a region where Signal is unavailable, and I'm not using a VPN or proxy to get around that.",
    'I am not a sanctioned person and not acting for one.',
  ];

  let geoPromise = null;
  const screenings = new Map(); // address -> Promise<{ status, message }>

  function loadGeo() {
    if (!geoPromise) {
      geoPromise = fetch('/api/geo', { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((geo) => (geo && typeof geo.level === 'string' ? geo : null))
        .catch(() => null);
    }
    return geoPromise;
  }

  function readAcceptance() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    } catch {
      return null;
    }
  }
  function writeAcceptance(record) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(record));
    } catch {
      // storage unavailable: the visitor is asked again next time
    }
  }
  /** Accepted this terms version (and, in a Level 2 region, its warning). */
  function hasAccepted(geo) {
    const record = readAcceptance();
    if (!record || !TERMS_VERSION || record.version !== TERMS_VERSION) return false;
    if (geo && geo.level === 'regulated') return Array.isArray(record.regulated) && record.regulated.includes(geo.country);
    return true;
  }

  function el(tag, props, ...children) {
    const node = Object.assign(document.createElement(tag), props || {});
    node.append(...children);
    return node;
  }

  function showBlockedNotice(geo) {
    if (document.getElementById('region-blocked-notice')) return;
    const banner = el(
      'div',
      { id: 'region-blocked-notice', className: 'region-notice', role: 'status' },
      el('strong', { textContent: 'Not available in your region' }),
      ` (${geo.name || geo.country}). ${geo.notice || ''}`,
    );
    const main = document.querySelector('main');
    (main || document.body).prepend(banner);
    const connect = document.getElementById('wallet-connect-btn');
    if (connect) {
      connect.textContent = 'Not available in your region';
      connect.disabled = true;
    }
  }

  function showWalletNotice(message) {
    let banner = document.getElementById('wallet-screening-notice');
    if (!banner) {
      banner = el('div', { id: 'wallet-screening-notice', className: 'region-notice', role: 'status' });
      (document.querySelector('main') || document.body).prepend(banner);
    }
    banner.textContent = message;
  }

  /** The terms screen. Resolves true once every box is ticked and the
   *  visitor accepts; false if they cancel. */
  function showAcceptance(geo) {
    document.getElementById('terms-acceptance')?.remove();
    return new Promise((resolve) => {
      const boxes = [];
      const item = (text) => {
        const input = el('input', { type: 'checkbox' });
        boxes.push(input);
        return el('label', { className: 'terms-point' }, input, el('span', { textContent: text }));
      };
      const list = el('div', { className: 'terms-points' }, ...POINTS.map(item));
      if (geo && geo.level === 'regulated' && geo.warning) {
        const regional = el('div', { className: 'terms-regional' },
          el('strong', { textContent: `Important for ${geo.name || geo.country}` }),
          el('p', { textContent: geo.warning }),
          item(`I have read this warning for ${geo.name || geo.country} and accept it.`));
        regional.querySelector('label').setAttribute('data-regional', geo.country);
        list.append(regional);
      }
      const accept = el('button', { type: 'button', className: 'btn btn-brand', textContent: 'Accept and continue', disabled: true, id: 'terms-accept' });
      const cancel = el('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Cancel', id: 'terms-cancel' });
      const update = () => { accept.disabled = !boxes.every((box) => box.checked); };
      boxes.forEach((box) => box.addEventListener('change', update));
      const dialog = el('div', { className: 'terms-dialog', role: 'dialog' },
        el('h2', { textContent: 'Before you connect a wallet', id: 'terms-title' }),
        el('p', { className: 'hint', textContent: 'Please confirm each point. ' },
          el('a', { href: '/terms', target: '_blank', rel: 'noopener', textContent: 'Read the full terms and risks' }),
          ' (draft pending legal review).'),
        list,
        el('div', { className: 'terms-actions' }, cancel, accept));
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'terms-title');
      const overlay = el('div', { className: 'terms-overlay', id: 'terms-acceptance' }, dialog);
      const close = (value) => {
        overlay.remove();
        resolve(value);
      };
      accept.addEventListener('click', () => {
        const previous = readAcceptance();
        const regulated = previous && previous.version === TERMS_VERSION && Array.isArray(previous.regulated) ? previous.regulated : [];
        if (geo && geo.level === 'regulated' && !regulated.includes(geo.country)) regulated.push(geo.country);
        writeAcceptance({ version: TERMS_VERSION, acceptedAt: new Date().toISOString(), regulated });
        close(true);
      });
      cancel.addEventListener('click', () => close(false));
      document.body.append(overlay);
      boxes[0]?.focus();
    });
  }

  async function screen(address) {
    if (!screenings.has(address)) {
      screenings.set(address, fetch('/api/wallet-screen', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address }),
      })
        .then(async (response) => {
          const body = await response.json().catch(() => ({}));
          if (response.ok && ['clear', 'sanctioned', 'unavailable'].includes(body.status)) return body;
          return { status: 'unavailable', message: body.error || 'Wallet screening is unavailable. Please try again in a minute.' };
        })
        .catch(() => ({ status: 'unavailable', message: 'Wallet screening is unreachable. Please try again in a minute.' }))
        .then((result) => {
          // Only definite answers are kept for this page view; failures retry.
          if (result.status === 'unavailable') screenings.delete(address);
          return result;
        }));
    }
    return screenings.get(address);
  }

  window.signalCompliance = {
    termsVersion: TERMS_VERSION,
    geo: loadGeo,
    screen,
    hasAccepted,
    /** Before any wallet connect: false if the region is blocked or the
     *  visitor doesn't accept the terms. */
    async beforeConnect() {
      const geo = await loadGeo();
      if (geo && geo.level === 'blocked') {
        showBlockedNotice(geo);
        return false;
      }
      return hasAccepted(geo) ? true : showAcceptance(geo);
    },
    /** For silently restoring an earlier connection: only when nothing
     *  would need to be shown (never opens the terms screen). */
    async canRestore() {
      const geo = await loadGeo();
      return !(geo && geo.level === 'blocked') && hasAccepted(geo);
    },
    /** Right before a launch or trade: { ok } or { ok: false, message }.
     *  Fails safe: an unknown region or a failed screening stops it. */
    async check(action, address) {
      if (IS_DEVNET) return { ok: true }; // test builds: nothing touches Mainnet
      const geo = await loadGeo();
      if (!geo) return { ok: false, message: `Couldn't confirm your region, so ${action}ing is paused. Please reload and try again.` };
      if (geo.level === 'blocked') {
        showBlockedNotice(geo);
        return { ok: false, message: `${geo.notice} (${geo.name || geo.country})` };
      }
      if (!hasAccepted(geo) && !(await showAcceptance(geo))) {
        return { ok: false, message: `Accept the terms to ${action}.` };
      }
      const result = await screen(address);
      if (result.status === 'clear') return { ok: true };
      if (result.status === 'sanctioned') showWalletNotice(result.message);
      return { ok: false, message: result.message };
    },
  };

  // The region notice shows on every page, without waiting for a connect.
  loadGeo().then((geo) => {
    if (geo && geo.level === 'blocked') showBlockedNotice(geo);
  });
  // Screen each wallet as soon as it connects; a sanctioned one gets a notice.
  document.addEventListener('launchpad:wallet-connected', (event) => {
    const address = event.detail && event.detail.address;
    if (!address || IS_DEVNET) return;
    screen(address).then((result) => {
      if (result.status === 'sanctioned') showWalletNotice(result.message);
    });
  });
})();
