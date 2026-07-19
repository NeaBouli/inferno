import type { Metadata } from 'next';
import { SellerCatalogClient } from './SellerCatalogClient';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ businessId: string }>;
}): Promise<Metadata> {
  const { businessId } = await params;
  return {
    title: 'Seller Offers | IFR Benefits',
    description: 'Browse public seller offers and IFR locked-access benefits.',
    alternates: { canonical: `https://shop.ifrunit.tech/s/${encodeURIComponent(businessId)}` },
  };
}

export default async function SellerCatalogPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  return <SellerCatalogClient businessId={businessId} />;
}
