import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/sessionService';
import { adminAuth } from '../middleware/auth';
import { validate } from '../middleware/validator';

const router = Router();

const createBusinessSchema = z.object({
  name: z.string().min(1).max(200),
  discountPercent: z.number().int().min(0).max(100),
  requiredLockIFR: z.number().int().positive(),
  ttlSeconds: z.number().int().min(10).max(3600).optional(),
  tierLabel: z.string().max(50).optional(),
});

const updateBusinessSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  discountPercent: z.number().int().min(0).max(100).optional(),
  requiredLockIFR: z.number().int().positive().optional(),
  ttlSeconds: z.number().int().min(10).max(3600).optional(),
  tierLabel: z.string().max(50).nullable().optional(),
  active: z.boolean().optional(),
});

const createBenefitRuleSchema = z.object({
  label: z.string().min(1).max(80),
  category: z.string().min(1).max(80),
  productName: z.string().min(1).max(160),
  discountPercent: z.number().int().min(0).max(100),
  requiredLockIFR: z.number().int().positive(),
  ttlSeconds: z.number().int().min(10).max(3600).optional(),
  active: z.boolean().optional(),
});

const updateBenefitRuleSchema = createBenefitRuleSchema.partial();

router.post('/businesses', adminAuth, validate(createBusinessSchema), async (req, res, next) => {
  try {
    const business = await prisma.business.create({ data: req.body });
    res.status(201).json({
      id: business.id,
      verifyUrl: `/b/${business.id}`,
      qrUrl: `/b/${business.id}`,
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/businesses/:id', adminAuth, validate(updateBusinessSchema), async (req, res, next) => {
  try {
    const business = await prisma.business.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(business);
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

export default router;
