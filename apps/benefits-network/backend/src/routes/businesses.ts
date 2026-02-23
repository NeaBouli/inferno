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

export default router;
