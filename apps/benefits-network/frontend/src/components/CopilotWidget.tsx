'use client';

import { useCallback, useEffect, useState } from 'react';

export function CopilotWidget() {
  const [open, setOpen] = useState(false);
  const [openedOnce, setOpenedOnce] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const closeCopilot = useCallback(() => {
    setOpen(false);
    setOpenedOnce(false);
    setLoaded(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeCopilot();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [closeCopilot, open]);

  return (
    <div className="shop-copilot" data-testid="copilot-widget">
      <section
        id="shop-copilot-panel"
        className="shop-copilot-panel"
        role="dialog"
        aria-modal="false"
        aria-label="IFR Copilot help"
        aria-hidden={!open}
        hidden={!open}
      >
        <div className="shop-copilot-toolbar">
          <span>IFR Copilot</span>
          <button
            type="button"
            className="shop-copilot-close"
            onClick={closeCopilot}
            aria-label="Close IFR Copilot"
          >
            &times;
          </button>
        </div>
        {openedOnce && !loaded ? (
          <p className="shop-copilot-loading" role="status">
            Loading IFR Copilot...
          </p>
        ) : null}
        {openedOnce ? (
          <iframe
            src="https://copilot-api.ifrunit.tech"
            title="IFR Copilot"
            loading="lazy"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
          />
        ) : null}
      </section>
      <button
        type="button"
        className={`shop-copilot-button ${open ? 'is-hidden' : ''}`}
        onClick={() => {
          setOpenedOnce(true);
          setOpen(true);
        }}
        aria-label="Open IFR Copilot"
        aria-controls="shop-copilot-panel"
        aria-expanded={open}
        data-testid="open-copilot"
      >
        <img src="/copilot-avatar.jpg" alt="" width="60" height="60" />
      </button>
    </div>
  );
}
