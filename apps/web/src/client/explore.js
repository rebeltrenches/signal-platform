// Explore page tab + filter chip switching, PLUS a real data fetch for
// the "New" tab specifically — the only one with an actual data source
// today (registered tokens, Stage 2). Momentum and graduating stay
// visual-only: neither has a real backend yet (live RPC data, and the
// bonding curve respectively), so this deliberately does not touch
// those two panels at all.
(function () {
  const tabs = document.querySelectorAll('#explore-tabs [role="tab"]');
  if (tabs.length === 0) return;

  function apiPath(path) {
    const base = window.SIGNAL_API_BASE_URL;
    return base ? `${base.replace(/\/$/, '')}${path}` : path;
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function shortAddress(addr) {
    return addr.length > 10 ? `${addr.slice(0, 4)}\u2026${addr.slice(-4)}` : addr;
  }
  function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  /** Real fetch, real render — only registration facts that actually
   *  exist (name, symbol, address, chain, creation time). No holder
   *  count, no volume, no supply data: this endpoint doesn't return
   *  any of that (see routes/tokens.ts's own comment on why), so
   *  there's nothing here to accidentally fabricate.
   *
   *  With no query, shows the most recent registered tokens. With a
   *  query, searches name/symbol/address (simple substring, no fuzzy/
   *  ranked matching, as scoped) — the New tab is the only one with a
   *  real data source, so search only ever affects it. */
  async function loadNewTab(query) {
    const listEl = document.getElementById('explore-new-list');
    const emptyEl = document.getElementById('explore-new-empty');
    if (!listEl || !emptyEl) return;
    const trimmed = (query || '').trim();
    try {
      const url = trimmed
        ? apiPath(`/api/v1/search?q=${encodeURIComponent(trimmed)}`)
        : apiPath('/api/v1/tokens?limit=20');
      const res = await fetch(url);
      if (!res.ok) return; // leave the honest empty state showing
      const { tokens } = await res.json();
      if (!tokens || tokens.length === 0) {
        // Distinguishes "nothing registered at all" from "nothing
        // matched this search" — the same honest-empty-state
        // discipline as everywhere else, not just reusing one generic
        // message for both cases.
        listEl.innerHTML = '';
        emptyEl.hidden = false;
        const heading = emptyEl.querySelector('h3');
        const body = emptyEl.querySelector('p');
        if (trimmed && heading && body) {
          heading.textContent = 'No matches';
          body.textContent = `No registered token matched "${trimmed}".`;
        } else if (heading && body) {
          heading.textContent = 'No indexed launches yet';
          body.textContent = 'Recently created tokens will appear here once the indexer (Stage 11) is connected to a live chain.';
        }
        return;
      }

      emptyEl.hidden = true;
      listEl.innerHTML = tokens
        .map(
          (t) => `
        <div class="review-row">
          <span class="k">${escapeHtml(t.name)} (${escapeHtml(t.symbol)})</span>
          <span class="v" style="font-family:monospace;font-size:0.75rem;">${escapeHtml(shortAddress(t.address))} \u00b7 ${escapeHtml(t.chain)} \u00b7 ${escapeHtml(formatTime(t.createdAt))}</span>
        </div>`
        )
        .join('');
    } catch {
      // fetch failed (no backend reachable) — the honest empty state
      // this panel already shows is the correct fallback, not an error
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.setAttribute('aria-selected', 'false'));
      tab.setAttribute('aria-selected', 'true');
      const target = tab.getAttribute('data-tab');
      document.querySelectorAll('#explore-panels [data-panel]').forEach((panel) => {
        const isTarget = panel.getAttribute('data-panel') === target;
        panel.hidden = !isTarget;
        if (isTarget) {
          // Restart the fade even if this panel was already shown before —
          // re-triggering the class is what makes repeated clicks each
          // get their own brief settle-in rather than only the first.
          panel.classList.remove('panel-enter');
          void panel.offsetWidth;
          panel.classList.add('panel-enter');
        }
      });
    });
  });

  document.querySelectorAll('.chip[data-filter-chain]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const pressed = chip.getAttribute('aria-pressed') === 'true';
      chip.setAttribute('aria-pressed', String(!pressed));
    });
  });

  // Sort chips are mutually exclusive (only one active sort at a time),
  // unlike the chain filter chips above which are independent toggles.
  const sortChips = document.querySelectorAll('.chip[data-sort]');
  sortChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      sortChips.forEach((c) => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', 'true');
    });
  });

  // Origin chips (All / Signal-launched / External) are also mutually
  // exclusive — master spec section 23's Signal-vs-external distinction.
  const originChips = document.querySelectorAll('.chip[data-origin]');
  originChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      originChips.forEach((c) => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', 'true');
    });
  });

  loadNewTab();

  // Search: simple substring matching only (as scoped — no fuzzy/
  // ranked logic). Only affects the New tab, the only one with a real
  // data source; debounced so it doesn't fire a request per keystroke.
  const searchInput = document.getElementById('exploreSearchInput');
  if (searchInput) {
    let debounceTimer = null;
    searchInput.addEventListener('input', () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => loadNewTab(searchInput.value), 250);
    });
  }
})();
