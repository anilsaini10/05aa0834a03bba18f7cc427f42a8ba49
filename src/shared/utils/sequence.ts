import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db';

type Db = Prisma.TransactionClient | typeof prisma;

// ── Running numbers per school (receipts, salary slips) ───────
// Reserves `count` numbers in one atomic UPSERT and returns the first.
// Inside a transaction the row stays locked until commit, so two
// concurrent callers never get the same number. A rolled-back
// transaction gives its numbers back; numbers reserved but not used
// (e.g. a skipped duplicate) leave a gap.
export const nextSequence = async (db: Db, schoolId: string, name: string, count = 1): Promise<number> => {
  const [row] = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO school_sequences ("schoolId", name, value)
    VALUES (${schoolId}, ${name}, ${count})
    ON CONFLICT ("schoolId", name) DO UPDATE SET value = school_sequences.value + ${count}
    RETURNING value`;
  return row.value - count + 1;
};
