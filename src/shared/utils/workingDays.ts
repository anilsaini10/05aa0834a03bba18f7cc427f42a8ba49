import { prisma } from '../../config/db';
import { SCHOOL_CLOSED_EVENT_TYPES } from '../../constants';

const DAY_MS = 86_400_000;
const toDay  = (d: Date) => d.toISOString().slice(0, 10);
const atDay  = (s: string) => new Date(`${s}T00:00:00.000Z`);

const CLOSED = new Set<string>(SCHOOL_CLOSED_EVENT_TYPES);

export const getSchoolClosedDates = async (
  schoolId: string,
  from: Date,
  to: Date,
): Promise<Set<string>> => {
  const events = await prisma.event.findMany({
    where: {
      schoolId,
      eventType: { in: [...SCHOOL_CLOSED_EVENT_TYPES] },
      startDate: { lte: new Date(to.getTime() + DAY_MS - 1) },
      endDate:   { gte: from },
    },
    select: { startDate: true, endDate: true },
  });

  const closed = new Set<string>();
  const fromStr = toDay(from), toStr = toDay(to);
  for (const e of events) {
    const start = toDay(e.startDate) < fromStr ? fromStr : toDay(e.startDate);
    const end   = toDay(e.endDate) > toStr ? toStr : toDay(e.endDate);
    for (let t = atDay(start).getTime(); t <= atDay(end).getTime(); t += DAY_MS) {
      closed.add(toDay(new Date(t)));
    }
  }
  return closed;
};

export const countWorkingDays = async (
  schoolId: string,
  from: Date,
  to: Date,
): Promise<number> => {
  const closed = await getSchoolClosedDates(schoolId, from, to);
  let count = 0;
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
    const d = new Date(t);
    const ds = toDay(d);
    if (d.getUTCDay() === 0) continue;
    if (closed.has(ds)) continue;
    count++;
  }
  return count;
};

export const computeScheduleStatus = (
  actualWorkingDays: number,
  expectedWorkingDays: number,
  completionPercentage: number,
): string => {
  if (completionPercentage >= 100) return 'COMPLETED';
  if (expectedWorkingDays <= 0) return 'ON_TRACK';
  if (actualWorkingDays < expectedWorkingDays) return 'AHEAD';
  if (actualWorkingDays === expectedWorkingDays) return 'ON_TRACK';
  return 'DELAYED';
};
