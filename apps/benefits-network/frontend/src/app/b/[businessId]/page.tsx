import { BusinessConsoleClient } from './BusinessConsoleClient';

export default async function BusinessConsolePage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  return <BusinessConsoleClient businessId={businessId} />;
}
