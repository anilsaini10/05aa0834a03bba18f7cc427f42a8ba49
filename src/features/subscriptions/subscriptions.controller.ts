import { Request, Response, NextFunction } from 'express';
import * as plansService from './plans.service';
import * as subscriptionsService from './subscriptions.service';
import {
  createFeatureSchema,
  updateFeatureSchema,
  listFeaturesQuerySchema,
  createPlanSchema,
  updatePlanSchema,
  listPlansQuerySchema,
  setPlanFeaturesSchema,
  addPlanFeaturesSchema,
  priceInputSchema,
  updatePriceSchema,
  listAllSubscriptionsQuerySchema,
  activateSubscriptionSchema,
  cancelSubscriptionSchema,
  subscribeSchema,
  listMySubscriptionsQuerySchema,
  verifyRazorpayPaymentSchema,
} from './subscriptions.validation';
import { sendSuccess } from '../../shared/utils/apiResponse';

const userOf = (req: Request): subscriptionsService.RequestUser => (req as any).user;

// Wraps an async handler: result → sendSuccess, errors → next().
const handle = (fn: (req: Request) => Promise<unknown>, statusCode = 200) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      sendSuccess(res, await fn(req), statusCode);
    } catch (err) {
      next(err);
    }
  };

// ── ADMIN / TEACHER / PARENT ─────────────────────────────────

export const entitlementsHandler        = handle(req => subscriptionsService.getEntitlements(userOf(req)));
export const availablePlansHandler      = handle(req => subscriptionsService.listAvailablePlans(userOf(req)));
export const subscribeHandler           = handle(req => subscriptionsService.subscribe(userOf(req), subscribeSchema.parse(req.body)), 201);
export const listMySubscriptionsHandler = handle(req => subscriptionsService.listMySubscriptions(userOf(req), listMySubscriptionsQuerySchema.parse(req.query)));
export const getMySubscriptionHandler   = handle(req => subscriptionsService.getMySubscription(userOf(req), req.params.subscriptionId));
export const cancelMySubscriptionHandler = handle(req => subscriptionsService.cancelMyPendingSubscription(userOf(req), req.params.subscriptionId));
export const createRazorpayOrderHandler   = handle(req => subscriptionsService.createRazorpayOrder(userOf(req), req.params.subscriptionId), 201);
export const verifyRazorpayPaymentHandler = handle(req => subscriptionsService.verifyRazorpayPayment(userOf(req), req.params.subscriptionId, verifyRazorpayPaymentSchema.parse(req.body ?? {})));

// ── SUPER_ADMIN: features ─────────────────────────────────────

export const listFeaturesHandler  = handle(req => plansService.listFeatures(listFeaturesQuerySchema.parse(req.query)));
export const createFeatureHandler = handle(req => plansService.createFeature(createFeatureSchema.parse(req.body)), 201);
export const updateFeatureHandler = handle(req => plansService.updateFeature(req.params.featureId, updateFeatureSchema.parse(req.body)));
export const deleteFeatureHandler = handle(req => plansService.deleteFeature(req.params.featureId));

// ── SUPER_ADMIN: plans ────────────────────────────────────────

export const listPlansHandler  = handle(req => plansService.listPlans(listPlansQuerySchema.parse(req.query)));
export const getPlanHandler    = handle(req => plansService.getPlan(req.params.planId));
export const createPlanHandler = handle(req => plansService.createPlan(createPlanSchema.parse(req.body)), 201);
export const updatePlanHandler = handle(req => plansService.updatePlan(req.params.planId, updatePlanSchema.parse(req.body)));
export const deletePlanHandler = handle(req => plansService.deletePlan(req.params.planId));

export const setPlanFeaturesHandler   = handle(req => plansService.setPlanFeatures(req.params.planId, setPlanFeaturesSchema.parse(req.body).features));
export const addPlanFeaturesHandler   = handle(req => plansService.addPlanFeatures(req.params.planId, addPlanFeaturesSchema.parse(req.body).features));
export const removePlanFeatureHandler = handle(req => plansService.removePlanFeature(req.params.planId, req.params.planFeatureId));

export const addPriceHandler    = handle(req => plansService.addPrice(req.params.planId, priceInputSchema.parse(req.body)), 201);
export const updatePriceHandler = handle(req => plansService.updatePrice(req.params.planId, req.params.priceId, updatePriceSchema.parse(req.body)));
export const deletePriceHandler = handle(req => plansService.deletePrice(req.params.planId, req.params.priceId));

// ── SUPER_ADMIN: subscriptions ────────────────────────────────

export const listAllSubscriptionsHandler = handle(req => subscriptionsService.listAllSubscriptions(listAllSubscriptionsQuerySchema.parse(req.query)));
export const getSubscriptionHandler      = handle(req => subscriptionsService.getSubscriptionById(req.params.subscriptionId));
export const activateSubscriptionHandler = handle(req => subscriptionsService.activateSubscription(req.params.subscriptionId, {
  ...activateSubscriptionSchema.parse(req.body ?? {}),
  activatedBy: userOf(req).sub,
}));
export const cancelSubscriptionHandler = handle(req => subscriptionsService.cancelSubscription(req.params.subscriptionId, cancelSubscriptionSchema.parse(req.body ?? {})));
