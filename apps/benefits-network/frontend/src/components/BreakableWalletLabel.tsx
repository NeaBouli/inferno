import { Fragment } from 'react';

/**
 * Renders a wallet connector label with a line-break opportunity between camel-case words
 * ("Wallet<wbr>Connect"), so a narrow connector button can wrap it like "Coinbase Wallet" wraps at
 * its space. The text itself is unchanged.
 */
export function BreakableWalletLabel({ label }: { label: string }) {
  const parts = label.replace(/([a-z])([A-Z])/g, '$1\n$2').split('\n');
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <wbr /> : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}
