import { IntervalUnit, Prisma, SubscriptionStatus } from '@prisma/client';
import {
  PLAN_TRIAL_STATUS,
  PlanTrialStatus,
  SCHOOL_TIMEZONE,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_EXPIRING_SOON_DAYS,
  SubscriptionComputedStatus,
} from '../../constants';

const DAY_MS = 86_400_000;

// SCHOOL_TIMEZONE is IST, which has no DST — a fixed offset is exact.
const SCHOOL_TZ_OFFSET_MS = 330 * 60_000;

interface StatusFields {
  status:    SubscriptionStatus;
  startDate: Date | null;
  endDate:   Date | null;
}

// Stored status + dates → the status the API returns.
export const computeSubscriptionStatus = (s: StatusFields, now = new Date()): SubscriptionComputedStatus => {
  switch (s.status) {
    case 'PENDING':   return SUBSCRIPTION_STATUS.PENDING_PAYMENT;
    case 'FAILED':    return SUBSCRIPTION_STATUS.PAYMENT_FAILED;
    case 'CANCELLED': return SUBSCRIPTION_STATUS.CANCELLED;
  }
  if (!s.startDate || !s.endDate)  return SUBSCRIPTION_STATUS.PENDING_PAYMENT;
  if (now < s.startDate)           return SUBSCRIPTION_STATUS.UPCOMING;
  if (now >= s.endDate)            return SUBSCRIPTION_STATUS.EXPIRED;
  if (s.endDate.getTime() - now.getTime() <= SUBSCRIPTION_EXPIRING_SOON_DAYS * DAY_MS) {
    return SUBSCRIPTION_STATUS.EXPIRING_SOON;
  }
  return SUBSCRIPTION_STATUS.ACTIVE;
};

// The same rules as a Prisma filter, for list endpoints.
export const subscriptionStatusWhere = (
  status: SubscriptionComputedStatus,
  now = new Date(),
): Prisma.SubscriptionWhereInput => {
  const soon = new Date(now.getTime() + SUBSCRIPTION_EXPIRING_SOON_DAYS * DAY_MS);
  switch (status) {
    case SUBSCRIPTION_STATUS.PENDING_PAYMENT: return { status: 'PENDING' };
    case SUBSCRIPTION_STATUS.PAYMENT_FAILED:  return { status: 'FAILED' };
    case SUBSCRIPTION_STATUS.CANCELLED:       return { status: 'CANCELLED' };
    case SUBSCRIPTION_STATUS.UPCOMING:        return { status: 'ACTIVE', startDate: { gt: now } };
    case SUBSCRIPTION_STATUS.EXPIRED:         return { status: 'ACTIVE', endDate: { lte: now } };
    case SUBSCRIPTION_STATUS.EXPIRING_SOON:
      return { status: 'ACTIVE', startDate: { lte: now }, endDate: { gt: now, lte: soon } };
    case SUBSCRIPTION_STATUS.ACTIVE:
      return { status: 'ACTIVE', startDate: { lte: now }, endDate: { gt: soon } };
  }
};

// Subscriptions that unlock features right now (ACTIVE or EXPIRING_SOON).
export const liveSubscriptionWhere = (now = new Date()): Prisma.SubscriptionWhereInput => ({
  status: 'ACTIVE', startDate: { lte: now }, endDate: { gt: now },
});

// start + count × unit. Month math keeps the day of month, clamped to the
// month's last day (31 Jan + 1 month → 28/29 Feb).
export const addInterval = (start: Date, unit: IntervalUnit, count: number): Date => {
  if (unit === 'DAY') return new Date(start.getTime() + count * DAY_MS);

  const months = unit === 'YEAR' ? count * 12 : count;
  const d      = new Date(start);
  const day    = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
};

// "1 Month", "3 Months", "1 Year", "15 Days".
export const durationLabel = (unit: IntervalUnit, count: number): string => {
  const word = unit === 'DAY' ? 'Day' : unit === 'MONTH' ? 'Month' : 'Year';
  return `${count} ${word}${count === 1 ? '' : 's'}`;
};

export const daysLeft = (endDate: Date | null, now = new Date()): number | null =>
  endDate ? Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / DAY_MS)) : null;

// ── Plan free trial ───────────────────────────────────────────
// Trial dates are school calendar days: the trial runs from 00:00 IST on
// the first day until 00:00 IST the day after the last (exclusive end).
export const schoolDayStart = (day: string): Date =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) - SCHOOL_TZ_OFFSET_MS);

export const toSchoolDay = (d: Date): string =>
  d.toLocaleDateString('en-CA', { timeZone: SCHOOL_TIMEZONE });   // YYYY-MM-DD

export const trialWindow = (startDay: string, endDay: string) => ({
  trialStartsAt: schoolDayStart(startDay),
  trialEndsAt:   new Date(schoolDayStart(endDay).getTime() + DAY_MS),
});

export const trialStatus = (startsAt: Date, endsAt: Date, now = new Date()): PlanTrialStatus =>
  now < startsAt ? PLAN_TRIAL_STATUS.SCHEDULED
  : now >= endsAt ? PLAN_TRIAL_STATUS.ENDED
  : PLAN_TRIAL_STATUS.ACTIVE;

// Plans whose trial is running right now.
export const activeTrialWhere = (now = new Date()): Prisma.SubscriptionPlanWhereInput => ({
  trialStartsAt: { lte: now }, trialEndsAt: { gt: now },
});
