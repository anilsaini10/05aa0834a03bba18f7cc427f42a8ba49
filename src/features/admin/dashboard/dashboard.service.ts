import { prisma } from '../../../config/db';

export interface DashboardStats {
  studentsCount: number;
  teachersCount: number;
  staffCount:    number;
  classesCount:  number;
}

// ── Admin home-screen summary counts ────────────────────────────
// Students/teachers/staff are counted with status ACTIVE only (INACTIVE
// means left/departed, shouldn't inflate the headline count); classes
// have no status concept, so all classes count.
// To add a new stat later: add one prisma.count(...) to the Promise.all
// below and one field to DashboardStats.
export const getDashboardStats = async (schoolId: string): Promise<DashboardStats> => {
  const [studentsCount, teachersCount, staffCount, classesCount] = await Promise.all([
    prisma.student.count({ where: { schoolId, status: 'ACTIVE' } }),
    prisma.teacher.count({ where: { schoolId, status: 'ACTIVE' } }),
    prisma.staff.count({ where: { schoolId, status: 'ACTIVE' } }),
    prisma.class.count({ where: { schoolId } }),
  ]);

  return { studentsCount, teachersCount, staffCount, classesCount };
};
