import type { Metadata } from 'next';
import { permanentRedirect } from 'next/navigation';
import { SellerCatalogClient } from './SellerCatalogClient';
import type { PublicBusinessProfile } from '@/lib/api';

const apiOrigin = process.env.BENEFITS_API_INTERNAL_URL || 'http://localhost:3001';

async function loadBusiness(reference: string): Promise<PublicBusinessProfile | null> {
  try {
    const response = await fetch(
      `${apiOrigin}/api/businesses/${encodeURIComponent(reference)}`,
      { next: { revalidate: 300 }, signal: AbortSignal.timeout(5_000) }
    );
    return response.ok ? await response.json() as PublicBusinessProfile : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ businessId: string }>;
}): Promise<Metadata> {
  const { businessId } = await params;
  const business = await loadBusiness(businessId);
  const canonicalRef = business?.slug || business?.id || businessId;
  return {
    title: business ? `${business.name} Benefits | IFR Benefits` : 'Seller Offers | IFR Benefits',
    description: business?.description || 'Browse public seller offers and IFR locked-access benefits.',
    alternates: { canonical: `https://shop.ifrunit.tech/s/${encodeURIComponent(canonicalRef)}` },
  };
}

export default async function SellerCatalogPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const business = await loadBusiness(businessId);
  if (business?.slug && businessId !== business.slug) {
    permanentRedirect(`/s/${encodeURIComponent(business.slug)}`);
  }
  return <SellerCatalogClient businessId={businessId} />;
}
