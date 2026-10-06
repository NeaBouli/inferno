import type { PrismaClient } from '@prisma/client';
import type { ModelBPilot } from './modelBPolicy';
import type { RedemptionConfirmation, SettlementPeriod, SettlementRecords } from './modelBSettlement';
import { fingerprintWallets } from './walletFingerprint';

function parseConfirmation(payload: string): RedemptionConfirmation {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return {
      actorWallet: typeof parsed.actorWallet === 'string' ? parsed.actorWallet : null,
      actorRole: typeof parsed.actorRole === 'string' ? parsed.actorRole : null,
      operatorId: typeof parsed.operatorId === 'string' ? parsed.operatorId : null,
    };
  } catch {
    return { actorWallet: null, actorRole: null, operatorId: null };
  }
}

/**
 * Read-only loader over the existing persistence (Session, AuditLog, RewardEvent, Business,
 * CheckoutOperator, SellerRewardLink). It writes nothing and adds no new stored data.
 */
export async function loadSettlementRecords(
  db: PrismaClient,
  pilot: ModelBPilot,
  period: SettlementPeriod
): Promise<SettlementRecords | null> {
  const range = { gte: period.start, lt: period.end };
  const business = await db.business.findUnique({
    where: { id: pilot.businessId },
    select: {
      active: true,
      ownerAddress: true,
      rewardLink: { select: { status: true, partnerId: true, rewardWallet: true, builderWallet: true } },
      checkoutOperators: { select: { id: true, walletAddress: true } },
    },
  });
  if (!business) return null;

  const [sessions, events, orphanEvents] = await Promise.all([
    db.session.findMany({
      where: { businessId: pilot.businessId, status: 'REDEEMED', redeemedAt: range },
      select: { id: true, redeemedAt: true, customerFingerprint: true },
    }),
    db.rewardEvent.findMany({
      where: { partnerId: pilot.partnerId, session: { redeemedAt: range } },
      select: {
        id: true,
        businessId: true,
        partnerId: true,
        customerFingerprint: true,
        status: true,
        session: { select: { id: true, businessId: true, status: true, redeemedAt: true } },
      },
    }),
    db.rewardEvent.findMany({
      where: { partnerId: pilot.partnerId, createdAt: range, session: { status: { not: 'REDEEMED' } } },
      select: { id: true },
    }),
  ]);
  const confirmations = sessions.length === 0 ? [] : await db.auditLog.findMany({
    where: { sessionId: { in: sessions.map((session) => session.id) }, type: 'REDEEMED' },
    select: { sessionId: true, payload: true },
  });
  const bySession = new Map<string, RedemptionConfirmation[]>();
  for (const log of confirmations) {
    const list = bySession.get(log.sessionId) ?? [];
    list.push(parseConfirmation(log.payload));
    bySession.set(log.sessionId, list);
  }

  // Seller (business) wallets are fingerprinted in memory; customer rows hold only fingerprints.
  const sellerFingerprints = [...fingerprintWallets([
    business.ownerAddress,
    ...business.checkoutOperators.map((operator) => operator.walletAddress),
    business.rewardLink?.rewardWallet,
    business.rewardLink?.builderWallet,
  ])];

  return {
    ownership: {
      businessActive: business.active,
      ownerAddress: business.ownerAddress,
      operators: business.checkoutOperators,
      sellerFingerprints,
      link: business.rewardLink,
    },
    redemptions: sessions.map((session) => ({
      sessionId: session.id,
      redeemedAt: session.redeemedAt as Date,
      customerFingerprint: session.customerFingerprint,
      confirmations: bySession.get(session.id) ?? [],
    })),
    events,
    orphanEventIds: orphanEvents.map((event) => event.id),
  };
}
