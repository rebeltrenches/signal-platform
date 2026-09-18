// Token detail page tab switching — real interaction, no fake data behind
// it. Each panel already renders its own honest state (empty-state or
// SourcedRow "Unavailable") server-side; this just shows/hides them.
(function () {
  const tabs = document.querySelectorAll('#token-tabs [role="tab"]');
  if (tabs.length === 0) return;

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.setAttribute('aria-selected', 'false'));
      tab.setAttribute('aria-selected', 'true');
      const target = tab.getAttribute('data-tab');
      document.querySelectorAll('#token-panels [data-panel]').forEach((panel) => {
        panel.hidden = panel.getAttribute('data-panel') !== target;
      });
    });
  });
})();
