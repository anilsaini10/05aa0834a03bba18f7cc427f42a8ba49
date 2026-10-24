import { Router } from 'express';
import * as c from './subscriptions.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

// ── Buyers: school ADMIN, TEACHER, PARENT ────────────────────
// Mounted at /api/subscription.
export const subscriptionRouter = Router();
subscriptionRouter.use(authGuard, roleGuard('ADMIN', 'TEACHER', 'PARENT'));

subscriptionRouter.get('/entitlements',                              c.entitlementsHandler);
subscriptionRouter.get('/plans',                                     c.availablePlansHandler);
subscriptionRouter.post('/subscribe',                                c.subscribeHandler);
subscriptionRouter.get('/my-subscriptions',                          c.listMySubscriptionsHandler);
subscriptionRouter.get('/my-subscriptions/:subscriptionId',          c.getMySubscriptionHandler);
subscriptionRouter.post('/my-subscriptions/:subscriptionId/cancel',  c.cancelMySubscriptionHandler);

// ── SUPER_ADMIN ───────────────────────────────────────────────
// Mounted at /api/super-admin/subscription.
export const superAdminSubscriptionRouter = Router();
superAdminSubscriptionRouter.use(authGuard, roleGuard('SUPER_ADMIN'));

superAdminSubscriptionRouter.get('/features',                c.listFeaturesHandler);
superAdminSubscriptionRouter.post('/features',               c.createFeatureHandler);
superAdminSubscriptionRouter.patch('/features/:featureId',   c.updateFeatureHandler);
superAdminSubscriptionRouter.delete('/features/:featureId',  c.deleteFeatureHandler);

superAdminSubscriptionRouter.get('/plans',                   c.listPlansHandler);
superAdminSubscriptionRouter.post('/plans',                  c.createPlanHandler);
superAdminSubscriptionRouter.get('/plans/:planId',           c.getPlanHandler);
superAdminSubscriptionRouter.patch('/plans/:planId',         c.updatePlanHandler);
superAdminSubscriptionRouter.delete('/plans/:planId',        c.deletePlanHandler);

superAdminSubscriptionRouter.put('/plans/:planId/features',                   c.setPlanFeaturesHandler);
superAdminSubscriptionRouter.post('/plans/:planId/features',                  c.addPlanFeaturesHandler);
superAdminSubscriptionRouter.delete('/plans/:planId/features/:planFeatureId', c.removePlanFeatureHandler);

superAdminSubscriptionRouter.post('/plans/:planId/prices',             c.addPriceHandler);
superAdminSubscriptionRouter.patch('/plans/:planId/prices/:priceId',   c.updatePriceHandler);
superAdminSubscriptionRouter.delete('/plans/:planId/prices/:priceId',  c.deletePriceHandler);

superAdminSubscriptionRouter.get('/subscriptions',                           c.listAllSubscriptionsHandler);
superAdminSubscriptionRouter.get('/subscriptions/:subscriptionId',           c.getSubscriptionHandler);
superAdminSubscriptionRouter.post('/subscriptions/:subscriptionId/activate', c.activateSubscriptionHandler);
superAdminSubscriptionRouter.post('/subscriptions/:subscriptionId/cancel',   c.cancelSubscriptionHandler);
