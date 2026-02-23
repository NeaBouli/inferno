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

export default router;
