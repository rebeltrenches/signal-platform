// Real watchlist — add/remove/list, persisted in this browser's
// localStorage. Not a mock: what you add is what you get back, exactly,
// nothing invented. A watchlist that syncs across devices needs a real
// account system (Stage 19) and a database (Stage 2) — this is the
// honest, fully-real version of what's possible without either.
(function () {
  const input = document.getElementById('watchlistInput');
  const addBtn = document.getElementById('watchlistAddBtn');
  const emptyEl = document.getElementById('watchlist-empty');
  const listEl = document.getElementById('watchlist-list');
  const countEl = document.getElementById('watchlist-count');
  if (!input || !addBtn || !listEl) return;

  const KEY = 'signal_watchlist_v1';

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
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
        <span class="k">${escapeHtml(item)}</span>
        <button class="btn btn-ghost" data-remove="${i}" style="padding:4px 12px;">Remove</button>
      </div>`
        )
        .join('') +
      '</div>';
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  addBtn.addEventListener('click', () => {
    const value = input.value.trim();
    if (!value) return;
    const items = load();
    if (!items.includes(value)) {
      items.push(value);
      save(items);
      render();
    }
    input.value = '';
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addBtn.click();
  });

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    const idx = Number(btn.getAttribute('data-remove'));
    const items = load();
    items.splice(idx, 1);
    save(items);
    render();
  });

  render();
})();
