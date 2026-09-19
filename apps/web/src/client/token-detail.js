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
})();
