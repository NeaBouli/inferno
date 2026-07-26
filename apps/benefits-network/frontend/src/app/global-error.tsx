'use client';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>IFR Benefits recovery</title>
      </head>
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: '#17120f',
          color: '#f7f3ed',
          fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <main
          data-testid="shop-global-error"
          role="alert"
          aria-labelledby="global-error-title"
          style={{
            boxSizing: 'border-box',
            display: 'grid',
            minHeight: '100vh',
            placeItems: 'center',
            padding: '32px 20px',
          }}
        >
          <section
            style={{
              boxSizing: 'border-box',
              width: 'min(100%, 720px)',
              borderTop: '1px solid rgba(251, 146, 60, 0.38)',
              borderBottom: '1px solid rgba(251, 146, 60, 0.38)',
              padding: '48px 0',
            }}
          >
            <p style={{ margin: 0, color: '#fdba74', fontSize: 12, fontWeight: 800, textTransform: 'uppercase' }}>
              IFR Benefits recovery
            </p>
            <h1
              id="global-error-title"
              style={{ margin: '16px 0 0', maxWidth: 620, fontFamily: 'Georgia, serif', fontSize: 'clamp(40px, 9vw, 72px)', lineHeight: 1.04 }}
            >
              The app needs a clean restart.
            </h1>
            <p style={{ margin: '20px 0 0', maxWidth: 620, color: '#d6d3d1', fontSize: 17, lineHeight: 1.65 }}>
              Your wallet remains in your control. Retry the app, then reconnect if needed.
              Never repeat a transaction unless your wallet shows that the previous one failed.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 28 }}>
              <button
                type="button"
                onClick={reset}
                style={{
                  border: 0,
                  borderRadius: 999,
                  background: '#fb923c',
                  color: '#1c1917',
                  cursor: 'pointer',
                  fontWeight: 900,
                  padding: '14px 22px',
                  textTransform: 'uppercase',
                }}
              >
                Restart app
              </button>
              <a
                href="/guide"
                style={{
                  border: '1px solid rgba(255,255,255,0.25)',
                  borderRadius: 999,
                  color: '#f7f3ed',
                  fontWeight: 800,
                  padding: '13px 21px',
                  textDecoration: 'none',
                  textTransform: 'uppercase',
                }}
              >
                Recovery guide
              </a>
            </div>
            <p style={{ margin: '28px 0 0', color: '#a8a29e', fontSize: 14, lineHeight: 1.6 }}>
              IFR Benefits never asks for a seed phrase or private key to recover the app.
            </p>
          </section>
        </main>
      </body>
    </html>
  );
}
