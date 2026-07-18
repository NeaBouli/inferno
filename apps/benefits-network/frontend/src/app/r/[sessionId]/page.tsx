import { CustomerSessionClient } from './CustomerSessionClient';

export default async function CustomerSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <CustomerSessionClient sessionId={sessionId} />;
}
