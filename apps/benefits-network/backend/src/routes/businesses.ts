import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/sessionService';
import { discoveryRateLimiter } from '../middleware/rateLimiter';
import {
  businessServiceAreaKey,
  MAX_BUSINESS_SERVICE_AREA_LENGTH,
  normalizeBusinessServiceArea,
  publicBusinessProfile,
} from '../services/businessProfile';
import { safeProductPrice } from '../services/productPrice';

const router = Router();
const visibleCatalogRule: Prisma.BenefitRuleWhereInput = {
  active: true,
  OR: [{ productId: null }, { product: { active: true } }],
};

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
    const businessId = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';
    const serviceAreaInput = typeof req.query.serviceArea === 'string' ? req.query.serviceArea : '';
    const serviceArea = normalizeBusinessServiceArea(serviceAreaInput);
    const serviceAreaKey = businessServiceAreaKey(serviceAreaInput);
    const invalidTextFilter =
      (req.query.query !== undefined && typeof req.query.query !== 'string') ||
      (req.query.category !== undefined && typeof req.query.category !== 'string') ||
      (req.query.businessId !== undefined && typeof req.query.businessId !== 'string') ||
      (req.query.serviceArea !== undefined && typeof req.query.serviceArea !== 'string');

    if (
      !page || !limit || invalidTextFilter || query.length > 80 || category.length > 80 ||
      businessId.length > 80 || (businessId && !/^[A-Za-z0-9_-]+$/.test(businessId)) ||
      serviceAreaInput.length > MAX_BUSINESS_SERVICE_AREA_LENGTH || (serviceAreaInput.trim() && !serviceArea)
    ) {
      res.status(400).json({ error: 'Invalid discovery filters' });
      return;
    }

    const visibleOfferFilter: Prisma.BenefitRuleWhereInput = {
      active: true,
      business: {
        active: true,
        ownerAddress: { not: null },
        ...(businessId ? { id: businessId } : {}),
        ...(serviceAreaKey ? { serviceAreaKey } : {}),
      },
      AND: [
        { OR: [{ productId: null }, { product: { active: true } }] },
        ...(category ? [{ category }] : []),
        ...(query ? [{
          OR: [
            { label: { contains: query } },
            { category: { contains: query } },
            { productName: { contains: query } },
            { business: { name: { contains: query } } },
            { business: { description: { contains: query } } },
            { business: { serviceArea: { contains: query } } },
            { business: { categoriesJson: { contains: query } } },
            { product: { name: { contains: query } } },
            { product: { description: { contains: query } } },
          ],
        }] : []),
      ],
    };
    const categoryFilter: Prisma.BenefitRuleWhereInput = {
      active: true,
      business: { active: true, ownerAddress: { not: null }, ...(businessId ? { id: businessId } : {}) },
      OR: [{ productId: null }, { product: { active: true } }],
    };

    const [total, offers, categoryRows, serviceAreaRows] = await Promise.all([
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
          minIFRHeld: true,
          lockSource: true,
          dailyRedemptionLimit: true,
          monthlyRedemptionLimit: true,
          business: {
            select: {
              id: true,
              name: true,
              description: true,
              website: true,
              logoUrl: true,
              serviceArea: true,
              serviceAreaKey: true,
              categoriesJson: true,
            },
          },
          product: {
            select: {
              id: true,
              name: true,
              description: true,
              basePriceMinor: true,
              currency: true,
            },
          },
        },
      }),
      prisma.benefitRule.findMany({
        where: categoryFilter,
        distinct: ['category'],
        orderBy: { category: 'asc' },
        select: { category: true },
      }),
      prisma.business.findMany({
        where: {
          active: true,
          ownerAddress: { not: null },
          ...(businessId ? { id: businessId } : {}),
          serviceArea: { not: null },
          serviceAreaKey: { not: null },
          benefitRules: {
            some: {
              active: true,
              OR: [{ productId: null }, { product: { active: true } }],
            },
          },
        },
        orderBy: { serviceArea: 'asc' },
        select: { serviceArea: true, serviceAreaKey: true },
      }),
    ]);
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const serviceAreas = Array.from(new Map(
      serviceAreaRows.flatMap((row) => {
        const label = normalizeBusinessServiceArea(row.serviceArea);
        const key = businessServiceAreaKey(row.serviceArea);
        return label && key ? [[key, label] as const] : [];
      })
    ).values()).sort((left, right) => left.localeCompare(right, 'en'));

    res.json({
      offers: offers.map((offer) => ({
        ...offer,
        business: publicBusinessProfile(offer.business),
        product: offer.product
          ? { ...offer.product, ...safeProductPrice(offer.product) }
          : null,
      })),
      categories: categoryRows.map((row) => row.category),
      serviceAreas,
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

router.get('/catalog-index', discoveryRateLimiter, async (_req, res, next) => {
  try {
    const businesses = await prisma.business.findMany({
      where: {
        active: true,
        ownerAddress: { not: null },
        benefitRules: { some: visibleCatalogRule },
      },
      orderBy: { id: 'asc' },
      take: 49_998,
      select: {
        id: true,
        createdAt: true,
        benefitRules: {
          where: visibleCatalogRule,
          orderBy: { updatedAt: 'desc' },
          take: 1,
          select: { updatedAt: true },
        },
      },
    });
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    res.json({
      catalogs: businesses.slice(0, 49_997).map((business) => ({
        businessId: business.id,
        lastModified: (business.benefitRules[0]?.updatedAt || business.createdAt).toISOString(),
      })),
      truncated: businesses.length > 49_997,
      urlLimit: 50_000,
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
        description: true,
        website: true,
        logoUrl: true,
        serviceArea: true,
        serviceAreaKey: true,
        categoriesJson: true,
        discountPercent: true,
        requiredLockIFR: true,
        tierLabel: true,
        active: true,
        ownerAddress: true,
      },
    });

    if (!business || !business.active || !business.ownerAddress) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const { ownerAddress: _ownerAddress, ...publicBusiness } = business;
    res.json(publicBusinessProfile(publicBusiness));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/rules', async (req, res, next) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.params.id },
      select: { id: true, active: true, ownerAddress: true },
    });

    if (!business || !business.active || !business.ownerAddress) {
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
        minIFRHeld: true,
        lockSource: true,
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
      select: {
        id: true,
        name: true,
        description: true,
        website: true,
        logoUrl: true,
        serviceArea: true,
        serviceAreaKey: true,
        categoriesJson: true,
        active: true,
        ownerAddress: true,
      },
    });
    if (!business || !business.active || !business.ownerAddress) {
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
        basePriceMinor: true,
        currency: true,
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
            minIFRHeld: true,
            lockSource: true,
            dailyRedemptionLimit: true,
            monthlyRedemptionLimit: true,
            ttlSeconds: true,
          },
        },
      },
    });
    res.json({
      business: publicBusinessProfile({
        id: business.id,
        name: business.name,
        description: business.description,
        website: business.website,
        logoUrl: business.logoUrl,
        serviceArea: business.serviceArea,
        serviceAreaKey: business.serviceAreaKey,
        categoriesJson: business.categoriesJson,
      }),
      products: products.map((product) => ({
        ...product,
        ...safeProductPrice(product),
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
