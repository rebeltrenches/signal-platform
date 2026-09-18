// Explore page tab + filter chip switching. Visual state only — there is
// no real dataset to filter yet (Stage 11), so this doesn't pretend to
// query anything; it just shows/hides the honest empty-state panels.
(function () {
  const tabs = document.querySelectorAll('#explore-tabs [role="tab"]');
  if (tabs.length === 0) return;

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
})();
