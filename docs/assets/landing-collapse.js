// Enhance the existing nodes in place: widgets, links and their listeners stay intact.
(() => {
  const panels = new Map();
  let sequence = 0;

  function addDisclosure(root, titles) {
    if (root.classList.contains('landing-collapse')) return;
    const id = root.id || `landing-address-${++sequence}`;
    const heading = document.createElement('div');
    heading.className = 'landing-collapse-heading';
    const panel = document.createElement('div');
    panel.className = 'landing-collapse-panel';
    panel.id = `${id}-panel`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'landing-collapse-toggle';
    button.setAttribute('aria-controls', panel.id);
    const indicator = document.createElement('span');
    indicator.className = 'landing-collapse-chevron';
    indicator.setAttribute('aria-hidden', 'true');
    button.append(indicator);

    // Move, never clone or replace, the original content and headings.
    panel.append(...root.childNodes);
    titles.forEach((title, index) => {
      if (!title.id) title.id = `${id}-title-${index}`;
      heading.append(title);
    });
    button.setAttribute('aria-labelledby', titles.map(title => title.id).join(' '));
    heading.append(button);
    root.append(heading, panel);
    root.classList.add('landing-collapse');
    const setExpanded = expanded => {
      button.setAttribute('aria-expanded', String(expanded));
      panel.hidden = !expanded;
    };
    button.addEventListener('click', () => setExpanded(panel.hidden));
    panels.set(panel, setExpanded);
    setExpanded(false);
  }

  // Both address inventories use the same disclosure as the main sections.
  document.querySelectorAll('[data-landing-address], #contracts .contract-row').forEach(card => {
    const mainToken = card.querySelector('[data-addr="0x77e99917Eca8539c62F509ED1193ac36580A6e7B"], a[href="https://etherscan.io/address/0x77e99917Eca8539c62F509ED1193ac36580A6e7B"]');
    if (mainToken) return;
    card.classList.add('landing-address-collapse');
    addDisclosure(card, [card.querySelector('[data-landing-address-title]') || card.firstElementChild]);
  });

  const alwaysOpen = new Set(['wizard', 'token-flow', 'roadmap', 'contracts']);
  document.querySelectorAll('main > section:not(.hero)').forEach(section => {
    if (alwaysOpen.has(section.id)) return;
    const title = section.querySelector('h2');
    if (!title) return;
    const label = section.querySelector('.section-label, [data-landing-label]');
    section.classList.add('landing-collapsible');
    addDisclosure(section, [label, title].filter(Boolean));
  });

  function revealHash(hash) {
    let id;
    try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
    const target = document.getElementById(id);
    if (!target) return;
    // A section hash refers to its own panel; a descendant may also be inside
    // an address tile. Open every ancestor before the browser scrolls.
    let node = target;
    while (node) {
      const panel = node.querySelector(':scope > .landing-collapse-panel');
      if (panels.has(panel)) panels.get(panel)(true);
      if (panels.has(node)) panels.get(node)(true);
      node = node.parentElement;
    }
    requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const url = new URL(link.href, location.href);
    if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search && url.hash) revealHash(url.hash);
  });
  window.addEventListener('hashchange', () => revealHash(location.hash));
  const initialHash = location.hash;
  revealHash(initialHash);
  // Live data, images and transitions above the target can shift it after the first scroll, even
  // without changing the page height. Watch the target itself for a few seconds and re-align it
  // once the smooth scroll has settled; stop as soon as the visitor scrolls or navigates.
  let initialTarget = null;
  try { initialTarget = initialHash && document.getElementById(decodeURIComponent(initialHash.slice(1))); } catch { /* invalid hash */ }
  if (initialTarget) {
    let stopped = false;
    let lastScrollY = window.scrollY;
    const stop = () => { stopped = true; };
    const settle = () => {
      if (stopped || location.hash !== initialHash) return;
      const scrolling = window.scrollY !== lastScrollY;
      lastScrollY = window.scrollY;
      const offset = parseFloat(getComputedStyle(initialTarget).scrollMarginTop) || 0;
      const drift = initialTarget.getBoundingClientRect().top - offset;
      const atEnd = drift > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 1;
      if (!scrolling && Math.abs(drift) > 1 && !atEnd) initialTarget.scrollIntoView({ block: 'start', behavior: 'instant' });
      requestAnimationFrame(settle);
    };
    requestAnimationFrame(settle);
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(type => window.addEventListener(type, stop, { once: true, passive: true }));
    window.addEventListener('hashchange', stop, { once: true });
    setTimeout(stop, 5000);
  }

  // Keep decorative animation work scoped to visible elements, including disclosures.
  if ('IntersectionObserver' in window) {
    const decorations = document.querySelectorAll('.hero-web3-btn, .coin-container, .ifr-stars-container, .ifr-bh-wrap, .live-dot, .gauge-live i, [style*="animation:"]');
    const visible = new Set();
    const update = element => element.classList.toggle('landing-motion-paused', document.hidden || !visible.has(element));
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
        update(entry.target);
      });
    });
    decorations.forEach(element => {
      update(element);
      observer.observe(element);
    });
    document.addEventListener('visibilitychange', () => decorations.forEach(update));
  }
})();
