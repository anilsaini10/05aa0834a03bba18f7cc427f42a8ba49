import { Prisma, Role } from '@prisma/client';
import { prisma } from '../../config/db';
import {
  FEATURE_ACCESS_STATUS,
  FEATURE_LOCK_REASON,
  SUBSCRIPTION_EXPIRING_SOON_DAYS,
  SUBSCRIPTION_LIVE_STATUSES,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_STATUS_VALUES,
  FeatureLockReason,
} from '../../constants';
import {
  addInterval,
  computeSubscriptionStatus,
  daysLeft,
  durationLabel,
  liveSubscriptionWhere,
  subscriptionStatusWhere,
} from '../../shared/utils/subscriptionStatus';
import { getRazorpay, getRazorpayKeyId, isValidCheckoutSignature, toGatewayError } from '../../config/razorpay';
import { appError, isUniqueViolation, PLAN_INCLUDE, PlanWithRefs, toPlanItem } from './plans.service';
import {
  ActivateSubscriptionSchema,
  CancelSubscriptionSchema,
  ListAllSubscriptionsQuerySchema,
  ListMySubscriptionsQuerySchema,
  SubscribeSchema,
  VerifyRazorpayPaymentSchema,
} from './subscriptions.validation';

export interface RequestUser { sub: string; role: Role; schoolId: string | null }

const DAY_MS = 86_400_000;

// Razorpay rejects orders below ₹1.
const RAZORPAY_MIN_AMOUNT = 100;

const subscriptionNotFound = () => appError('Subscription not found', 'SUBSCRIPTION_NOT_FOUND', 404);

const requireSchool = (user: RequestUser): string => {
  if (!user.schoolId) throw appError('Your account is not linked to a school', 'FORBIDDEN', 403);
  return user.schoolId;
};

const paginate = <T>(items: T[], page: number, pageSize: number, total: number) => ({
  items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)),
});

// Subscriptions whose features can reach this user: their own, plus the
// school's (a SCHOOL plan only gives what it lists for the user's role).
const reachableSubscriptionsWhere = (user: RequestUser, schoolId: string): Prisma.SubscriptionWhereInput => ({
  OR: [
    { subscriberType: 'USER',   userId: user.sub },
    { subscriberType: 'SCHOOL', schoolId },
  ],
});

// Subscriptions this user bought / manages: their own, plus the school's
// for an ADMIN.
const ownedSubscriptionsWhere = (user: RequestUser, schoolId: string): Prisma.SubscriptionWhereInput =>
  user.role === 'ADMIN'
    ? reachableSubscriptionsWhere(user, schoolId)
    : { subscriberType: 'USER', userId: user.sub };

// ── Response shapes ───────────────────────────────────────────
const SUB_INCLUDE = {
  plan:            { select: { id: true, code: true, name: true, scope: true, planType: true } },
  user:            { select: { id: true, name: true, email: true, phone: true } },
  school:          { select: { id: true, name: true } },
  paidByUser:      { select: { id: true, name: true, email: true, phone: true } },
  activatedByUser: { select: { id: true, name: true } },
  payments:        { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.SubscriptionInclude;

type SubWithRefs = Prisma.SubscriptionGetPayload<{ include: typeof SUB_INCLUDE }>;

const toPaymentItem = (p: SubWithRefs['payments'][number]) => ({
  id:               p.id,
  amount:           p.amount,
  currency:         p.currency,
  status:           p.status,
  gateway:          p.gateway,
  gatewayOrderId:   p.gatewayOrderId,
  gatewayPaymentId: p.gatewayPaymentId,
  reference:        p.reference,
  paidAt:           p.paidAt,
  createdAt:        p.createdAt,
});

const toSubscriptionItem = (s: SubWithRefs, now = new Date()) => ({
  id:             s.id,
  status:         computeSubscriptionStatus(s, now),
  subscriberType: s.subscriberType,
  plan:           s.plan,
  price: {
    planPriceId:   s.planPriceId,
    amount:        s.amount,
    currency:      s.currency,
    intervalUnit:  s.intervalUnit,
    intervalCount: s.intervalCount,
    duration:      durationLabel(s.intervalUnit, s.intervalCount),
  },
  startDate:   s.startDate,
  endDate:     s.endDate,
  daysLeft:    SUBSCRIPTION_LIVE_STATUSES.includes(computeSubscriptionStatus(s, now)) ? daysLeft(s.endDate, now) : null,
  paidBy:      { id: s.paidByUser.id, name: s.paidByUser.name },
  payments:    s.payments.map(toPaymentItem),
  activatedAt: s.activatedAt,
  cancelledAt: s.cancelledAt,
  createdAt:   s.createdAt,
});

const toSuperAdminSubscriptionItem = (s: SubWithRefs, now = new Date()) => ({
  ...toSubscriptionItem(s, now),
  role:        s.role,
  user:        s.user,
  school:      s.school,
  paidBy:      s.paidByUser,
  activatedBy: s.activatedByUser,
  note:        s.note,
});

// ════════════════════════════════════════════════════════════
// Access context — every ACTIVE/PENDING subscription that can reach the
// user, with the plan features it gives the user's role.
// ════════════════════════════════════════════════════════════

const loadAccessContext = async (user: RequestUser, schoolId: string, now: Date) => {
  const subs = await prisma.subscription.findMany({
    where: { status: { in: ['ACTIVE', 'PENDING'] }, ...reachableSubscriptionsWhere(user, schoolId) },
    include: {
      plan: {
        select: {
          id: true, code: true, name: true, scope: true, planType: true,
          features: { where: { role: user.role }, select: { featureId: true } },
        },
      },
    },
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
  });

  const withStatus = subs.map(s => ({
    ...s,
    computed:   computeSubscriptionStatus(s, now),
    featureIds: new Set(s.plan.features.map(f => f.featureId)),
  }));
  type Sub = (typeof withStatus)[number];

  const covering = (featureId: string) => withStatus.filter(s => s.featureIds.has(featureId));
  const isLive   = (s: Sub) => SUBSCRIPTION_LIVE_STATUSES.includes(s.computed);

  // Until when the feature stays unlocked: the latest live end date,
  // extended by already-paid renewals that start before it runs out.
  const accessFor = (featureId: string) => {
    const subsForFeature = covering(featureId);
    const live = subsForFeature.filter(isLive);
    if (!live.length) {
      const reason: FeatureLockReason =
        subsForFeature.some(s => s.computed === SUBSCRIPTION_STATUS.PENDING_PAYMENT) ? FEATURE_LOCK_REASON.PENDING_PAYMENT
        : subsForFeature.some(s => s.computed === SUBSCRIPTION_STATUS.EXPIRED)       ? FEATURE_LOCK_REASON.EXPIRED
        : FEATURE_LOCK_REASON.NEVER_SUBSCRIBED;
      return { live: false as const, reason };
    }

    let until = new Date(Math.max(...live.map(s => s.endDate!.getTime())));
    for (const u of subsForFeature.filter(s => s.computed === SUBSCRIPTION_STATUS.UPCOMING)) {
      if (u.startDate! <= until && u.endDate! > until) until = u.endDate!;
    }
    const sources = [...new Set(live.map(s => (s.subscriberType === 'SCHOOL' ? 'SCHOOL' : 'SELF')))];
    return { live: true as const, until, sources };
  };

  const coveredBySchool = (featureId: string) => {
    const a = accessFor(featureId);
    return a.live && a.sources.includes('SCHOOL');
  };

  return { subs: withStatus, accessFor, coveredBySchool };
};

// Plans this user may buy: active, for their role, offered to their
// school (or to every school), with at least one active price.
const purchasablePlans = (user: RequestUser, schoolId: string) =>
  prisma.subscriptionPlan.findMany({
    where: {
      isActive:   true,
      targetRole: user.role,
      OR:         [{ schoolId: null }, { schoolId }],
      prices:     { some: { isActive: true } },
    },
    include: {
      ...PLAN_INCLUDE,
      features: { ...PLAN_INCLUDE.features, where: { feature: { isActive: true } } },
      prices:   { ...PLAN_INCLUDE.prices,   where: { isActive: true } },
    },
    orderBy: [{ planType: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

const minPrice = (p: PlanWithRefs) => {
  const cheapest = [...p.prices].sort((a, b) => a.amount - b.amount)[0];
  return cheapest ? { amount: cheapest.amount, currency: cheapest.currency, duration: durationLabel(cheapest.intervalUnit, cheapest.intervalCount) } : null;
};

// ════════════════════════════════════════════════════════════
// ADMIN / TEACHER / PARENT
// ════════════════════════════════════════════════════════════

// ── GET /subscription/entitlements ────────────────────────────
// Every feature of the user's role with its access status — the app
// shows/locks screens from this.
export const getEntitlements = async (user: RequestUser) => {
  const schoolId = requireSchool(user);
  const now      = new Date();

  const [features, ctx, plans] = await Promise.all([
    prisma.feature.findMany({ where: { isActive: true, roles: { has: user.role } }, orderBy: { name: 'asc' } }),
    loadAccessContext(user, schoolId, now),
    purchasablePlans(user, schoolId),
  ]);

  const items = features.map(f => {
    const base = { featureId: f.id, key: f.key, name: f.name, description: f.description };
    if (!f.isPaid) return { ...base, status: FEATURE_ACCESS_STATUS.FREE, hasAccess: true };

    const access = ctx.accessFor(f.id);
    if (access.live) {
      const expiringSoon = access.until.getTime() - now.getTime() <= SUBSCRIPTION_EXPIRING_SOON_DAYS * DAY_MS;
      return {
        ...base,
        status:    expiringSoon ? FEATURE_ACCESS_STATUS.EXPIRING_SOON : FEATURE_ACCESS_STATUS.ACTIVE,
        hasAccess: true,
        sources:   access.sources,
        expiresAt: access.until,
        daysLeft:  daysLeft(access.until, now),
      };
    }
    return {
      ...base,
      status:      FEATURE_ACCESS_STATUS.PAYMENT_REQUIRED,
      hasAccess:   false,
      reason:      access.reason,
      availableIn: plans
        .filter(p => p.features.some(pf => pf.featureId === f.id && pf.role === user.role))
        .map(p => ({ planId: p.id, code: p.code, name: p.name, planType: p.planType, startingFrom: minPrice(p) })),
    };
  });

  return {
    role:     user.role,
    features: items,
    // Paid/pending subscriptions that currently matter to this user.
    subscriptions: ctx.subs
      .filter(s => s.computed !== SUBSCRIPTION_STATUS.EXPIRED)
      .map(s => ({
        id:             s.id,
        status:         s.computed,
        subscriberType: s.subscriberType,
        plan:           { id: s.plan.id, code: s.plan.code, name: s.plan.name, scope: s.plan.scope, planType: s.plan.planType },
        startDate:      s.startDate,
        endDate:        s.endDate,
        daysLeft:       SUBSCRIPTION_LIVE_STATUSES.includes(s.computed) ? daysLeft(s.endDate, now) : null,
      })),
  };
};

// ── GET /subscription/plans ───────────────────────────────────
// Plans the user can buy, each with what they already have of it.
export const listAvailablePlans = async (user: RequestUser) => {
  const schoolId = requireSchool(user);
  const now      = new Date();
  const [plans, ctx] = await Promise.all([purchasablePlans(user, schoolId), loadAccessContext(user, schoolId, now)]);

  // Priority when a plan has several subscriptions: live > pending >
  // upcoming > expired.
  const rank = (s: (typeof ctx.subs)[number]) =>
    SUBSCRIPTION_LIVE_STATUSES.includes(s.computed) ? 0
    : s.computed === SUBSCRIPTION_STATUS.PENDING_PAYMENT ? 1
    : s.computed === SUBSCRIPTION_STATUS.UPCOMING ? 2 : 3;

  return plans.map(p => {
    const item = toPlanItem(p);
    const subscriberType = p.scope === 'SCHOOL' ? 'SCHOOL' : 'USER';

    const mine = ctx.subs
      .filter(s => s.planId === p.id && s.subscriberType === subscriberType)
      .sort((a, b) => rank(a) - rank(b) || (b.endDate?.getTime() ?? 0) - (a.endDate?.getTime() ?? 0));
    const current  = mine[0] ?? null;
    const upcoming = mine.find(s => s.computed === SUBSCRIPTION_STATUS.UPCOMING) ?? null;

    // Features of the plan for the buyer's own role, with current access.
    const features = item.features.map(f => {
      if (f.role !== user.role) return { ...f, alreadyActive: null, activeVia: null };
      if (!f.isPaid) return { ...f, alreadyActive: true, activeVia: [] };
      const access = ctx.accessFor(f.featureId);
      return { ...f, alreadyActive: access.live, activeVia: access.live ? access.sources : [] };
    });

    // SELF plan whose every paid feature the school already pays for.
    const paidOwn = features.filter(f => f.role === user.role && f.isPaid);
    const coveredBySchool = p.scope === 'SELF' && paidOwn.length > 0 && paidOwn.every(f => ctx.coveredBySchool(f.featureId));

    return {
      ...item,
      features,
      startingFrom:    minPrice(p),
      coveredBySchool,
      canSubscribe:    !coveredBySchool,
      // SUBSCRIBE (never had it), RENEW (live → new period starts after
      // the current one; expired → starts now), COMPLETE_PAYMENT
      // (pending), NONE (school pays).
      action: coveredBySchool ? 'NONE'
        : current?.computed === SUBSCRIPTION_STATUS.PENDING_PAYMENT ? 'COMPLETE_PAYMENT'
        : current ? 'RENEW'
        : 'SUBSCRIBE',
      mySubscription: current ? {
        id:          current.id,
        status:      current.computed,
        planPriceId: current.planPriceId,
        startDate:   current.startDate,
        endDate:     current.endDate,
        daysLeft:    SUBSCRIPTION_LIVE_STATUSES.includes(current.computed) ? daysLeft(current.endDate, now) : null,
      } : null,
      upcomingRenewal: upcoming && upcoming !== current
        ? { id: upcoming.id, startDate: upcoming.startDate, endDate: upcoming.endDate }
        : null,
    };
  });
};

// ── POST /subscription/subscribe ──────────────────────────────
// Creates a PENDING subscription + CREATED payment for the chosen price.
// It turns ACTIVE when the payment is confirmed (activateSubscription).
// An older unpaid attempt for the same plan is cancelled, so a user who
// abandoned checkout is never stuck.
export const subscribe = async (user: RequestUser, input: SubscribeSchema) => {
  const schoolId = requireSchool(user);
  const now      = new Date();

  const price = await prisma.planPrice.findUnique({
    where:   { id: input.planPriceId },
    include: { plan: { include: { features: { where: { role: user.role, feature: { isActive: true, isPaid: true } } } } } },
  });
  if (!price || !price.isActive || !price.plan.isActive) {
    throw appError('This plan is not available', 'PLAN_NOT_AVAILABLE', 404);
  }
  const plan = price.plan;
  if (plan.targetRole !== user.role || (plan.schoolId && plan.schoolId !== schoolId)) {
    throw appError('This plan is not available for your account', 'PLAN_NOT_AVAILABLE', 403);
  }

  const isSchool = plan.scope === 'SCHOOL';

  if (!isSchool && plan.features.length) {
    const ctx = await loadAccessContext(user, schoolId, now);
    if (plan.features.every(pf => ctx.coveredBySchool(pf.featureId))) {
      throw appError('Your school already pays for everything in this plan', 'ALREADY_COVERED_BY_SCHOOL', 409);
    }
  }

  const subscriber = isSchool
    ? { subscriberType: 'SCHOOL' as const, userId: null, schoolId }
    : { subscriberType: 'USER'   as const, userId: user.sub, schoolId };

  const created = await prisma.$transaction(async tx => {
    const stale = await tx.subscription.findMany({
      where:  { ...subscriber, planId: plan.id, status: 'PENDING' },
      select: { id: true },
    });
    if (stale.length) {
      const ids = stale.map(s => s.id);
      await tx.subscription.updateMany({ where: { id: { in: ids } }, data: { status: 'CANCELLED', cancelledAt: now, note: 'Replaced by a newer checkout' } });
      await tx.payment.updateMany({ where: { subscriptionId: { in: ids }, status: 'CREATED' }, data: { status: 'FAILED' } });
    }

    return tx.subscription.create({
      data: {
        ...subscriber,
        role:          user.role,
        paidByUserId:  user.sub,
        planId:        plan.id,
        planPriceId:   price.id,
        amount:        price.amount,
        currency:      price.currency,
        intervalUnit:  price.intervalUnit,
        intervalCount: price.intervalCount,
        status:        'PENDING',
        payments: {
          create: { userId: user.sub, schoolId, amount: price.amount, currency: price.currency, status: 'CREATED', gateway: 'MANUAL' },
        },
      },
      include: SUB_INCLUDE,
    });
  });

  return toSubscriptionItem(created, now);
};

// ── GET /subscription/my-subscriptions ────────────────────────
export const listMySubscriptions = async (user: RequestUser, query: ListMySubscriptionsQuerySchema) => {
  const schoolId = requireSchool(user);
  const now      = new Date();
  const where: Prisma.SubscriptionWhereInput = {
    AND: [
      ownedSubscriptionsWhere(user, schoolId),
      ...(query.status ? [subscriptionStatusWhere(query.status, now)] : []),
    ],
  };

  const [items, total] = await Promise.all([
    prisma.subscription.findMany({
      where,
      include: SUB_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip:    (query.page - 1) * query.pageSize,
      take:    query.pageSize,
    }),
    prisma.subscription.count({ where }),
  ]);
  return paginate(items.map(s => toSubscriptionItem(s, now)), query.page, query.pageSize, total);
};

export const getMySubscription = async (user: RequestUser, subscriptionId: string) => {
  const schoolId = requireSchool(user);
  const s = await prisma.subscription.findFirst({
    where:   { id: subscriptionId, ...ownedSubscriptionsWhere(user, schoolId) },
    include: SUB_INCLUDE,
  });
  if (!s) throw subscriptionNotFound();
  return toSubscriptionItem(s);
};

// ── POST /subscription/my-subscriptions/:id/cancel ────────────
// Only an unpaid (PENDING) checkout can be cancelled by the user.
export const cancelMyPendingSubscription = async (user: RequestUser, subscriptionId: string) => {
  const schoolId = requireSchool(user);
  const s = await prisma.subscription.findFirst({ where: { id: subscriptionId, ...ownedSubscriptionsWhere(user, schoolId) } });
  if (!s) throw subscriptionNotFound();
  if (s.status !== 'PENDING') {
    throw appError('Only a subscription awaiting payment can be cancelled', 'SUBSCRIPTION_NOT_PENDING', 409);
  }
  return toSubscriptionItem(await cancelSubscriptionRow(subscriptionId, { note: 'Cancelled by user' }));
};

// ════════════════════════════════════════════════════════════
// Razorpay Standard Checkout — pay a PENDING subscription.
// 1. app → razorpay-order → opens Checkout with the returned orderId
// 2. Checkout success → app → razorpay-verify → subscription ACTIVE
// ════════════════════════════════════════════════════════════

// ── POST /subscription/my-subscriptions/:id/razorpay-order ────
// Attaches a Razorpay order to the subscription's open payment. Calling
// it again (retry, second tap) returns the same order, so the payment
// row never points at an order the app isn't paying.
export const createRazorpayOrder = async (user: RequestUser, subscriptionId: string) => {
  const schoolId = requireSchool(user);
  const s = await prisma.subscription.findFirst({
    where:   { id: subscriptionId, ...ownedSubscriptionsWhere(user, schoolId) },
    include: {
      plan:       { select: { name: true } },
      paidByUser: { select: { name: true, email: true, phone: true } },
      payments:   { where: { status: 'CREATED' }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  if (!s) throw subscriptionNotFound();
  if (s.status !== 'PENDING') {
    throw appError('Only a subscription awaiting payment can be paid', 'SUBSCRIPTION_NOT_PENDING', 409);
  }
  if (s.amount < RAZORPAY_MIN_AMOUNT) {
    throw appError('Amount is below the minimum for online payment (₹1)', 'AMOUNT_TOO_LOW', 400);
  }
  const keyId = getRazorpayKeyId();

  const payment = s.payments[0] ?? await prisma.payment.create({
    data: { subscriptionId: s.id, userId: s.paidByUserId, schoolId: s.schoolId, amount: s.amount, currency: s.currency, status: 'CREATED' },
  });

  let orderId = payment.gatewayOrderId;
  if (!orderId) {
    const order = await getRazorpay().orders
      .create({
        amount:   payment.amount,
        currency: payment.currency,
        receipt:  payment.id,
        notes:    { subscriptionId: s.id, paymentId: payment.id },
      })
      .catch(err => { throw toGatewayError(err); });

    // Only the first concurrent request gets to store its order.
    const claimed = await prisma.payment.updateMany({
      where: { id: payment.id, gatewayOrderId: null },
      data:  { gateway: 'RAZORPAY', gatewayOrderId: order.id },
    });
    orderId = claimed.count
      ? order.id
      : (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, select: { gatewayOrderId: true } })).gatewayOrderId!;
  }

  return {
    keyId,
    orderId,
    amount:         payment.amount,
    currency:       payment.currency,
    subscriptionId: s.id,
    description:    s.plan.name,
    prefill: {
      name:    s.paidByUser.name,
      email:   s.paidByUser.email,
      contact: s.paidByUser.phone,
    },
  };
};

// ── POST /subscription/my-subscriptions/:id/razorpay-verify ───
// Checks the Checkout signature, then activates the subscription.
// Safe to retry: verifying the same payment again returns the result.
export const verifyRazorpayPayment = async (user: RequestUser, subscriptionId: string, input: VerifyRazorpayPaymentSchema) => {
  const schoolId = requireSchool(user);
  const s = await prisma.subscription.findFirst({
    where:  { id: subscriptionId, ...ownedSubscriptionsWhere(user, schoolId) },
    select: { id: true, status: true },
  });
  if (!s) throw subscriptionNotFound();

  if (!isValidCheckoutSignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature)) {
    throw appError('Payment verification failed', 'INVALID_PAYMENT_SIGNATURE', 400);
  }

  const payment = await prisma.payment.findFirst({
    where: { subscriptionId: s.id, gatewayOrderId: input.razorpay_order_id },
  });
  if (!payment) throw appError('This payment does not belong to this subscription', 'PAYMENT_ORDER_MISMATCH', 400);

  const alreadyRecorded = async () => {
    const current = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (current.gatewayPaymentId !== input.razorpay_payment_id) {
      throw appError('A different payment is already recorded for this order', 'PAYMENT_ALREADY_RECORDED', 409);
    }
    return getMySubscription(user, s.id);
  };
  if (payment.status === 'SUCCESS') return alreadyRecorded();

  const gateway = {
    orderId:   input.razorpay_order_id,
    paymentId: input.razorpay_payment_id,
    raw:       { razorpay_order_id: input.razorpay_order_id, razorpay_payment_id: input.razorpay_payment_id },
  };

  // Paid an order after its checkout was replaced or cancelled: the money
  // is real, so record it for a refund instead of dropping it.
  if (s.status !== 'PENDING' && s.status !== 'FAILED') {
    await prisma.payment.update({
      where: { id: payment.id },
      data:  { status: 'SUCCESS', paidAt: new Date(), gatewayPaymentId: gateway.paymentId, rawResponse: gateway.raw },
    });
    throw appError('Payment received for a subscription that is no longer awaiting payment — contact support for a refund',
      'SUBSCRIPTION_NOT_PENDING', 409, { paymentId: gateway.paymentId });
  }

  try {
    return toSubscriptionItem(await activateSubscriptionRow(s.id, { gateway }));
  } catch (err) {
    // A concurrent verify of the same payment won the race.
    if (isUniqueViolation(err)) return alreadyRecorded();
    throw err;
  }
};

// ════════════════════════════════════════════════════════════
// Feature check used by the requireFeature middleware.
// ════════════════════════════════════════════════════════════

export const checkFeatureAccess = async (user: RequestUser, featureKey: string): Promise<
  { allowed: true } | { allowed: false; reason: FeatureLockReason }
> => {
  if (user.role === 'SUPER_ADMIN') return { allowed: true };

  // Unknown, inactive, free or not-for-this-role features are never locked.
  const feature = await prisma.feature.findUnique({ where: { key: featureKey } });
  if (!feature || !feature.isActive || !feature.isPaid || !feature.roles.includes(user.role)) return { allowed: true };

  const schoolId = requireSchool(user);
  const now      = new Date();
  const base: Prisma.SubscriptionWhereInput = {
    ...reachableSubscriptionsWhere(user, schoolId),
    plan: { features: { some: { featureId: feature.id, role: user.role } } },
  };

  const live = await prisma.subscription.findFirst({ where: { ...base, ...liveSubscriptionWhere(now) }, select: { id: true } });
  if (live) return { allowed: true };

  const [pending, expired] = await Promise.all([
    prisma.subscription.findFirst({ where: { ...base, status: 'PENDING' }, select: { id: true } }),
    prisma.subscription.findFirst({ where: { ...base, status: 'ACTIVE', endDate: { lte: now } }, select: { id: true } }),
  ]);
  return {
    allowed: false,
    reason: pending ? FEATURE_LOCK_REASON.PENDING_PAYMENT
      : expired ? FEATURE_LOCK_REASON.EXPIRED
      : FEATURE_LOCK_REASON.NEVER_SUBSCRIBED,
  };
};

// ════════════════════════════════════════════════════════════
// SUPER_ADMIN
// ════════════════════════════════════════════════════════════

// ── GET /super-admin/subscription/subscriptions ───────────────
export const listAllSubscriptions = async (query: ListAllSubscriptionsQuerySchema) => {
  const now = new Date();
  const filters: Prisma.SubscriptionWhereInput = {
    ...(query.schoolId       ? { schoolId: query.schoolId }             : {}),
    ...(query.planId         ? { planId: query.planId }                 : {}),
    ...(query.role           ? { role: query.role }                     : {}),
    ...(query.subscriberType ? { subscriberType: query.subscriberType } : {}),
    ...(query.search ? {
      paidByUser: {
        OR: [
          { name:  { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
          { phone: { contains: query.search } },
        ],
      },
    } : {}),
  };
  const where: Prisma.SubscriptionWhereInput = query.status
    ? { AND: [filters, subscriptionStatusWhere(query.status, now)] }
    : filters;

  const [items, total, counts] = await Promise.all([
    prisma.subscription.findMany({
      where,
      include: SUB_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip:    (query.page - 1) * query.pageSize,
      take:    query.pageSize,
    }),
    prisma.subscription.count({ where }),
    // Per-status totals for the tabs (other filters applied, status not).
    Promise.all(SUBSCRIPTION_STATUS_VALUES.map(s =>
      prisma.subscription.count({ where: { AND: [filters, subscriptionStatusWhere(s, now)] } }),
    )),
  ]);

  return {
    ...paginate(items.map(s => toSuperAdminSubscriptionItem(s, now)), query.page, query.pageSize, total),
    statusCounts: Object.fromEntries(SUBSCRIPTION_STATUS_VALUES.map((s, i) => [s, counts[i]])),
  };
};

export const getSubscriptionById = async (subscriptionId: string) => {
  const s = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: SUB_INCLUDE });
  if (!s) throw subscriptionNotFound();
  return toSuperAdminSubscriptionItem(s);
};

// ── Activation ────────────────────────────────────────────────
// Marks the payment received and starts the period. A renewal bought
// while the same plan is still running starts when that one ends, so no
// paid days are lost. Shared by the manual (super admin) path and
// Razorpay verification (gateway set → only that order's payment is paid).
interface GatewayConfirmation { orderId: string; paymentId: string; raw: Prisma.InputJsonValue }

const activateSubscriptionRow = async (
  subscriptionId: string,
  opts: ActivateSubscriptionSchema & { activatedBy?: string; gateway?: GatewayConfirmation },
) => {
  const now = new Date();

  return prisma.$transaction(async tx => {
    const s = await tx.subscription.findUnique({ where: { id: subscriptionId } });
    if (!s) throw subscriptionNotFound();
    if (s.status !== 'PENDING' && s.status !== 'FAILED') {
      throw appError(`Subscription is already ${computeSubscriptionStatus(s, now)}`, 'SUBSCRIPTION_NOT_PENDING', 409);
    }

    const running = await tx.subscription.findFirst({
      where: {
        id:             { not: s.id },
        planId:         s.planId,
        subscriberType: s.subscriberType,
        ...(s.subscriberType === 'USER' ? { userId: s.userId } : { schoolId: s.schoolId }),
        status:         'ACTIVE',
        endDate:        { gt: now },
      },
      orderBy: { endDate: 'desc' },
      select:  { endDate: true },
    });

    const startDate = running?.endDate ?? now;
    const endDate   = addInterval(startDate, s.intervalUnit, s.intervalCount);

    const gatewayData = opts.gateway
      ? { gateway: 'RAZORPAY' as const, gatewayOrderId: opts.gateway.orderId, gatewayPaymentId: opts.gateway.paymentId, rawResponse: opts.gateway.raw }
      : {};

    const paid = await tx.payment.updateMany({
      where: {
        subscriptionId: s.id,
        status:         { in: ['CREATED', 'FAILED'] },
        ...(opts.gateway ? { gatewayOrderId: opts.gateway.orderId } : {}),
      },
      data:  { status: 'SUCCESS', paidAt: now, reference: opts.reference ?? null, ...gatewayData },
    });
    if (!paid.count) {
      await tx.payment.create({
        data: {
          subscriptionId: s.id, userId: s.paidByUserId, schoolId: s.schoolId,
          amount: s.amount, currency: s.currency, status: 'SUCCESS', gateway: 'MANUAL',
          reference: opts.reference ?? null, paidAt: now, ...gatewayData,
        },
      });
    }

    return tx.subscription.update({
      where: { id: s.id },
      data: {
        status:      'ACTIVE',
        startDate,
        endDate,
        activatedAt: now,
        activatedBy: opts.activatedBy ?? null,
        ...(opts.note !== undefined ? { note: opts.note } : {}),
      },
      include: SUB_INCLUDE,
    });
  });
};

export const activateSubscription = async (
  subscriptionId: string,
  opts: ActivateSubscriptionSchema & { activatedBy?: string },
) => toSuperAdminSubscriptionItem(await activateSubscriptionRow(subscriptionId, opts));

// ── Cancel ────────────────────────────────────────────────────
// Access stops immediately. No refund is recorded here.
const cancelSubscriptionRow = async (subscriptionId: string, input: CancelSubscriptionSchema) => {
  const now = new Date();
  const s = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!s) throw subscriptionNotFound();
  if (s.status === 'CANCELLED') throw appError('Subscription is already cancelled', 'SUBSCRIPTION_ALREADY_CANCELLED', 409);

  const [, updated] = await prisma.$transaction([
    prisma.payment.updateMany({ where: { subscriptionId, status: 'CREATED' }, data: { status: 'FAILED' } }),
    prisma.subscription.update({
      where:   { id: subscriptionId },
      data:    { status: 'CANCELLED', cancelledAt: now, ...(input.note !== undefined ? { note: input.note } : {}) },
      include: SUB_INCLUDE,
    }),
  ]);
  return updated;
};

export const cancelSubscription = async (subscriptionId: string, input: CancelSubscriptionSchema) =>
  toSuperAdminSubscriptionItem(await cancelSubscriptionRow(subscriptionId, input));
