import { Prisma, PlanScope, Role } from '@prisma/client';
import { prisma } from '../../config/db';
import { durationLabel, liveSubscriptionWhere } from '../../shared/utils/subscriptionStatus';
import {
  CreateFeatureSchema,
  UpdateFeatureSchema,
  ListFeaturesQuerySchema,
  PlanFeatureInput,
  PriceInputSchema,
  CreatePlanSchema,
  UpdatePlanSchema,
  ListPlansQuerySchema,
  UpdatePriceSchema,
} from './subscriptions.validation';

export const appError = (message: string, code: string, statusCode: number, details?: Record<string, unknown>) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = statusCode;
  if (details) err.details = details;
  return err;
};

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

const featureNotFound = () => appError('Feature not found', 'FEATURE_NOT_FOUND', 404);
const planNotFound    = () => appError('Plan not found', 'PLAN_NOT_FOUND', 404);
const priceNotFound   = () => appError('Plan price not found', 'PLAN_PRICE_NOT_FOUND', 404);

// ── Response shapes ───────────────────────────────────────────
export const PLAN_INCLUDE = {
  school:   { select: { id: true, name: true } },
  features: { include: { feature: true }, orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] },
  prices:   { orderBy: [{ intervalUnit: 'asc' }, { intervalCount: 'asc' }] },
} satisfies Prisma.SubscriptionPlanInclude;

export type PlanWithRefs = Prisma.SubscriptionPlanGetPayload<{ include: typeof PLAN_INCLUDE }>;
type PriceRow = PlanWithRefs['prices'][number];

export const toPriceItem = (p: PriceRow) => ({
  id:            p.id,
  label:         p.label ?? durationLabel(p.intervalUnit, p.intervalCount),
  intervalUnit:  p.intervalUnit,
  intervalCount: p.intervalCount,
  duration:      durationLabel(p.intervalUnit, p.intervalCount),
  amount:        p.amount,
  currency:      p.currency,
  isActive:      p.isActive,
});

export const toPlanItem = (p: PlanWithRefs) => ({
  id:          p.id,
  code:        p.code,
  name:        p.name,
  description: p.description,
  scope:       p.scope,
  planType:    p.planType,
  targetRole:  p.targetRole,
  school:      p.school,
  sortOrder:   p.sortOrder,
  isActive:    p.isActive,
  features: p.features.map(pf => ({
    planFeatureId: pf.id,
    featureId:     pf.featureId,
    key:           pf.feature.key,
    name:          pf.feature.name,
    description:   pf.feature.description,
    isPaid:        pf.feature.isPaid,
    isActive:      pf.feature.isActive,
    role:          pf.role,
  })),
  prices:    p.prices.map(toPriceItem),
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

const toFeatureItem = (f: Prisma.FeatureGetPayload<{ include: { _count: { select: { plans: true } } } }>) => ({
  id:          f.id,
  key:         f.key,
  name:        f.name,
  description: f.description,
  isPaid:      f.isPaid,
  roles:       f.roles,
  isActive:    f.isActive,
  planCount:   f._count.plans,
  createdAt:   f.createdAt,
  updatedAt:   f.updatedAt,
});

// ════════════════════════════════════════════════════════════
// Features
// ════════════════════════════════════════════════════════════

export const listFeatures = async (query: ListFeaturesQuerySchema) => {
  const features = await prisma.feature.findMany({
    where: {
      ...(query.role     !== undefined ? { roles: { has: query.role } } : {}),
      ...(query.isPaid   !== undefined ? { isPaid: query.isPaid }       : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive }   : {}),
      ...(query.search ? {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { key:  { contains: query.search, mode: 'insensitive' } },
        ],
      } : {}),
    },
    include: { _count: { select: { plans: true } } },
    orderBy: { name: 'asc' },
  });
  return features.map(toFeatureItem);
};

export const createFeature = async (input: CreateFeatureSchema) => {
  try {
    const f = await prisma.feature.create({
      data:    { ...input, description: input.description ?? null },
      include: { _count: { select: { plans: true } } },
    });
    return toFeatureItem(f);
  } catch (err) {
    if (isUniqueViolation(err)) throw appError(`Feature key "${input.key}" already exists`, 'FEATURE_KEY_EXISTS', 409);
    throw err;
  }
};

export const updateFeature = async (featureId: string, input: UpdateFeatureSchema) => {
  const existing = await prisma.feature.findUnique({ where: { id: featureId } });
  if (!existing) throw featureNotFound();

  // Dropping a role the feature is already sold to would orphan plan rows.
  if (input.roles) {
    const orphaned = await prisma.planFeature.findMany({
      where:   { featureId, role: { notIn: input.roles } },
      include: { plan: { select: { code: true } } },
    });
    if (orphaned.length) {
      throw appError('Remove this feature from these plans first, or keep the role', 'FEATURE_ROLE_IN_USE', 409, {
        usages: orphaned.map(o => ({ planCode: o.plan.code, role: o.role })),
      });
    }
  }

  const f = await prisma.feature.update({
    where:   { id: featureId },
    data:    input,
    include: { _count: { select: { plans: true } } },
  });
  return toFeatureItem(f);
};

export const deleteFeature = async (featureId: string) => {
  const f = await prisma.feature.findUnique({ where: { id: featureId }, include: { _count: { select: { plans: true } } } });
  if (!f) throw featureNotFound();
  if (f._count.plans > 0) {
    throw appError('Feature is used in plans — remove it from them or set isActive: false', 'FEATURE_IN_USE', 409, {
      planCount: f._count.plans,
    });
  }
  await prisma.feature.delete({ where: { id: featureId } });
  return { deleted: true };
};

// ════════════════════════════════════════════════════════════
// Plans
// ════════════════════════════════════════════════════════════

// Turns { featureId, role? } inputs into concrete plan_features rows,
// checking every feature exists and applies to the role it's given for.
const resolvePlanFeatures = async (
  plan: { scope: PlanScope; targetRole: Role },
  inputs: PlanFeatureInput[],
): Promise<{ featureId: string; role: Role }[]> => {
  if (!inputs.length) return [];

  const ids      = [...new Set(inputs.map(i => i.featureId))];
  const features = await prisma.feature.findMany({ where: { id: { in: ids } } });
  const byId     = new Map(features.map(f => [f.id, f]));

  const missing = ids.filter(id => !byId.has(id));
  if (missing.length) throw appError('Some features were not found', 'FEATURE_NOT_FOUND', 404, { featureIds: missing });

  const rows = new Map<string, { featureId: string; role: Role }>();
  for (const input of inputs) {
    const feature = byId.get(input.featureId)!;
    const roles: Role[] = input.role
      ? [input.role]
      : plan.scope === 'SELF' ? [plan.targetRole] : feature.roles;

    for (const role of roles) {
      if (plan.scope === 'SELF' && role !== plan.targetRole) {
        throw appError(`A SELF plan for ${plan.targetRole} can only give features to ${plan.targetRole}`, 'FEATURE_ROLE_MISMATCH', 400, {
          featureKey: feature.key, role,
        });
      }
      if (!feature.roles.includes(role)) {
        throw appError(`Feature "${feature.key}" does not apply to ${role}`, 'FEATURE_ROLE_MISMATCH', 400, {
          featureKey: feature.key, role, featureRoles: feature.roles,
        });
      }
      rows.set(`${feature.id}:${role}`, { featureId: feature.id, role });
    }
  }
  return [...rows.values()];
};

const assertSchoolExists = async (schoolId: string | null | undefined) => {
  if (!schoolId) return;
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
  if (!school) throw appError('School not found', 'SCHOOL_NOT_FOUND', 404);
};

const subscriptionCounts = async (planIds: string[]) => {
  if (!planIds.length) return new Map<string, { live: number; total: number }>();
  const [live, total] = await Promise.all([
    prisma.subscription.groupBy({ by: ['planId'], where: { planId: { in: planIds }, ...liveSubscriptionWhere() }, _count: { _all: true } }),
    prisma.subscription.groupBy({ by: ['planId'], where: { planId: { in: planIds } }, _count: { _all: true } }),
  ]);
  return new Map(planIds.map(id => [id, {
    live:  live.find(l => l.planId === id)?._count._all ?? 0,
    total: total.find(t => t.planId === id)?._count._all ?? 0,
  }]));
};

const toSuperAdminPlanItem = (p: PlanWithRefs, counts?: { live: number; total: number }) => ({
  ...toPlanItem(p),
  liveSubscriptions:  counts?.live ?? 0,
  totalSubscriptions: counts?.total ?? 0,
});

const loadPlan = async (planId: string) => {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE });
  if (!plan) throw planNotFound();
  return plan;
};

const planResponse = async (planId: string) => {
  const plan   = await loadPlan(planId);
  const counts = await subscriptionCounts([planId]);
  return toSuperAdminPlanItem(plan, counts.get(planId));
};

export const listPlans = async (query: ListPlansQuerySchema) => {
  const plans = await prisma.subscriptionPlan.findMany({
    where: {
      ...(query.role     ? { targetRole: query.role }   : {}),
      ...(query.scope    ? { scope: query.scope }       : {}),
      ...(query.planType ? { planType: query.planType } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.schoolId ? { schoolId: query.schoolId === 'global' ? null : query.schoolId } : {}),
      ...(query.search ? {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { code: { contains: query.search, mode: 'insensitive' } },
        ],
      } : {}),
    },
    include: PLAN_INCLUDE,
    orderBy: [{ targetRole: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  const counts = await subscriptionCounts(plans.map(p => p.id));
  return plans.map(p => toSuperAdminPlanItem(p, counts.get(p.id)));
};

export const getPlan = (planId: string) => planResponse(planId);

export const createPlan = async (input: CreatePlanSchema) => {
  await assertSchoolExists(input.schoolId);
  const featureRows = await resolvePlanFeatures(input, input.features);

  const priceKeys = new Set(input.prices.map(p => `${p.intervalUnit}:${p.intervalCount}`));
  if (priceKeys.size !== input.prices.length) {
    throw appError('Two prices have the same duration', 'DUPLICATE_PRICE', 400);
  }

  try {
    const plan = await prisma.subscriptionPlan.create({
      data: {
        code:        input.code,
        name:        input.name,
        description: input.description ?? null,
        scope:       input.scope,
        planType:    input.planType,
        targetRole:  input.targetRole,
        schoolId:    input.schoolId ?? null,
        sortOrder:   input.sortOrder,
        isActive:    input.isActive,
        features:    { create: featureRows },
        prices:      { create: input.prices.map(p => ({ ...p, label: p.label ?? null })) },
      },
    });
    return planResponse(plan.id);
  } catch (err) {
    if (isUniqueViolation(err)) throw appError(`Plan code "${input.code}" already exists`, 'PLAN_CODE_EXISTS', 409);
    throw err;
  }
};

export const updatePlan = async (planId: string, input: UpdatePlanSchema) => {
  const existing = await loadPlan(planId);
  await assertSchoolExists(input.schoolId);

  const scope      = input.scope      ?? existing.scope;
  const targetRole = input.targetRole ?? existing.targetRole;

  if (scope !== existing.scope || targetRole !== existing.targetRole) {
    if (scope === 'SCHOOL' && targetRole !== 'ADMIN') {
      throw appError('A SCHOOL plan is bought by the school ADMIN — targetRole must be ADMIN', 'VALIDATION_ERROR', 400);
    }
    const subs = await prisma.subscription.count({ where: { planId } });
    if (subs > 0) {
      throw appError('scope/targetRole cannot change once the plan has subscriptions — create a new plan instead', 'PLAN_IN_USE', 409);
    }
    if (scope === 'SELF' && existing.features.some(f => f.role !== targetRole)) {
      throw appError(`Some features are given to roles other than ${targetRole} — update the plan's features first`, 'FEATURE_ROLE_MISMATCH', 400);
    }
  }

  await prisma.subscriptionPlan.update({ where: { id: planId }, data: input });
  return planResponse(planId);
};

export const deletePlan = async (planId: string) => {
  await loadPlan(planId);
  const subs = await prisma.subscription.count({ where: { planId } });
  if (subs > 0) {
    throw appError('Plan has subscriptions — set isActive: false to stop selling it', 'PLAN_IN_USE', 409, { subscriptionCount: subs });
  }
  await prisma.subscriptionPlan.delete({ where: { id: planId } });
  return { deleted: true };
};

// ── Plan features ─────────────────────────────────────────────

// PUT — the sent list becomes the plan's complete feature list.
export const setPlanFeatures = async (planId: string, inputs: PlanFeatureInput[]) => {
  const plan = await loadPlan(planId);
  const rows = await resolvePlanFeatures(plan, inputs);

  await prisma.$transaction([
    prisma.planFeature.deleteMany({ where: { planId } }),
    prisma.planFeature.createMany({ data: rows.map(r => ({ ...r, planId })) }),
  ]);
  return planResponse(planId);
};

// POST — adds to the existing list; already-present ones are skipped.
export const addPlanFeatures = async (planId: string, inputs: PlanFeatureInput[]) => {
  const plan = await loadPlan(planId);
  const rows = await resolvePlanFeatures(plan, inputs);

  await prisma.planFeature.createMany({ data: rows.map(r => ({ ...r, planId })), skipDuplicates: true });
  return planResponse(planId);
};

export const removePlanFeature = async (planId: string, planFeatureId: string) => {
  const { count } = await prisma.planFeature.deleteMany({ where: { id: planFeatureId, planId } });
  if (!count) throw appError('Feature is not on this plan', 'PLAN_FEATURE_NOT_FOUND', 404);
  return planResponse(planId);
};

// ── Prices ────────────────────────────────────────────────────

export const addPrice = async (planId: string, input: PriceInputSchema) => {
  await loadPlan(planId);
  try {
    await prisma.planPrice.create({ data: { ...input, label: input.label ?? null, planId } });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw appError(`This plan already has a ${durationLabel(input.intervalUnit, input.intervalCount)} price`, 'DUPLICATE_PRICE', 409);
    }
    throw err;
  }
  return planResponse(planId);
};

// Duration is immutable — subscriptions point at the price row. Add a new
// price and deactivate this one instead.
export const updatePrice = async (planId: string, priceId: string, input: UpdatePriceSchema) => {
  const price = await prisma.planPrice.findFirst({ where: { id: priceId, planId } });
  if (!price) throw priceNotFound();
  await prisma.planPrice.update({ where: { id: priceId }, data: input });
  return planResponse(planId);
};

export const deletePrice = async (planId: string, priceId: string) => {
  const price = await prisma.planPrice.findFirst({ where: { id: priceId, planId }, include: { _count: { select: { subscriptions: true } } } });
  if (!price) throw priceNotFound();
  if (price._count.subscriptions > 0) {
    throw appError('Price has subscriptions — set isActive: false to stop selling it', 'PLAN_PRICE_IN_USE', 409);
  }
  await prisma.planPrice.delete({ where: { id: priceId } });
  return planResponse(planId);
};
