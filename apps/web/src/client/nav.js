// Mobile nav drawer toggle. No dependencies, progressively enhances the
// server-rendered header — the drawer markup already exists in the HTML,
// this just shows/hides it.
(function () {
  const toggle = document.getElementById('nav-mobile-toggle');
  const drawer = document.getElementById('nav-drawer');
  if (!toggle || !drawer) return;

  toggle.addEventListener('click', () => {
    const isOpen = drawer.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });
})();
