(function () {
  const toggle = document.getElementById('hamburger');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  function setOpen(open) {
    sidebar.classList.toggle('open', open);
    overlay.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    document.body.style.overflow = open ? 'hidden' : '';
    sidebar.inert = window.innerWidth <= 900 && !open;
    document.querySelector('.main').inert = open;
  }
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  overlay.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { setOpen(false); toggle.focus(); } });
  sidebar.addEventListener('click', event => { if (event.target.closest('a')) setOpen(false); });
  window.addEventListener('resize', () => setOpen(false));
  setOpen(false);
})();
