import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { CustomerQrScannerClient } from './CustomerQrScannerClient';

export const metadata: Metadata = {
  title: 'Scan Seller QR | IFR Benefits',
  description: 'Open a one-time IFR Benefits customer proof from a seller QR code.',
  alternates: {
    canonical: 'https://shop.ifrunit.tech/scan',
  },
};

export default function CustomerQrScannerPage() {
  return (
    <AppShell>
      <section className="mx-auto w-full max-w-6xl px-5 pb-16 pt-6 sm:pt-10">
        <CustomerQrScannerClient />
      </section>
    </AppShell>
  );
}
