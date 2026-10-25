import { Request, Response, NextFunction } from 'express';
import { checkFeatureAccess } from '../features/subscriptions/subscriptions.service';

// Locks a route behind a paid feature. Use after authGuard:
//   router.get('/homework', authGuard, roleGuard('PARENT'), requireFeature('homework'), handler);
// A feature that doesn't exist, is inactive, free, or not meant for the
// caller's role never blocks. Locked → 402 PAYMENT_REQUIRED with a reason
// (NEVER_SUBSCRIBED / PENDING_PAYMENT / EXPIRED) so the app can show the
// right "Subscribe" / "Renew" prompt.
export const requireFeature = (featureKey: string) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await checkFeatureAccess((req as any).user, featureKey);
      if (result.allowed) {
        next();
        return;
      }
      res.status(402).json({
        success: false,
        error: {
          message: 'This feature needs an active subscription',
          code:    'PAYMENT_REQUIRED',
          details: { feature: featureKey, reason: result.reason },
        },
      });
    } catch (err) {
      next(err);
    }
  };
