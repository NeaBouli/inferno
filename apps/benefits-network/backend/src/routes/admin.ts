import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/sessionService';
import { adminAuth } from '../middleware/auth';
import { validate } from '../middleware/validator';
import { getRewardOnChainStatus, isWalletAlreadyRewarded } from '../services/rewardService';
import {
  MAX_BUSINESS_CATEGORIES,
  publicBusinessProfile,
  serializeBusinessCategories,
} from '../services/businessProfile';

const router = Router();

const businessDescriptionSchema = z.string().trim().max(500).nullable();
const businessWebsiteSchema = z.string().trim().max(300).url().refine((value) => {
  const parsed = new URL(value);
  return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
}, 'Website must be an HTTPS URL without credentials').nullable();
const businessCategoriesSchema = z.array(z.string().trim().min(1).max(80))
  .max(MAX_BUSINESS_CATEGORIES)
  .refine(
    (items) => new Set(items.map((item) => item.toLocaleLowerCase('en-US'))).size === items.length,
    'Categories must be unique'
  );

const createBusinessSchema = z.object({
  name: z.string().min(1).max(200),
  discountPercent: z.number().int().min(0).max(100),
  requiredLockIFR: z.number().int().positive(),
  ttlSeconds: z.number().int().min(10).max(3600).optional(),
  tierLabel: z.string().max(50).optional(),
  description: businessDescriptionSchema.optional(),
  website: businessWebsiteSchema.optional(),
  categories: businessCategoriesSchema.optional(),
}).strict();

const updateBusinessSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  discountPercent: z.number().int().min(0).max(100).optional(),
  requiredLockIFR: z.number().int().positive().optional(),
  ttlSeconds: z.number().int().min(10).max(3600).optional(),
  tierLabel: z.string().max(50).nullable().optional(),
  description: businessDescriptionSchema.optional(),
  website: businessWebsiteSchema.optional(),
  categories: businessCategoriesSchema.optional(),
  active: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');

const createBenefitRuleSchema = z.object({
  label: z.string().min(1).max(80),
  category: z.string().min(1).max(80),
  productName: z.string().min(1).max(160),
  discountPercent: z.number().int().min(0).max(100),
  requiredLockIFR: z.number().int().positive(),
  dailyRedemptionLimit: z.number().int().min(0).max(1000).optional(),
  monthlyRedemptionLimit: z.number().int().min(0).max(10000).optional(),
  ttlSeconds: z.number().int().min(10).max(3600).optional(),
  active: z.boolean().optional(),
});

const updateBenefitRuleSchema = createBenefitRuleSchema.partial();

const verifyRewardLinkSchema = z.object({
  partnerId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  governanceReference: z.string().trim().min(1).max(200).optional(),
});

router.post('/businesses', adminAuth, validate(createBusinessSchema), async (req, res, next) => {
  try {
    const business = await prisma.business.create({
      data: {
        name: req.body.name,
        discountPercent: req.body.discountPercent,
        requiredLockIFR: req.body.requiredLockIFR,
        ttlSeconds: req.body.ttlSeconds,
        tierLabel: req.body.tierLabel,
        description: req.body.description ?? null,
        website: req.body.website ?? null,
        categoriesJson: serializeBusinessCategories(req.body.categories ?? []),
      },
    });
    res.status(201).json({
      id: business.id,
      verifyUrl: `/b/${business.id}`,
      qrUrl: `/b/${business.id}`,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/businesses/:id', adminAuth, async (req, res, next) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        description: true,
        website: true,
        categoriesJson: true,
        ownerAddress: true,
        discountPercent: true,
        requiredLockIFR: true,
        tierLabel: true,
        createdAt: true,
        _count: { select: { benefitRules: true, products: true } },
      },
    });
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    res.json(publicBusinessProfile({
      id: business.id,
      name: business.name,
      description: business.description,
      website: business.website,
      categoriesJson: business.categoriesJson,
      ownerAddress: business.ownerAddress,
      discountPercent: business.discountPercent,
      requiredLockIFR: business.requiredLockIFR,
      tierLabel: business.tierLabel,
      createdAt: business.createdAt,
      verifyUrl: `/b/${business.id}`,
      qrUrl: `/b/${business.id}`,
      rulesCount: business._count.benefitRules,
      productsCount: business._count.products,
    }));
  } catch (err) {
    next(err);
  }
});

router.patch('/businesses/:id', adminAuth, validate(updateBusinessSchema), async (req, res, next) => {
  try {
    const business = await prisma.business.update({
      where: { id: req.params.id },
      data: {
        name: req.body.name,
        discountPercent: req.body.discountPercent,
        requiredLockIFR: req.body.requiredLockIFR,
        ttlSeconds: req.body.ttlSeconds,
        tierLabel: req.body.tierLabel,
        description: req.body.description,
        website: req.body.website,
        categoriesJson: req.body.categories === undefined
          ? undefined
          : serializeBusinessCategories(req.body.categories),
        active: req.body.active,
      },
      select: {
        id: true,
        name: true,
        description: true,
        website: true,
        categoriesJson: true,
        discountPercent: true,
        requiredLockIFR: true,
        ttlSeconds: true,
        tierLabel: true,
        active: true,
        createdAt: true,
      },
    });
    res.json(publicBusinessProfile(business));
  } catch (err) {
    next(err);
  }
});

router.get('/businesses/:id/rules', adminAuth, async (req, res, next) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const rules = await prisma.benefitRule.findMany({
      where: { businessId: req.params.id },
      orderBy: [{ active: 'desc' }, { requiredLockIFR: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({ rules });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/businesses/:id/rules',
  adminAuth,
  validate(createBenefitRuleSchema),
  async (req, res, next) => {
    try {
      const business = await prisma.business.findUnique({
        where: { id: req.params.id },
        select: { id: true },
      });
      if (!business) {
        res.status(404).json({ error: 'Business not found' });
        return;
      }

      const rule = await prisma.benefitRule.create({
        data: { ...req.body, businessId: req.params.id },
      });
      res.status(201).json(rule);
    } catch (err) {
      next(err);
    }
  }
);

router.patch('/rules/:id', adminAuth, validate(updateBenefitRuleSchema), async (req, res, next) => {
  try {
    const existing = await prisma.benefitRule.findUnique({
      where: { id: req.params.id },
      select: { id: true, businessId: true, productId: true },
    });
    if (!existing) {
      res.status(404).json({ error: 'Benefit rule not found' });
      return;
    }

    const rule = await prisma.$transaction(async (tx) => {
      if (req.body.active === true && existing.productId) {
        const lockedProducts = await tx.$executeRaw`
          UPDATE "Product"
          SET "active" = "active"
          WHERE "id" = ${existing.productId}
            AND "businessId" = ${existing.businessId}
            AND "active" = 1
        `;
        if (lockedProducts !== 1) throw new Error('Linked catalog product is archived');
      }
      return tx.benefitRule.update({
        where: { id: req.params.id },
        data: req.body,
      });
    });
    res.json(rule);
  } catch (err) {
    if (err instanceof Error && err.message.includes('catalog product is archived')) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.delete('/rules/:id', adminAuth, async (req, res, next) => {
  try {
    const existing = await prisma.benefitRule.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ error: 'Benefit rule not found' });
      return;
    }

    await prisma.benefitRule.update({
      where: { id: req.params.id },
      data: { active: false },
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.post(
  '/businesses/:id/rewards/verify',
  adminAuth,
  validate(verifyRewardLinkSchema),
  async (req, res, next) => {
    try {
      const business = await prisma.business.findUnique({
        where: { id: req.params.id },
        select: { id: true, ownerAddress: true, active: true },
      });
      if (!business?.active || !business.ownerAddress) {
        res.status(404).json({ error: 'Active seller-owned business not found' });
        return;
      }

      const onChain = await getRewardOnChainStatus(business.ownerAddress, req.body.partnerId);
      if (!onChain.verified) {
        await prisma.sellerRewardLink.upsert({
          where: { businessId: business.id },
          create: {
            businessId: business.id,
            status: 'APPLIED',
            builderWallet: business.ownerAddress,
            lastCheckedAt: new Date(onChain.checkedAt),
            verificationBlock: String(onChain.blockNumber),
            reason: onChain.reason,
          },
          update: {
            status: 'APPLIED',
            partnerId: null,
            builderWallet: business.ownerAddress,
            verifiedAt: null,
            lastCheckedAt: new Date(onChain.checkedAt),
            verificationBlock: String(onChain.blockNumber),
            reason: onChain.reason,
          },
        });
        res.status(409).json({ error: onChain.reason || 'Seller is not governance verified', onChain });
        return;
      }

      const link = await prisma.sellerRewardLink.upsert({
        where: { businessId: business.id },
        create: {
          businessId: business.id,
          status: 'VERIFIED',
          partnerId: onChain.partnerId,
          builderWallet: business.ownerAddress,
          verifiedAt: new Date(onChain.checkedAt),
          lastCheckedAt: new Date(onChain.checkedAt),
          verificationBlock: String(onChain.blockNumber),
          reason: onChain.reason,
          governanceReference: req.body.governanceReference,
        },
        update: {
          status: 'VERIFIED',
          partnerId: onChain.partnerId,
          builderWallet: business.ownerAddress,
          verifiedAt: new Date(onChain.checkedAt),
          lastCheckedAt: new Date(onChain.checkedAt),
          verificationBlock: String(onChain.blockNumber),
          reason: onChain.reason,
          governanceReference: req.body.governanceReference,
        },
      });
      res.json({ link, onChain });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/businesses/:id/rewards/revoke', adminAuth, async (req, res, next) => {
  try {
    const link = await prisma.sellerRewardLink.findUnique({ where: { businessId: req.params.id } });
    if (!link) {
      res.status(404).json({ error: 'Seller reward application not found' });
      return;
    }
    const revoked = await prisma.sellerRewardLink.update({
      where: { businessId: req.params.id },
      data: { status: 'REVOKED', reason: 'Revoked by benefits administrator' },
    });
    res.json({ link: revoked });
  } catch (err) {
    next(err);
  }
});

router.post('/businesses/:id/rewards/queue', adminAuth, async (req, res, next) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.params.id },
      select: { id: true, ownerAddress: true, active: true, rewardLink: true },
    });
    const link = business?.rewardLink;
    if (!business?.active || !business.ownerAddress || !link?.partnerId || link.status !== 'VERIFIED') {
      res.status(409).json({ error: 'Seller does not have a verified reward link' });
      return;
    }

    const onChain = await getRewardOnChainStatus(business.ownerAddress, link.partnerId);
    if (!onChain.verified) {
      await prisma.$transaction(async (tx) => {
        await tx.sellerRewardLink.update({
          where: { businessId: business.id },
          data: {
            status: 'STALE',
            lastCheckedAt: new Date(onChain.checkedAt),
            verificationBlock: String(onChain.blockNumber),
            reason: onChain.reason,
          },
        });
        await tx.rewardEvent.updateMany({
          where: {
            businessId: business.id,
            status: { in: ['PENDING', 'READY', 'BLOCKED_CALLER', 'BLOCKED_GOVERNANCE'] },
          },
          data: {
            status: 'BLOCKED_GOVERNANCE',
            reason: onChain.reason || 'On-chain reward link is no longer valid',
          },
        });
      });
      res.status(409).json({ error: onChain.reason || 'On-chain reward link is no longer valid', onChain });
      return;
    }

    const eventSelect = { id: true, customerWallet: true } as const;
    const [readyEvents, actionableEvents] = await Promise.all([
      prisma.rewardEvent.findMany({
        where: { businessId: business.id, status: 'READY' },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: eventSelect,
      }),
      prisma.rewardEvent.findMany({
        where: {
          businessId: business.id,
          status: { in: ['PENDING', 'BLOCKED_CALLER', 'BLOCKED_GOVERNANCE'] },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: eventSelect,
      }),
    ]);
    const events = [...readyEvents, ...actionableEvents];

    let ready = 0;
    let confirmed = 0;
    let blocked = 0;
    for (const event of events) {
      const alreadyRewarded = await isWalletAlreadyRewarded(event.customerWallet, link.partnerId);
      const status = alreadyRewarded ? 'CONFIRMED' : onChain.submissionReady ? 'READY' : 'BLOCKED_CALLER';
      const reason = alreadyRewarded
        ? 'Confirmed from PartnerVault anti-double-count state'
        : onChain.submissionReady
          ? 'Governance and authorized caller checks passed; no transaction submitted by this service'
          : onChain.reason || 'Dedicated reward caller is not authorized';
      const updated = await prisma.rewardEvent.updateMany({
        where: {
          id: event.id,
          status: { in: ['PENDING', 'READY', 'BLOCKED_CALLER', 'BLOCKED_GOVERNANCE'] },
        },
        data: { status, reason },
      });
      if (updated.count !== 1) continue;
      if (status === 'CONFIRMED') confirmed += 1;
      else if (status === 'READY') ready += 1;
      else blocked += 1;
    }

    await prisma.sellerRewardLink.update({
      where: { businessId: business.id },
      data: {
        lastCheckedAt: new Date(onChain.checkedAt),
        verificationBlock: String(onChain.blockNumber),
        reason: onChain.reason,
      },
    });
    res.json({ ready, confirmed, blocked, scanned: events.length, submissionReady: onChain.submissionReady });
  } catch (err) {
    next(err);
  }
});

export default router;
