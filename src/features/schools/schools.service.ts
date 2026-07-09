import { prisma } from '../../config/db';

const RESULT_LIMIT = 20;

export interface SchoolListItem {
  id:   string;
  name: string;
  city: string | null;
}

// ── Search the school directory ─────────────────────────────────
export const searchSchools = async (search?: string): Promise<SchoolListItem[]> => {
  return prisma.school.findMany({
    where:   search ? { name: { contains: search, mode: 'insensitive' } } : undefined,
    select:  { id: true, name: true, city: true },
    orderBy: { name: 'asc' },
    take:    RESULT_LIMIT,
  });
};
