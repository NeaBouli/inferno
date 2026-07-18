import { SellerCatalogClient } from './SellerCatalogClient';

export default async function SellerCatalogPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  return <SellerCatalogClient businessId={businessId} />;
}
