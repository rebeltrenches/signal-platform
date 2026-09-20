// Token detail page tab switching — real interaction, no fake data behind
// it. Each panel already renders its own honest state (empty-state or
// SourcedRow "Unavailable") server-side; this just shows/hides them.
(function () {
  const tabs = document.querySelectorAll('#token-tabs [role="tab"]');
  if (tabs.length === 0) return;

  function activateTab(target) {
    tabs.forEach((t) => t.setAttribute('aria-selected', t.getAttribute('data-tab') === target ? 'true' : 'false'));
    document.querySelectorAll('#token-panels [data-panel]').forEach((panel) => {
      panel.hidden = panel.getAttribute('data-panel') !== target;
    });
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.getAttribute('data-tab')));
  });

  // A link from elsewhere (Dashboard's "Chat" link on a real launch) can
  // land directly on this tab via #community, rather than requiring an
  // extra manual click after arriving. Case-insensitive: URL fragments
  // are conventionally lowercase ("#community"), while this page's own
  // tab labels are capitalized ("Community") — matching exactly would
  // require every link to remember that inconsistency.
  const hashTarget = window.location.hash.replace('#', '').toLowerCase();
  const matchingTab = Array.from(tabs).find((t) => (t.getAttribute('data-tab') || '').toLowerCase() === hashTarget);
  if (matchingTab) {
    activateTab(matchingTab.getAttribute('data-tab'));
  }

  // Real "Launched on Signal" check — replaces the static placeholder
  // with an actual lookup against the real registration endpoint
  // (Stage 2). Deliberately does NOT add any RPC/indexer capability:
  // this only answers "is there a real Token row for this address,"
  // exactly what packages/types' own TokenIdentity.launchedOnSignal
  // comment describes as the correct way to answer this ("a fact to
  // fetch — check the Token table"), nothing more. Chain defaults to
  // 'solana', matching this page's own existing static "Solana" badge
  // — real multi-chain detail pages are a separate concern this fix
  // doesn't attempt to solve.
  (function checkLaunchedOnSignal() {
    const badge = document.getElementById('signal-launch-badge');
    if (!badge) return;
    const address = window.location.pathname.split('/').filter(Boolean).pop();
    if (!address) return;

    function apiPath(path) {
      const base = window.SIGNAL_API_BASE_URL;
      return base ? `${base.replace(/\/$/, '')}${path}` : path;
    }

    fetch(apiPath(`/api/v1/tokens/solana/${encodeURIComponent(address)}`))
      .then((res) => {
        badge.textContent = res.ok ? 'Launched on Signal: Yes' : 'Launched on Signal: No';
      })
      .catch(() => {
        // Lookup failed (no backend reachable) — leave the honest
        // "Unavailable" text exactly as it was, never guess.
      });
  })();
})();
