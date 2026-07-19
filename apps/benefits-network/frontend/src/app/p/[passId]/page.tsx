import { CustomerPassHandoff } from './CustomerPassHandoff';

export default async function CustomerPassPage({ params }: { params: Promise<{ passId: string }> }) {
  const { passId } = await params;
  return <CustomerPassHandoff passId={passId} />;
}
