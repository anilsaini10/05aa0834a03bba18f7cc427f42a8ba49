import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/db';
import {
  CHAPTER_PROGRESS_STATUS, SYLLABUS_PLAN_STATUS, APPROVAL_STATUS,
} from '../../../constants';
import { computeScheduleStatus } from '../../../shared/utils/workingDays';
import {
  CreateChapterSchema, UpdateChapterSchema, ReorderChaptersSchema, ListChaptersQuerySchema,
  CreateSyllabusPlanSchema, UpdateSyllabusPlanSchema, UpdatePlanChapterSchema, ListPlansQuerySchema,
  MonitoringQuerySchema,
  ReviewApprovalSchema, AdminCorrectionSchema,
} from './syllabus.validation';

// ── Error helpers ────────────────────────────────────────────────

const appError = (message: string, code: string, statusCode: number) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = statusCode;
  return err;
};

const notFound    = (message: string, code: string) => appError(message, code, 404);
const conflict    = (message: string, code: string) => appError(message, code, 409);
const badRequest  = (message: string, code: string) => appError(message, code, 400);

// ── Include constants ────────────────────────────────────────────

const CHAPTER_INCLUDE = {
  subject: { select: { id: true, name: true } },
  class:   { select: { id: true, name: true, numericLevel: true } },
} as const;

const PLAN_INCLUDE = {
  class:   { select: { id: true, name: true, numericLevel: true } },
  section: { select: { id: true, name: true } },
  subject: { select: { id: true, name: true } },
  teacher: { select: { id: true, employeeId: true, user: { select: { id: true, name: true } } } },
  _count:  { select: { chapters: true } },
} as const;

const PLAN_DETAIL_INCLUDE = {
  class:   { select: { id: true, name: true, numericLevel: true } },
  section: { select: { id: true, name: true } },
  subject: { select: { id: true, name: true } },
  teacher: { select: { id: true, employeeId: true, user: { select: { id: true, name: true } } } },
  chapters: {
    include: {
      chapter: { select: { id: true, name: true, chapterNumber: true, description: true } },
      _count:  { select: { progressHistory: true, approvals: true } },
    },
    orderBy: { sequenceNumber: 'asc' as const },
  },
} as const;

// ── Response mappers ─────────────────────────────────────────────

const toChapterResponse = (c: any) => ({
  id:                  c.id,
  name:                c.name,
  chapterNumber:       c.chapterNumber,
  description:         c.description,
  subjectId:           c.subjectId,
  subject:             c.subject,
  classId:             c.classId,
  class:               c.class,
  expectedWorkingDays: c.expectedWorkingDays,
  sequenceNumber:      c.sequenceNumber,
  isActive:            c.isActive,
  createdAt:           c.createdAt,
  updatedAt:           c.updatedAt,
});

const toPlanListItem = (p: any) => ({
  id:              p.id,
  sessionYear:     p.sessionYear,
  classId:         p.classId,
  class:           p.class,
  sectionId:       p.sectionId,
  section:         p.section,
  subjectId:       p.subjectId,
  subject:         p.subject,
  teacherId:       p.teacherId,
  teacher:         p.teacher ? { id: p.teacher.id, employeeId: p.teacher.employeeId, name: p.teacher.user?.name } : null,
  status:          p.status,
  remarks:         p.remarks,
  approvalEnabled: p.approvalEnabled,
  chapterCount:    p._count?.chapters ?? 0,
  createdAt:       p.createdAt,
  updatedAt:       p.updatedAt,
});

const toPlanChapterItem = (pc: any) => ({
  id:                   pc.id,
  chapterId:            pc.chapterId,
  chapter:              pc.chapter,
  sequenceNumber:       pc.sequenceNumber,
  expectedWorkingDays:  pc.expectedWorkingDays,
  plannedStartDate:     pc.plannedStartDate,
  plannedEndDate:       pc.plannedEndDate,
  adminRemarks:         pc.adminRemarks,
  actualStartDate:      pc.actualStartDate,
  actualEndDate:        pc.actualEndDate,
  actualWorkingDays:    pc.actualWorkingDays,
  completionPercentage: pc.completionPercentage,
  status:               pc.status,
  scheduleStatus:       pc.scheduleStatus,
  teacherRemarks:       pc.teacherRemarks,
  progressHistoryCount: pc._count?.progressHistory ?? 0,
  approvalsCount:       pc._count?.approvals ?? 0,
});

const toPlanDetailResponse = (p: any) => ({
  ...toPlanListItem(p),
  chapters: (p.chapters ?? []).map(toPlanChapterItem),
});

// ════════════════════════════════════════════════════════════════
// CHAPTER CRUD
// ════════════════════════════════════════════════════════════════

export const createChapter = async (schoolId: string, userId: string, input: CreateChapterSchema) => {
  const mapping = await prisma.classSubject.findUnique({
    where: { classId_subjectId: { classId: input.classId, subjectId: input.subjectId } },
  });
  if (!mapping) throw badRequest('This subject is not assigned to the selected class', 'SUBJECT_CLASS_MISMATCH');

  const subjectBelongs = await prisma.subject.findFirst({ where: { id: input.subjectId, schoolId } });
  if (!subjectBelongs) throw notFound('Subject not found in this school', 'SUBJECT_NOT_FOUND');

  const classBelongs = await prisma.class.findFirst({ where: { id: input.classId, schoolId } });
  if (!classBelongs) throw notFound('Class not found in this school', 'CLASS_NOT_FOUND');

  const existing = await prisma.chapter.findUnique({
    where: { schoolId_subjectId_classId_chapterNumber: { schoolId, subjectId: input.subjectId, classId: input.classId, chapterNumber: input.chapterNumber } },
  });
  if (existing) throw conflict('A chapter with this number already exists for this subject and class', 'CHAPTER_NUMBER_EXISTS');

  const chapter = await prisma.chapter.create({
    data: { ...input, schoolId, createdBy: userId },
    include: CHAPTER_INCLUDE,
  });
  return toChapterResponse(chapter);
};

export const listChapters = async (schoolId: string, query: ListChaptersQuerySchema) => {
  const { subjectId, classId, isActive, page, pageSize } = query;

  const where: Prisma.ChapterWhereInput = {
    schoolId,
    ...(subjectId !== undefined ? { subjectId } : {}),
    ...(classId   !== undefined ? { classId }   : {}),
    ...(isActive  !== undefined ? { isActive }  : {}),
  };

  const [items, total] = await Promise.all([
    prisma.chapter.findMany({
      where,
      include: CHAPTER_INCLUDE,
      orderBy: [{ classId: 'asc' }, { subjectId: 'asc' }, { sequenceNumber: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.chapter.count({ where }),
  ]);

  return {
    items: items.map(toChapterResponse),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};

export const getChapterById = async (schoolId: string, chapterId: string) => {
  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, schoolId },
    include: CHAPTER_INCLUDE,
  });
  if (!chapter) throw notFound('Chapter not found', 'CHAPTER_NOT_FOUND');
  return toChapterResponse(chapter);
};

export const updateChapter = async (schoolId: string, chapterId: string, input: UpdateChapterSchema) => {
  const chapter = await prisma.chapter.findFirst({ where: { id: chapterId, schoolId } });
  if (!chapter) throw notFound('Chapter not found', 'CHAPTER_NOT_FOUND');

  if (input.chapterNumber !== undefined && input.chapterNumber !== chapter.chapterNumber) {
    const dup = await prisma.chapter.findUnique({
      where: { schoolId_subjectId_classId_chapterNumber: { schoolId, subjectId: chapter.subjectId, classId: chapter.classId, chapterNumber: input.chapterNumber } },
    });
    if (dup) throw conflict('A chapter with this number already exists', 'CHAPTER_NUMBER_EXISTS');
  }

  const updated = await prisma.chapter.update({
    where: { id: chapterId },
    data: input,
    include: CHAPTER_INCLUDE,
  });
  return toChapterResponse(updated);
};

export const deleteChapter = async (schoolId: string, chapterId: string) => {
  const chapter = await prisma.chapter.findFirst({ where: { id: chapterId, schoolId } });
  if (!chapter) throw notFound('Chapter not found', 'CHAPTER_NOT_FOUND');

  const deps = await prisma.syllabusPlanChapter.count({ where: { chapterId } });
  if (deps > 0) throw badRequest('Cannot delete chapter — it is used in syllabus plans. Deactivate it instead.', 'CHAPTER_HAS_DEPENDENTS');

  await prisma.chapter.update({ where: { id: chapterId }, data: { isActive: false } });
};

export const toggleChapterStatus = async (schoolId: string, chapterId: string) => {
  const chapter = await prisma.chapter.findFirst({ where: { id: chapterId, schoolId } });
  if (!chapter) throw notFound('Chapter not found', 'CHAPTER_NOT_FOUND');

  const updated = await prisma.chapter.update({
    where: { id: chapterId },
    data: { isActive: !chapter.isActive },
    include: CHAPTER_INCLUDE,
  });
  return toChapterResponse(updated);
};

export const reorderChapters = async (schoolId: string, input: ReorderChaptersSchema) => {
  const ids = input.chapters.map(c => c.id);
  const chapters = await prisma.chapter.findMany({ where: { id: { in: ids }, schoolId } });
  if (chapters.length !== ids.length) throw notFound('One or more chapters not found in this school', 'CHAPTER_NOT_FOUND');

  await prisma.$transaction(
    input.chapters.map(c => prisma.chapter.update({ where: { id: c.id }, data: { sequenceNumber: c.sequenceNumber } })),
  );
  return { message: 'Chapters reordered successfully' };
};

// ════════════════════════════════════════════════════════════════
// SYLLABUS PLAN CRUD
// ════════════════════════════════════════════════════════════════

export const createSyllabusPlan = async (schoolId: string, userId: string, input: CreateSyllabusPlanSchema) => {
  const [cls, section, subject] = await Promise.all([
    prisma.class.findFirst({ where: { id: input.classId, schoolId } }),
    prisma.section.findFirst({ where: { id: input.sectionId, classId: input.classId } }),
    prisma.subject.findFirst({ where: { id: input.subjectId, schoolId } }),
  ]);
  if (!cls)     throw notFound('Class not found in this school', 'CLASS_NOT_FOUND');
  if (!section) throw notFound('Section not found in this class', 'SECTION_NOT_FOUND');
  if (!subject) throw notFound('Subject not found in this school', 'SUBJECT_NOT_FOUND');

  if (input.teacherId) {
    const teacher = await prisma.teacher.findFirst({ where: { id: input.teacherId, schoolId } });
    if (!teacher) throw notFound('Teacher not found in this school', 'TEACHER_NOT_FOUND');
  }

  const existing = await prisma.syllabusPlan.findUnique({
    where: {
      schoolId_sessionYear_classId_sectionId_subjectId: {
        schoolId, sessionYear: input.sessionYear, classId: input.classId, sectionId: input.sectionId, subjectId: input.subjectId,
      },
    },
  });
  if (existing) throw conflict('A syllabus plan already exists for this class, section, subject and session year', 'PLAN_ALREADY_EXISTS');

  const chapterIds = input.chapters.map(c => c.chapterId);
  const chapters = await prisma.chapter.findMany({
    where: { id: { in: chapterIds }, schoolId, subjectId: input.subjectId, classId: input.classId },
  });
  if (chapters.length !== chapterIds.length) {
    throw badRequest('One or more chapters do not belong to the selected subject and class', 'CHAPTER_MISMATCH');
  }

  const plan = await prisma.$transaction(async (tx) => {
    const created = await tx.syllabusPlan.create({
      data: {
        schoolId,
        sessionYear:     input.sessionYear,
        classId:         input.classId,
        sectionId:       input.sectionId,
        subjectId:       input.subjectId,
        teacherId:       input.teacherId ?? null,
        remarks:         input.remarks ?? null,
        approvalEnabled: input.approvalEnabled,
        createdBy:       userId,
        chapters: {
          create: input.chapters.map(ch => ({
            chapterId:           ch.chapterId,
            sequenceNumber:      ch.sequenceNumber,
            expectedWorkingDays: ch.expectedWorkingDays,
            plannedStartDate:    ch.plannedStartDate ?? null,
            plannedEndDate:      ch.plannedEndDate ?? null,
            adminRemarks:        ch.adminRemarks ?? null,
          })),
        },
      },
      include: PLAN_DETAIL_INCLUDE,
    });
    return created;
  });

  return toPlanDetailResponse(plan);
};

export const listSyllabusPlans = async (schoolId: string, query: ListPlansQuerySchema) => {
  const { sessionYear, classId, sectionId, subjectId, teacherId, status, page, pageSize } = query;

  const where: Prisma.SyllabusPlanWhereInput = {
    schoolId,
    ...(sessionYear !== undefined ? { sessionYear } : {}),
    ...(classId     !== undefined ? { classId }     : {}),
    ...(sectionId   !== undefined ? { sectionId }   : {}),
    ...(subjectId   !== undefined ? { subjectId }   : {}),
    ...(teacherId   !== undefined ? { teacherId }   : {}),
    ...(status      !== undefined ? { status }      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.syllabusPlan.findMany({
      where,
      include: PLAN_INCLUDE,
      orderBy: [{ class: { numericLevel: 'asc' } }, { section: { name: 'asc' } }, { subject: { name: 'asc' } }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.syllabusPlan.count({ where }),
  ]);

  return {
    items: items.map(toPlanListItem),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
};

export const getSyllabusPlanById = async (schoolId: string, planId: string) => {
  const plan = await prisma.syllabusPlan.findFirst({
    where: { id: planId, schoolId },
    include: PLAN_DETAIL_INCLUDE,
  });
  if (!plan) throw notFound('Syllabus plan not found', 'PLAN_NOT_FOUND');

  const chapters = (plan.chapters ?? []).map(pc => {
    const sched = computeScheduleStatus(pc.actualWorkingDays, pc.expectedWorkingDays, pc.completionPercentage);
    return { ...toPlanChapterItem(pc), scheduleStatus: sched };
  });

  const totalChapters = chapters.length;
  const avgCompletion = totalChapters > 0
    ? Math.round((chapters.reduce((s, c) => s + c.completionPercentage, 0) / totalChapters) * 100) / 100
    : 0;

  return {
    ...toPlanListItem(plan),
    chapters,
    summary: {
      totalChapters,
      avgCompletion,
      notStarted:  chapters.filter(c => c.status === CHAPTER_PROGRESS_STATUS.NOT_STARTED).length,
      inProgress:  chapters.filter(c => c.status === CHAPTER_PROGRESS_STATUS.IN_PROGRESS).length,
      completed:   chapters.filter(c => c.status === CHAPTER_PROGRESS_STATUS.COMPLETED).length,
      delayed:     chapters.filter(c => c.scheduleStatus === 'DELAYED').length,
    },
  };
};

export const updateSyllabusPlan = async (schoolId: string, planId: string, input: UpdateSyllabusPlanSchema) => {
  const plan = await prisma.syllabusPlan.findFirst({ where: { id: planId, schoolId } });
  if (!plan) throw notFound('Syllabus plan not found', 'PLAN_NOT_FOUND');

  if (input.teacherId !== undefined && input.teacherId !== null) {
    const teacher = await prisma.teacher.findFirst({ where: { id: input.teacherId, schoolId } });
    if (!teacher) throw notFound('Teacher not found in this school', 'TEACHER_NOT_FOUND');
  }

  const updated = await prisma.syllabusPlan.update({
    where: { id: planId },
    data: input,
    include: PLAN_INCLUDE,
  });
  return toPlanListItem(updated);
};

export const updatePlanChapter = async (schoolId: string, planId: string, chapterId: string, input: UpdatePlanChapterSchema) => {
  const plan = await prisma.syllabusPlan.findFirst({ where: { id: planId, schoolId } });
  if (!plan) throw notFound('Syllabus plan not found', 'PLAN_NOT_FOUND');

  const planChapter = await prisma.syllabusPlanChapter.findUnique({
    where: { syllabusPlanId_chapterId: { syllabusPlanId: planId, chapterId } },
  });
  if (!planChapter) throw notFound('Chapter not found in this syllabus plan', 'PLAN_CHAPTER_NOT_FOUND');

  const updated = await prisma.syllabusPlanChapter.update({
    where: { id: planChapter.id },
    data: input,
    include: { chapter: { select: { id: true, name: true, chapterNumber: true, description: true } } },
  });
  return toPlanChapterItem({ ...updated, _count: { progressHistory: 0, approvals: 0 } });
};

export const deleteSyllabusPlan = async (schoolId: string, planId: string) => {
  const plan = await prisma.syllabusPlan.findFirst({ where: { id: planId, schoolId } });
  if (!plan) throw notFound('Syllabus plan not found', 'PLAN_NOT_FOUND');

  await prisma.syllabusPlan.delete({ where: { id: planId } });
};

// ════════════════════════════════════════════════════════════════
// MONITORING
// ════════════════════════════════════════════════════════════════

export const getSyllabusDashboard = async (schoolId: string, sessionYear: number) => {
  const plans = await prisma.syllabusPlan.findMany({
    where: { schoolId, sessionYear },
    include: {
      chapters: { select: { completionPercentage: true, status: true, scheduleStatus: true } },
    },
  });

  const allChapters = plans.flatMap(p => p.chapters);
  const totalPlans = plans.length;
  const totalChapters = allChapters.length;
  const avgCompletion = totalChapters > 0
    ? Math.round((allChapters.reduce((s, c) => s + c.completionPercentage, 0) / totalChapters) * 100) / 100
    : 0;

  return {
    totalPlans,
    totalChapters,
    avgCompletion,
    statusBreakdown: {
      notStarted: allChapters.filter(c => c.status === CHAPTER_PROGRESS_STATUS.NOT_STARTED).length,
      inProgress: allChapters.filter(c => c.status === CHAPTER_PROGRESS_STATUS.IN_PROGRESS).length,
      completed:  allChapters.filter(c => c.status === CHAPTER_PROGRESS_STATUS.COMPLETED).length,
    },
    planStatusBreakdown: {
      draft:     plans.filter(p => p.status === SYLLABUS_PLAN_STATUS.DRAFT).length,
      active:    plans.filter(p => p.status === SYLLABUS_PLAN_STATUS.ACTIVE).length,
      completed: plans.filter(p => p.status === SYLLABUS_PLAN_STATUS.COMPLETED).length,
      archived:  plans.filter(p => p.status === SYLLABUS_PLAN_STATUS.ARCHIVED).length,
    },
    delayedCount: allChapters.filter(c => c.scheduleStatus === 'DELAYED').length,
  };
};

export const getClassWiseProgress = async (schoolId: string, query: MonitoringQuerySchema) => {
  const where: Prisma.SyllabusPlanWhereInput = {
    schoolId,
    sessionYear: query.sessionYear,
    ...(query.classId   ? { classId: query.classId }     : {}),
    ...(query.subjectId ? { subjectId: query.subjectId } : {}),
    ...(query.teacherId ? { teacherId: query.teacherId } : {}),
  };

  const plans = await prisma.syllabusPlan.findMany({
    where,
    include: {
      class:   { select: { id: true, name: true, numericLevel: true } },
      section: { select: { id: true, name: true } },
      subject: { select: { id: true, name: true } },
      chapters: { select: { completionPercentage: true, status: true, scheduleStatus: true } },
    },
  });

  const grouped: Record<string, { class: any; sections: any[] }> = {};
  for (const p of plans) {
    if (!grouped[p.classId]) grouped[p.classId] = { class: p.class, sections: [] };
    const chapters = p.chapters;
    const avg = chapters.length > 0
      ? Math.round((chapters.reduce((s, c) => s + c.completionPercentage, 0) / chapters.length) * 100) / 100
      : 0;
    grouped[p.classId].sections.push({
      section: p.section,
      subject: p.subject,
      totalChapters: chapters.length,
      avgCompletion: avg,
      completed: chapters.filter(c => c.status === CHAPTER_PROGRESS_STATUS.COMPLETED).length,
      delayed:   chapters.filter(c => c.scheduleStatus === 'DELAYED').length,
    });
  }

  return Object.values(grouped).sort((a, b) => a.class.numericLevel - b.class.numericLevel);
};

export const getTeacherWiseProgress = async (schoolId: string, query: MonitoringQuerySchema) => {
  const where: Prisma.SyllabusPlanWhereInput = {
    schoolId,
    sessionYear: query.sessionYear,
    teacherId: { not: null },
    ...(query.classId   ? { classId: query.classId }     : {}),
    ...(query.subjectId ? { subjectId: query.subjectId } : {}),
    ...(query.teacherId ? { teacherId: query.teacherId } : {}),
  };

  const plans = await prisma.syllabusPlan.findMany({
    where,
    include: {
      teacher: { select: { id: true, employeeId: true, user: { select: { name: true } } } },
      class:   { select: { id: true, name: true } },
      subject: { select: { id: true, name: true } },
      chapters: { select: { completionPercentage: true, status: true, scheduleStatus: true } },
    },
  });

  const grouped: Record<string, { teacher: any; plans: any[] }> = {};
  for (const p of plans) {
    if (!p.teacherId) continue;
    if (!grouped[p.teacherId]) {
      grouped[p.teacherId] = {
        teacher: { id: p.teacher!.id, employeeId: p.teacher!.employeeId, name: p.teacher!.user?.name },
        plans: [],
      };
    }
    const chapters = p.chapters;
    const avg = chapters.length > 0
      ? Math.round((chapters.reduce((s, c) => s + c.completionPercentage, 0) / chapters.length) * 100) / 100
      : 0;
    grouped[p.teacherId].plans.push({
      class: p.class,
      subject: p.subject,
      totalChapters: chapters.length,
      avgCompletion: avg,
      completed: chapters.filter(c => c.status === CHAPTER_PROGRESS_STATUS.COMPLETED).length,
      delayed:   chapters.filter(c => c.scheduleStatus === 'DELAYED').length,
    });
  }

  return Object.values(grouped);
};

export const getDelayedChapters = async (schoolId: string, query: MonitoringQuerySchema) => {
  const planWhere: Prisma.SyllabusPlanWhereInput = {
    schoolId,
    sessionYear: query.sessionYear,
    ...(query.classId   ? { classId: query.classId }     : {}),
    ...(query.sectionId ? { sectionId: query.sectionId } : {}),
    ...(query.subjectId ? { subjectId: query.subjectId } : {}),
    ...(query.teacherId ? { teacherId: query.teacherId } : {}),
  };

  const planChapters = await prisma.syllabusPlanChapter.findMany({
    where: {
      scheduleStatus: 'DELAYED',
      syllabusPlan: planWhere,
    },
    include: {
      chapter:      { select: { id: true, name: true, chapterNumber: true } },
      syllabusPlan: {
        select: {
          id: true,
          class:   { select: { id: true, name: true } },
          section: { select: { id: true, name: true } },
          subject: { select: { id: true, name: true } },
          teacher: { select: { id: true, user: { select: { name: true } } } },
        },
      },
    },
    orderBy: { actualWorkingDays: 'desc' },
  });

  return planChapters.map(pc => ({
    id:                   pc.id,
    chapter:              pc.chapter,
    plan:                 pc.syllabusPlan,
    expectedWorkingDays:  pc.expectedWorkingDays,
    actualWorkingDays:    pc.actualWorkingDays,
    completionPercentage: pc.completionPercentage,
    variance:             pc.actualWorkingDays - pc.expectedWorkingDays,
  }));
};

// ════════════════════════════════════════════════════════════════
// APPROVAL
// ════════════════════════════════════════════════════════════════

export const listPendingApprovals = async (schoolId: string, query: MonitoringQuerySchema) => {
  const planWhere: Prisma.SyllabusPlanWhereInput = {
    schoolId,
    sessionYear: query.sessionYear,
    ...(query.classId   ? { classId: query.classId }     : {}),
    ...(query.subjectId ? { subjectId: query.subjectId } : {}),
    ...(query.teacherId ? { teacherId: query.teacherId } : {}),
  };

  const approvals = await prisma.progressApproval.findMany({
    where: {
      status: APPROVAL_STATUS.PENDING,
      syllabusPlanChapter: { syllabusPlan: planWhere },
    },
    include: {
      syllabusPlanChapter: {
        include: {
          chapter:      { select: { id: true, name: true, chapterNumber: true } },
          syllabusPlan: {
            select: {
              id: true,
              class:   { select: { id: true, name: true } },
              section: { select: { id: true, name: true } },
              subject: { select: { id: true, name: true } },
              teacher: { select: { id: true, user: { select: { name: true } } } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return approvals.map(a => ({
    id:                  a.id,
    submittedPercentage: a.submittedPercentage,
    status:              a.status,
    chapter:             a.syllabusPlanChapter.chapter,
    plan:                a.syllabusPlanChapter.syllabusPlan,
    createdAt:           a.createdAt,
  }));
};

export const reviewApproval = async (schoolId: string, userId: string, approvalId: string, input: ReviewApprovalSchema) => {
  const approval = await prisma.progressApproval.findUnique({
    where: { id: approvalId },
    include: { syllabusPlanChapter: { include: { syllabusPlan: { select: { schoolId: true } } } } },
  });
  if (!approval) throw notFound('Approval not found', 'APPROVAL_NOT_FOUND');
  if (approval.syllabusPlanChapter.syllabusPlan.schoolId !== schoolId) throw notFound('Approval not found', 'APPROVAL_NOT_FOUND');
  if (approval.status !== APPROVAL_STATUS.PENDING) throw badRequest('This approval has already been reviewed', 'APPROVAL_ALREADY_REVIEWED');

  await prisma.$transaction(async (tx) => {
    await tx.progressApproval.update({
      where: { id: approvalId },
      data: {
        status:             input.status,
        approvedPercentage: input.approvedPercentage ?? null,
        rejectionRemarks:   input.rejectionRemarks ?? null,
        reviewedBy:         userId,
        reviewedAt:         new Date(),
      },
    });

    if (input.status === 'APPROVED' && input.approvedPercentage !== undefined) {
      const pc = approval.syllabusPlanChapter;
      const newStatus = input.approvedPercentage >= 100
        ? CHAPTER_PROGRESS_STATUS.COMPLETED
        : input.approvedPercentage > 0
          ? CHAPTER_PROGRESS_STATUS.IN_PROGRESS
          : CHAPTER_PROGRESS_STATUS.NOT_STARTED;

      await tx.syllabusPlanChapter.update({
        where: { id: pc.id },
        data: {
          completionPercentage: input.approvedPercentage,
          status: newStatus,
          scheduleStatus: computeScheduleStatus(pc.actualWorkingDays, pc.expectedWorkingDays, input.approvedPercentage),
          ...(input.approvedPercentage >= 100 && !pc.actualEndDate ? { actualEndDate: new Date() } : {}),
        },
      });
    }
  });

  return { message: `Progress ${input.status.toLowerCase()} successfully` };
};

export const adminCorrection = async (schoolId: string, userId: string, planChapterId: string, input: AdminCorrectionSchema) => {
  const pc = await prisma.syllabusPlanChapter.findUnique({
    where: { id: planChapterId },
    include: { syllabusPlan: { select: { schoolId: true } } },
  });
  if (!pc) throw notFound('Plan chapter not found', 'PLAN_CHAPTER_NOT_FOUND');
  if (pc.syllabusPlan.schoolId !== schoolId) throw notFound('Plan chapter not found', 'PLAN_CHAPTER_NOT_FOUND');

  const newStatus = input.completionPercentage >= 100
    ? CHAPTER_PROGRESS_STATUS.COMPLETED
    : input.completionPercentage > 0
      ? CHAPTER_PROGRESS_STATUS.IN_PROGRESS
      : CHAPTER_PROGRESS_STATUS.NOT_STARTED;

  await prisma.$transaction([
    prisma.syllabusPlanChapter.update({
      where: { id: planChapterId },
      data: {
        completionPercentage: input.completionPercentage,
        status: newStatus,
        scheduleStatus: computeScheduleStatus(pc.actualWorkingDays, pc.expectedWorkingDays, input.completionPercentage),
        ...(input.completionPercentage >= 100 && !pc.actualEndDate ? { actualEndDate: new Date() } : {}),
      },
    }),
    prisma.chapterProgressHistory.create({
      data: {
        syllabusPlanChapterId: planChapterId,
        previousPercentage:    pc.completionPercentage,
        newPercentage:         input.completionPercentage,
        progressDate:          new Date(),
        workingDaysAdded:      0,
        totalActualWorkingDays: pc.actualWorkingDays,
        remarks:               `[Admin Correction] ${input.correctionRemarks}`,
        updatedBy:             userId,
      },
    }),
  ]);

  return { message: 'Progress corrected successfully' };
};
