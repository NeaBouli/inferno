import type { Metadata } from 'next';
import { CustomerSessionClient } from './CustomerSessionClient';

export const metadata: Metadata = {
  title: 'Private Checkout Proof | IFR Benefits',
  robots: { index: false, follow: false },
};

export default async function CustomerSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <CustomerSessionClient sessionId={sessionId} />;
}
