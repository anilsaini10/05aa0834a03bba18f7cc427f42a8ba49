import { Prisma } from '@prisma/client';

// ── Money (rupees with paise, stored as Decimal(12,2)) ────────
// Arithmetic stays in Prisma.Decimal; numbers only at the API edge.

export const dec = (v: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(v);

export const toAmount = (v: Prisma.Decimal | null | undefined): number => (v ? v.toDecimalPlaces(2).toNumber() : 0);

export const sumAmounts = (values: Prisma.Decimal.Value[]): Prisma.Decimal =>
  values.reduce<Prisma.Decimal>((acc, v) => acc.plus(v), dec(0));
