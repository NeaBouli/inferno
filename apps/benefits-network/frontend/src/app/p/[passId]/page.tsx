import type { Metadata } from 'next';
import { CustomerPassHandoff } from './CustomerPassHandoff';

export const metadata: Metadata = {
  title: 'Private Customer Pass | IFR Benefits',
  robots: { index: false, follow: false },
};

export default async function CustomerPassPage({ params }: { params: Promise<{ passId: string }> }) {
  const { passId } = await params;
  return <CustomerPassHandoff passId={passId} />;
}
