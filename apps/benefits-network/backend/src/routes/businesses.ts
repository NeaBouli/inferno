import { Router } from 'express';
import { prisma } from '../services/sessionService';

const router = Router();

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
