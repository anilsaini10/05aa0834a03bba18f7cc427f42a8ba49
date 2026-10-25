import { z } from 'zod';
import { IntervalUnit, PlanScope, PlanType, SubscriberType } from '@prisma/client';
import { SUBSCRIBER_ROLES, SUBSCRIPTION_STATUS_VALUES } from '../../constants';

const role = z.enum(SUBSCRIBER_ROLES, {
  errorMap: () => ({ message: `role must be one of: ${SUBSCRIBER_ROLES.join(', ')}` }),
});

const boolQuery = z.enum(['true', 'false']).transform(v => v === 'true');

// ════════════════════════════════════════════════════════════
// SUPER_ADMIN — features
// ════════════════════════════════════════════════════════════

export const createFeatureSchema = z.object({
  key:         z.string({ required_error: 'key is required' }).trim().toLowerCase()
                 .regex(/^[a-z][a-z0-9_]{1,49}$/, 'key must be 2-50 chars: lowercase letters, digits, underscore (e.g. homework, ad_free)'),
  name:        z.string({ required_error: 'name is required' }).trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  isPaid:      z.boolean().default(true),
  roles:       z.array(role).min(1, 'Pick at least one role').transform(r => [...new Set(r)]),
  isActive:    z.boolean().default(true),
});

// key is immutable — code refers to it.
export const updateFeatureSchema = createFeatureSchema.omit({ key: true }).partial()
  .refine(d => Object.keys(d).length > 0, { message: 'Nothing to update' });

export const listFeaturesQuerySchema = z.object({
  role:     role.optional(),
  isPaid:   boolQuery.optional(),
  isActive: boolQuery.optional(),
  search:   z.string().trim().min(1).optional(),
});

// ════════════════════════════════════════════════════════════
// SUPER_ADMIN — plans, plan features, prices
// ════════════════════════════════════════════════════════════

// role omitted → SELF plan: the plan's targetRole; SCHOOL plan: every
// role the feature applies to.
const planFeatureInput = z.object({
  featureId: z.string().uuid('Invalid feature id'),
  role:      role.optional(),
});

export const priceInputSchema = z.object({
  label:         z.string().trim().max(50).nullable().optional(),
  intervalUnit:  z.nativeEnum(IntervalUnit, { errorMap: () => ({ message: 'intervalUnit must be DAY, MONTH or YEAR' }) }),
  intervalCount: z.number().int().min(1).max(365),
  // Paise (₹499 → 49900).
  amount:        z.number().int().min(0, 'amount cannot be negative'),
  currency:      z.string().trim().toUpperCase().length(3).default('INR'),
  isActive:      z.boolean().default(true),
});

export const createPlanSchema = z.object({
  code:        z.string({ required_error: 'code is required' }).trim().toUpperCase()
                 .regex(/^[A-Z0-9_]{2,40}$/, 'code must be 2-40 chars: letters, digits, underscore'),
  name:        z.string({ required_error: 'name is required' }).trim().min(1).max(100),
  description: z.string().trim().max(1000).nullable().optional(),
  scope:       z.nativeEnum(PlanScope).default('SELF'),
  planType:    z.nativeEnum(PlanType).default('BASE'),
  targetRole:  role,
  schoolId:    z.string().uuid('Invalid school id').nullable().optional(),
  sortOrder:   z.number().int().default(0),
  isActive:    z.boolean().default(true),
  features:    z.array(planFeatureInput).default([]),
  prices:      z.array(priceInputSchema).default([]),
}).refine(p => p.scope !== 'SCHOOL' || p.targetRole === 'ADMIN', {
  message: 'A SCHOOL plan is bought by the school ADMIN — targetRole must be ADMIN', path: ['targetRole'],
});

export const updatePlanSchema = z.object({
  name:        z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  scope:       z.nativeEnum(PlanScope).optional(),
  planType:    z.nativeEnum(PlanType).optional(),
  targetRole:  role.optional(),
  schoolId:    z.string().uuid('Invalid school id').nullable().optional(),
  sortOrder:   z.number().int().optional(),
  isActive:    z.boolean().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Nothing to update' });

export const listPlansQuerySchema = z.object({
  role:     role.optional(),
  scope:    z.nativeEnum(PlanScope).optional(),
  planType: z.nativeEnum(PlanType).optional(),
  isActive: boolQuery.optional(),
  // "global" → plans offered to every school.
  schoolId: z.union([z.literal('global'), z.string().uuid('Invalid school id')]).optional(),
  search:   z.string().trim().min(1).optional(),
});

export const setPlanFeaturesSchema = z.object({
  features: z.array(planFeatureInput),
});

export const addPlanFeaturesSchema = z.object({
  features: z.array(planFeatureInput).min(1, 'Send at least one feature'),
});

export const updatePriceSchema = z.object({
  label:    z.string().trim().max(50).nullable().optional(),
  amount:   z.number().int().min(0, 'amount cannot be negative').optional(),
  isActive: z.boolean().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Nothing to update' });

// ════════════════════════════════════════════════════════════
// SUPER_ADMIN — subscriptions
// ════════════════════════════════════════════════════════════

export const listAllSubscriptionsQuerySchema = z.object({
  page:           z.coerce.number().int().positive().default(1),
  pageSize:       z.coerce.number().int().positive().max(100).default(20),
  status:         z.enum(SUBSCRIPTION_STATUS_VALUES).optional(),
  schoolId:       z.string().uuid('Invalid school id').optional(),
  planId:         z.string().uuid('Invalid plan id').optional(),
  role:           role.optional(),
  subscriberType: z.nativeEnum(SubscriberType).optional(),
  search:         z.string().trim().min(1).optional(),   // buyer name / email / phone
});

// Marks the pending payment as received (offline / manual).
export const activateSubscriptionSchema = z.object({
  reference: z.string().trim().max(100).nullable().optional(),   // UTR, cheque no., …
  note:      z.string().trim().max(500).nullable().optional(),
});

export const cancelSubscriptionSchema = z.object({
  note: z.string().trim().max(500).nullable().optional(),
});

// ════════════════════════════════════════════════════════════
// ADMIN / TEACHER / PARENT
// ════════════════════════════════════════════════════════════

export const subscribeSchema = z.object({
  planPriceId: z.string({ required_error: 'planPriceId is required' }).uuid('Invalid plan price id'),
});

// Fields Razorpay Checkout hands the app in its success handler.
export const verifyRazorpayPaymentSchema = z.object({
  razorpay_order_id:   z.string({ required_error: 'razorpay_order_id is required' }).trim().min(1, 'razorpay_order_id is required'),
  razorpay_payment_id: z.string({ required_error: 'razorpay_payment_id is required' }).trim().min(1, 'razorpay_payment_id is required'),
  razorpay_signature:  z.string({ required_error: 'razorpay_signature is required' }).trim().min(1, 'razorpay_signature is required'),
});

export const listMySubscriptionsQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(10),
  status:   z.enum(SUBSCRIPTION_STATUS_VALUES).optional(),
});

export type CreateFeatureSchema              = z.infer<typeof createFeatureSchema>;
export type UpdateFeatureSchema              = z.infer<typeof updateFeatureSchema>;
export type ListFeaturesQuerySchema          = z.infer<typeof listFeaturesQuerySchema>;
export type PlanFeatureInput                 = z.infer<typeof planFeatureInput>;
export type PriceInputSchema                 = z.infer<typeof priceInputSchema>;
export type CreatePlanSchema                 = z.infer<typeof createPlanSchema>;
export type UpdatePlanSchema                 = z.infer<typeof updatePlanSchema>;
export type ListPlansQuerySchema             = z.infer<typeof listPlansQuerySchema>;
export type UpdatePriceSchema                = z.infer<typeof updatePriceSchema>;
export type ListAllSubscriptionsQuerySchema  = z.infer<typeof listAllSubscriptionsQuerySchema>;
export type ActivateSubscriptionSchema       = z.infer<typeof activateSubscriptionSchema>;
export type CancelSubscriptionSchema         = z.infer<typeof cancelSubscriptionSchema>;
export type SubscribeSchema                  = z.infer<typeof subscribeSchema>;
export type VerifyRazorpayPaymentSchema      = z.infer<typeof verifyRazorpayPaymentSchema>;
export type ListMySubscriptionsQuerySchema   = z.infer<typeof listMySubscriptionsQuerySchema>;
