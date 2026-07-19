import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/sessionService';
import { discoveryRateLimiter } from '../middleware/rateLimiter';

const router = Router();

function parsePositiveInteger(value: unknown, fallback: number, maximum: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= maximum ? parsed : null;
}

router.get('/', discoveryRateLimiter, async (req, res, next) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1, 1_000);
    const limit = parsePositiveInteger(req.query.limit, 12, 24);
    const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const invalidTextFilter =
      (req.query.query !== undefined && typeof req.query.query !== 'string') ||
      (req.query.category !== undefined && typeof req.query.category !== 'string');

    if (!page || !limit || invalidTextFilter || query.length > 80 || category.length > 80) {
      res.status(400).json({ error: 'Invalid discovery filters' });
      return;
    }

    const visibleOfferFilter: Prisma.BenefitRuleWhereInput = {
      active: true,
      business: { active: true },
      AND: [
        { OR: [{ productId: null }, { product: { active: true } }] },
        ...(category ? [{ category }] : []),
        ...(query ? [{
          OR: [
            { label: { contains: query } },
            { category: { contains: query } },
            { productName: { contains: query } },
            { business: { name: { contains: query } } },
            { product: { name: { contains: query } } },
            { product: { description: { contains: query } } },
          ],
        }] : []),
      ],
    };
    const categoryFilter: Prisma.BenefitRuleWhereInput = {
      active: true,
      business: { active: true },
      OR: [{ productId: null }, { product: { active: true } }],
    };

    const [total, offers, categoryRows] = await Promise.all([
      prisma.benefitRule.count({ where: visibleOfferFilter }),
      prisma.benefitRule.findMany({
        where: visibleOfferFilter,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          label: true,
          category: true,
          productName: true,
          discountPercent: true,
          requiredLockIFR: true,
          dailyRedemptionLimit: true,
          monthlyRedemptionLimit: true,
          business: { select: { id: true, name: true } },
          product: { select: { id: true, name: true, description: true } },
        },
      }),
      prisma.benefitRule.findMany({
        where: categoryFilter,
        distinct: ['category'],
        orderBy: { category: 'asc' },
        select: { category: true },
      }),
    ]);
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    res.json({
      offers,
      categories: categoryRows.map((row) => row.category),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        discountPercent: true,
        requiredLockIFR: true,
        tierLabel: true,
        active: true,
      },
    });

    if (!business || !business.active) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    res.json(business);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/rules', async (req, res, next) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.params.id },
      select: { id: true, active: true },
    });

    if (!business || !business.active) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const rules = await prisma.benefitRule.findMany({
      where: {
        businessId: req.params.id,
        active: true,
        OR: [{ productId: null }, { product: { active: true } }],
      },
      orderBy: [{ requiredLockIFR: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        businessId: true,
        productId: true,
        label: true,
        category: true,
        productName: true,
        discountPercent: true,
        requiredLockIFR: true,
        dailyRedemptionLimit: true,
        monthlyRedemptionLimit: true,
        ttlSeconds: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ rules });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/products', async (req, res, next) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, active: true },
    });
    if (!business || !business.active) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const products = await prisma.product.findMany({
      where: {
        businessId: req.params.id,
        active: true,
        benefitRules: { some: { active: true } },
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        businessId: true,
        name: true,
        category: true,
        description: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        benefitRules: {
          where: { active: true },
          orderBy: [{ requiredLockIFR: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            label: true,
            discountPercent: true,
            requiredLockIFR: true,
            dailyRedemptionLimit: true,
            monthlyRedemptionLimit: true,
            ttlSeconds: true,
          },
        },
      },
    });
    res.json({ business: { id: business.id, name: business.name }, products });
  } catch (err) {
    next(err);
  }
});

export default router;
