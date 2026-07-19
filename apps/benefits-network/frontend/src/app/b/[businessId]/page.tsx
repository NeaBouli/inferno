import type { Metadata } from 'next';
import { BusinessConsoleClient } from './BusinessConsoleClient';

export const metadata: Metadata = {
  title: 'Seller Checkout Console | IFR Benefits',
  robots: { index: false, follow: false },
};

export default async function BusinessConsolePage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  return <BusinessConsoleClient businessId={businessId} />;
}
