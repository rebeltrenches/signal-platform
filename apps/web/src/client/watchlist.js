// Real watchlist — add/remove/list, persisted in this browser's
// localStorage, AND synced to the real backend once signed in
// (apps/api/src/routes/watchlist.ts). Not a mock either way: what you
// add is what you get back, exactly, nothing invented.
//
// Local storage format: an array of { value, backendId }. backendId is
// null until the item has been synced to the backend at least once —
// this is how a not-yet-authenticated add is distinguished from one
// that's already been pushed server-side. Old-format entries (a plain
// array of strings, from before this sync existed) are transparently
// upgraded to { value, backendId: null } on first load — nothing is
// lost migrating between formats.
(function () {
  const input = document.getElementById('watchlistInput');
  const addBtn = document.getElementById('watchlistAddBtn');
  const emptyEl = document.getElementById('watchlist-empty');
  const listEl = document.getElementById('watchlist-list');
  const countEl = document.getElementById('watchlist-count');
  const syncBtn = document.getElementById('watchlistSyncBtn');
  const syncStatusEl = document.getElementById('watchlist-sync-status');
  if (!input || !addBtn || !listEl) return;

  const KEY = 'signal_watchlist_v1';

  function apiPath(path) {
    const base = window.SIGNAL_API_BASE_URL;
    return base ? `${base.replace(/\/$/, '')}${path}` : path;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      // Upgrade the old plain-string-array format transparently.
      return parsed.map((item) => (typeof item === 'string' ? { value: item, backendId: null } : item));
    } catch {
      return [];
    }
  }
  function save(items) {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      // storage unavailable (private browsing, quota) — fail silently,
      // the list just won't persist this session; never fake success
    }
  }

  function isSignedIn() {
    return !!(window.signalAuth && window.signalAuth.getSessionToken());
  }

  function updateSyncUi() {
    if (!syncStatusEl || !syncBtn) return;
    if (isSignedIn()) {
      syncStatusEl.textContent = 'Synced to your account.';
      syncBtn.hidden = true;
    } else {
      syncStatusEl.textContent = 'Saved to this browser only.';
      syncBtn.hidden = false;
    }
  }

  function render() {
    const items = load();
    if (countEl) {
      countEl.hidden = items.length === 0;
      countEl.textContent = String(items.length);
    }
    if (items.length === 0) {
      emptyEl.hidden = false;
      listEl.innerHTML = '';
      return;
    }
    emptyEl.hidden = true;
    listEl.innerHTML =
      '<div class="card">' +
      items
        .map(
          (item, i) => `
      <div class="review-row" data-idx="${i}">
        <span class="k">${escapeHtml(item.value)} <span class="hint" data-reg-status="${i}"></span></span>
        <button class="btn btn-ghost" data-remove="${i}" style="padding:4px 12px;">Remove</button>
      </div>`
        )
        .join('') +
      '</div>';
    checkRegistrationStatuses(items);
  }

  /** Real, per-item check against the EXISTING Stage 2 lookup endpoint
   *  — the same one token-detail.js already uses for "Launched on
   *  Signal", reused here as-is, not modified. Each item starts with
   *  no status shown at all (never a guessed default) and is updated
   *  only once its own real fetch resolves. A fetch failure leaves the
   *  indicator exactly as it was — blank, if this is the first check,
   *  or whatever it last correctly showed — never a fabricated status
   *  either direction. Registration status only: no holder count,
   *  price, or any other on-chain data is requested or shown. */
  async function checkRegistrationStatuses(items) {
    items.forEach(async (item, i) => {
      const el = listEl.querySelector(`[data-reg-status="${i}"]`);
      if (!el) return; // list re-rendered before this item's check ran — nothing to update
      try {
        const res = await fetch(apiPath(`/api/v1/tokens/solana/${encodeURIComponent(item.value)}`));
        // Re-check the element still exists and still corresponds to
        // the same value — render() may have run again while this
        // fetch was in flight (e.g. an add/remove), and the index i
        // could now point at a different item.
        const current = load();
        if (current[i]?.value !== item.value) return;
        const currentEl = listEl.querySelector(`[data-reg-status="${i}"]`);
        if (!currentEl) return;
        currentEl.textContent = res.ok ? 'Registered on Signal' : 'Not a registered Signal token';
      } catch {
        // network/backend unreachable — leave the indicator exactly as
        // it is, never guess
      }
    });
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Real migration: any local item with no backendId yet gets POSTed
   *  to the real backend, then the local cache is updated with the
   *  real id it was assigned — never silently dropped, never assumed
   *  synced without a real, confirmed response. After this, listing
   *  merges in anything already on the backend that isn't local yet
   *  (e.g. added from a different device), so nothing from either side
   *  is lost. */
  async function syncWithBackend() {
    const token = window.signalAuth.getSessionToken();
    if (!token) return;

    const local = load();
    const stillLocalOnly = [];
    for (const item of local) {
      if (item.backendId) {
        stillLocalOnly.push(item);
        continue;
      }
      try {
        const res = await fetch(apiPath('/api/v1/watchlist'), {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ value: item.value }),
        });
        if (res.ok) {
          const body = await res.json();
          stillLocalOnly.push({ value: item.value, backendId: body.item.id });
        } else {
          stillLocalOnly.push(item); // migration failed for this one — keep it local, try again next sync
        }
      } catch {
        stillLocalOnly.push(item);
      }
    }

    try {
      const listRes = await fetch(apiPath('/api/v1/watchlist'), { headers: { authorization: `Bearer ${token}` } });
      if (listRes.ok) {
        const { items: backendItems } = await listRes.json();
        const knownIds = new Set(stillLocalOnly.map((i) => i.backendId).filter(Boolean));
        for (const bi of backendItems) {
          if (!knownIds.has(bi.id)) {
            stillLocalOnly.push({ value: bi.value, backendId: bi.id });
          }
        }
      }
    } catch {
      // backend list fetch failed — keep whatever local+migrated state
      // we already have rather than losing it over a transient error
    }

    save(stillLocalOnly);
    render();
    updateSyncUi();
  }

  addBtn.addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) return;
    const items = load();
    if (!items.some((i) => i.value === value)) {
      let backendId = null;
      if (isSignedIn()) {
        try {
          const res = await fetch(apiPath('/api/v1/watchlist'), {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${window.signalAuth.getSessionToken()}` },
            body: JSON.stringify({ value }),
          });
          if (res.ok) backendId = (await res.json()).item.id;
        } catch {
          // backend add failed — still save locally below, sync will retry later
        }
      }
      items.push({ value, backendId });
      save(items);
      render();
    }
    input.value = '';
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addBtn.click();
  });

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    const idx = Number(btn.getAttribute('data-remove'));
    const items = load();
    const [removed] = items.splice(idx, 1);
    if (removed && removed.backendId && isSignedIn()) {
      try {
        await fetch(apiPath(`/api/v1/watchlist/${removed.backendId}`), {
          method: 'DELETE',
          headers: { authorization: `Bearer ${window.signalAuth.getSessionToken()}` },
        });
      } catch {
        // backend delete failed — it's already removed locally; a
        // stale backend row is a smaller problem than blocking the
        // user's own local action on a network error
      }
    }
    save(items);
    render();
  });

  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      if (!window.signalAuth) return;
      syncBtn.disabled = true;
      syncBtn.textContent = 'Signing in\u2026';
      try {
        await window.signalAuth.ensureSignedIn();
        syncBtn.textContent = 'Syncing\u2026';
        await syncWithBackend();
      } catch (err) {
        if (syncStatusEl) syncStatusEl.textContent = err instanceof Error ? err.message : 'Could not sync.';
      } finally {
        syncBtn.disabled = false;
        syncBtn.textContent = 'Sync across devices';
      }
    });
  }

  render();
  updateSyncUi();
  // If already signed in from a prior visit (a valid cached session for
  // the currently connected wallet), sync automatically — no need to
  // make the person click the button again every time.
  if (isSignedIn()) syncWithBackend();
})();
