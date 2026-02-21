import { Request, Response } from 'express';
import prisma from '../utils/prisma';

export const getActivePromos = async (req: Request, res: Response): Promise<void> => {
  try {
    const timeoutMs = 15000;
    const queryPromise = prisma.monthlyPromo.findMany({
      where: {
        isActive: true,
        offerEnds: {
          gte: new Date(),
        },
      },
      include: {
        stylePricing: {
          include: {
            style: true,
            category: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
    );
    const promos = await Promise.race([queryPromise, timeoutPromise]);
    res.json(promos);
  } catch (error) {
    console.error('Error fetching promos:', error);
    res.status(500).json({ message: 'Error fetching promos' });
  }
};

export const getAllPromos = async (req: Request, res: Response): Promise<void> => {
  try {
    const promos = await prisma.monthlyPromo.findMany({
      include: {
        stylePricing: {
          include: {
            style: true,
            category: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 200,
    });
    res.json(promos);
  } catch (error) {
    console.error('Error fetching all promos:', error);
    res.status(500).json({ message: 'Error fetching all promos' });
  }
};

// Admin: Create promo
export const createPromo = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      title,
      promoMonth,
      promoYear,
      offerEnds,
      stylePricingId,
      promoPrice,
      discountPercentage,
      promoDuration,
      description,
      terms,
    } = req.body;

    const promo = await prisma.monthlyPromo.create({
      data: {
        title,
        promoMonth,
        promoYear: parseInt(promoYear),
        offerEnds: new Date(offerEnds),
        stylePricingId,
        promoPrice: parseFloat(promoPrice),
        discountPercentage: discountPercentage ? parseInt(discountPercentage) : null,
        promoDuration: promoDuration ? parseInt(promoDuration) : null,
        description,
        terms,
        isActive: true,
      },
    });

    res.status(201).json(promo);
  } catch (error) {
    console.error('Error creating promo:', error);
    res.status(500).json({ message: 'Error creating promo' });
  }
};

// Admin: Delete promo
export const deletePromo = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    await prisma.monthlyPromo.delete({
      where: { id },
    });
    res.json({ message: 'Promo deleted' });
  } catch (error) {
    console.error('Error deleting promo:', error);
    res.status(500).json({ message: 'Error deleting promo' });
  }
};

// Admin: Toggle status
export const togglePromoStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const promo = await prisma.monthlyPromo.findUnique({ where: { id } });
    if (!promo) {
      res.status(404).json({ message: 'Promo not found' });
      return;
    }

    const updated = await prisma.monthlyPromo.update({
      where: { id },
      data: { isActive: !promo.isActive },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error toggling promo status:', error);
    res.status(500).json({ message: 'Error toggling promo status' });
  }
};
