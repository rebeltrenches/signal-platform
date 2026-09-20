// Real alert CONFIGURATION — create/list/delete only. No triggering, no
// notifications (see apps/api/src/alerts/AlertRepository.ts for why).
// Unlike watchlist.js, this has no offline-first local form: an alert
// with nobody able to receive it isn't meaningfully "yours" until
// there's an account to attach it to, so this simply requires being
// signed in (auth-client.js) rather than maintaining a parallel
// local-only shape the way watchlist.js does.
(function () {
  const signedOutEl = document.getElementById('alerts-signed-out');
  const signedInEl = document.getElementById('alerts-signed-in');
  const signInBtn = document.getElementById('alertsSignInBtn');
  const addBtn = document.getElementById('alertAddBtn');
  const tokenInput = document.getElementById('alertTokenAddress');
  const kindSelect = document.getElementById('alertKind');
  const thresholdInput = document.getElementById('alertThreshold');
  const statusEl = document.getElementById('alerts-status');
  const emptyEl = document.getElementById('alerts-empty');
  const listEl = document.getElementById('alerts-list');
  const countEl = document.getElementById('alerts-count');
  if (!signedOutEl || !signedInEl || !addBtn || !listEl) return;

  function apiPath(path) {
    const base = window.SIGNAL_API_BASE_URL;
    return base ? `${base.replace(/\/$/, '')}${path}` : path;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function isSignedIn() {
    return !!(window.signalAuth && window.signalAuth.getSessionToken());
  }

  function updateVisibility() {
    const signedIn = isSignedIn();
    signedOutEl.hidden = signedIn;
    signedInEl.hidden = !signedIn;
    if (signedIn) load();
  }

  function render(alerts) {
    if (countEl) {
      countEl.hidden = alerts.length === 0;
      countEl.textContent = String(alerts.length);
    }
    if (alerts.length === 0) {
      emptyEl.hidden = false;
      listEl.innerHTML = '';
      return;
    }
    emptyEl.hidden = true;
    listEl.innerHTML =
      '<div class="card">' +
      alerts
        .map(
          (a) => `
      <div class="review-row" data-alert-id="${escapeHtml(a.id)}">
        <span class="k">${escapeHtml(a.kind)} \u2014 ${escapeHtml(a.tokenAddress)}</span>
        <button class="btn btn-ghost" data-remove-alert="${escapeHtml(a.id)}" style="padding:4px 12px;">Remove</button>
      </div>`
        )
        .join('') +
      '</div>';
  }

  async function load() {
    const token = window.signalAuth.getSessionToken();
    if (!token) return;
    try {
      const res = await fetch(apiPath('/api/v1/alerts'), { headers: { authorization: `Bearer ${token}` } });
      if (res.ok) render((await res.json()).alerts);
    } catch {
      if (statusEl) statusEl.textContent = 'Could not load alerts right now.';
    }
  }

  if (signInBtn) {
    signInBtn.addEventListener('click', async () => {
      signInBtn.disabled = true;
      signInBtn.textContent = 'Signing in\u2026';
      try {
        await window.signalAuth.ensureSignedIn();
        updateVisibility();
      } catch (err) {
        if (statusEl) statusEl.textContent = err instanceof Error ? err.message : 'Sign-in failed.';
      } finally {
        signInBtn.disabled = false;
        signInBtn.textContent = 'Sign in';
      }
    });
  }

  addBtn.addEventListener('click', async () => {
    const token = window.signalAuth && window.signalAuth.getSessionToken();
    if (!token) return;
    const tokenAddress = tokenInput.value.trim();
    const kind = kindSelect.value;
    const rawThreshold = thresholdInput.value.trim();
    if (!tokenAddress) return;

    addBtn.disabled = true;
    try {
      const res = await fetch(apiPath('/api/v1/alerts'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tokenChain: 'solana',
          tokenAddress,
          kind,
          threshold: rawThreshold ? { percent: Number(rawThreshold) } : {},
        }),
      });
      if (res.ok) {
        tokenInput.value = '';
        thresholdInput.value = '';
        if (statusEl) statusEl.textContent = '';
        await load();
      } else {
        const body = await res.json().catch(() => ({}));
        if (statusEl) statusEl.textContent = body.message || 'Could not add that alert.';
      }
    } catch {
      if (statusEl) statusEl.textContent = 'Could not reach the server.';
    } finally {
      addBtn.disabled = false;
    }
  });

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-remove-alert]');
    if (!btn) return;
    const token = window.signalAuth && window.signalAuth.getSessionToken();
    if (!token) return;
    const alertId = btn.getAttribute('data-remove-alert');
    try {
      await fetch(apiPath(`/api/v1/alerts/${alertId}`), { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    } catch {
      // removal failed server-side — reload() below will show the real
      // current state either way, never assume success
    }
    await load();
  });

  updateVisibility();
})();
