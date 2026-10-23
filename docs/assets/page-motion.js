// Shared decorative motion lifecycle; data widgets keep their own freshness rules.
(() => {
  const mediaQuery = query => typeof window.matchMedia === 'function'
    ? window.matchMedia(query) : { matches: false };
  const reduced = mediaQuery('(prefers-reduced-motion: reduce)');
  const compact = mediaQuery('(max-width: 1024px)');
  const limitedHardware = typeof navigator !== 'undefined' &&
    (navigator.hardwareConcurrency <= 4 || navigator.deviceMemory <= 4);
  const root = document.documentElement;
  const selector = '.hero-web3-btn, .coin-container, .ifr-stars-container, .ifr-bh-wrap, .live-dot, .vault-dot, .spinner, .gauge-live i, #bw-connect-btn, [style*="animation:"]';
  const visible = new Set();
  const decorations = new Set();
  const update = element => element.classList.toggle('site-motion-paused',
    document.hidden || reduced.matches || !visible.has(element));
  const observer = typeof window.IntersectionObserver === 'function' ? new window.IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
      update(entry.target);
    });
  }) : null;

  function register(element) {
    if (decorations.has(element)) return;
    decorations.add(element);
    if (observer) observer.observe(element);
    else visible.add(element);
    update(element);
  }
  function visit(node, callback) {
    if (node.nodeType !== 1) return;
    if (node.matches(selector)) callback(node);
    node.querySelectorAll(selector).forEach(callback);
  }
  function sync() {
    root.classList.toggle('site-motion-hidden', document.hidden);
    root.classList.toggle('site-motion-limited', limitedHardware || compact.matches);
    decorations.forEach(update);
  }
  document.querySelectorAll(selector).forEach(register);
  // Status spinners and pulses can be inserted after an asynchronous widget read.
  if (typeof MutationObserver === 'function') new MutationObserver(records => records.forEach(record => {
    record.removedNodes.forEach(node => visit(node, element => {
      if (element.isConnected) return; // disclosures move existing nodes in place
      observer?.unobserve(element);
      decorations.delete(element);
      visible.delete(element);
    }));
    record.addedNodes.forEach(node => visit(node, register));
  })).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener?.('change', sync);
  compact.addEventListener?.('change', sync);
  sync();
})();
