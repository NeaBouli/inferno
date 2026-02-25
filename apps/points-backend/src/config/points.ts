export const POINTS_CONFIG = {
  events: {
    wallet_connect:     { points: 10, dailyLimit: 1 },
    guide_wallet_setup: { points: 20, dailyLimit: 1 },
    guide_add_token:    { points: 20, dailyLimit: 1 },
    guide_lock:         { points: 30, dailyLimit: 1 },
    partner_onboarding: { points: 50, dailyLimit: 1 },
  } as Record<string, { points: number; dailyLimit: number }>,
  voucher: {
    threshold: 100,
    discountBps: 15,
    maxDiscountBps: 25,
    expiryDays: 7,
    dailyIssuanceCap: 100,
  },
};

export type PointEventType = keyof typeof POINTS_CONFIG.events;
