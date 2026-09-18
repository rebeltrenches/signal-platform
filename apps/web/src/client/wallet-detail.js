// Wallet detail page tab switching — same real pattern as
// token-detail.js. Every panel already renders its own honest state.
(function () {
  const tabs = document.querySelectorAll('#wallet-tabs [role="tab"]');
  if (tabs.length === 0) return;

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.setAttribute('aria-selected', 'false'));
      tab.setAttribute('aria-selected', 'true');
      const target = tab.getAttribute('data-tab');
      document.querySelectorAll('#wallet-panels [data-panel]').forEach((panel) => {
        panel.hidden = panel.getAttribute('data-panel') !== target;
      });
    });
  });
})();
