import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db';
import { computeScheduleStatus } from '../../shared/utils/workingDays';
import { CHAPTER_PROGRESS_STATUS, SYLLABUS_PLAN_STATUS } from '../../constants';
import { AssignedSyllabusQuerySchema, SubmitProgressSchema } from './teacherSyllabus.validation';

const appError = (message: string, code: string, statusCode: number) => {
  const err = new Error(message) as any;
  err.code = code; err.statusCode = statusCode;
  return err;
};
const notFound  = (msg: string, code: string) => appError(msg, code, 404);
const forbidden = (msg: string, code: string) => appError(msg, code, 403);
const badReq    = (msg: string, code: string) => appError(msg, code, 400);

const PLAN_CHAPTER_INCLUDE = {
  chapter: { select: { id: true, name: true, chapterNumber: true, description: true, expectedWorkingDays: true } },
} as const;

// ── helpers ──────────────────────────────────────────────────────

export const getTeacherByUserId = async (userId: string) => {
  const teacher = await prisma.teacher.findUnique({ where: { userId }, select: { id: true, schoolId: true } });
  if (!teacher) throw notFound('Teacher profile not found', 'TEACHER_NOT_FOUND');
  return teacher;
};

const assertPlanChapterOwnership = async (
  teacherId: string,
  schoolId: string,
  planId: string,
  planChapterId: string,
) => {
  const pc = await prisma.syllabusPlanChapter.findUnique({
    where: { id: planChapterId },
    include: {
      syllabusPlan: { select: { id: true, teacherId: true, schoolId: true, approvalEnabled: true } },
      chapter: { select: { id: true, name: true, chapterNumber: true } },
    },
  });
  if (!pc || pc.syllabusPlan.id !== planId)          throw notFound('Chapter not found in this plan', 'PLAN_CHAPTER_NOT_FOUND');
  if (pc.syllabusPlan.teacherId !== teacherId)        throw forbidden('You are not assigned to this syllabus plan', 'NOT_ASSIGNED');
  if (pc.syllabusPlan.schoolId !== schoolId)           throw forbidden('Access denied', 'FORBIDDEN');
  return pc;
};

// ── GET /teacher/syllabus ────────────────────────────────────────

export const getAssignedSyllabus = async (
  teacherId: string,
  schoolId: string,
  query: AssignedSyllabusQuerySchema,
) => {
  const where: Prisma.SyllabusPlanWhereInput = {
    teacherId,
    schoolId,
    status: { in: [SYLLABUS_PLAN_STATUS.ACTIVE, SYLLABUS_PLAN_STATUS.COMPLETED] },
    ...(query.sessionYear ? { sessionYear: query.sessionYear } : {}),
    ...(query.classId     ? { classId: query.classId }         : {}),
    ...(query.subjectId   ? { subjectId: query.subjectId }     : {}),
  };

  const plans = await prisma.syllabusPlan.findMany({
    where,
    include: {
      class:   { select: { id: true, name: true } },
      section: { select: { id: true, name: true } },
      subject: { select: { id: true, name: true } },
      chapters: {
        include: PLAN_CHAPTER_INCLUDE,
        orderBy: { sequenceNumber: 'asc' },
      },
    },
    orderBy: [{ sessionYear: 'desc' }, { createdAt: 'desc' }],
  });

  return plans.map(p => {
    const totalChapters     = p.chapters.length;
    const completedChapters = p.chapters.filter(c => c.status === CHAPTER_PROGRESS_STATUS.COMPLETED).length;
    const avgCompletion     = totalChapters > 0
      ? Math.round(p.chapters.reduce((sum, c) => sum + c.completionPercentage, 0) / totalChapters)
      : 0;

    return {
      id:          p.id,
      sessionYear: p.sessionYear,
      class:       p.class,
      section:     p.section,
      subject:     p.subject,
      status:      p.status,
      remarks:     p.remarks,
      totalChapters,
      completedChapters,
      avgCompletion,
      chapters: p.chapters.map(c => ({
        id:                   c.id,
        sequenceNumber:       c.sequenceNumber,
        chapter:              c.chapter,
        expectedWorkingDays:  c.expectedWorkingDays,
        plannedStartDate:     c.plannedStartDate,
        plannedEndDate:       c.plannedEndDate,
        actualStartDate:      c.actualStartDate,
        actualEndDate:        c.actualEndDate,
        actualWorkingDays:    c.actualWorkingDays,
        completionPercentage: c.completionPercentage,
        remainingPercentage:  Math.max(0, 100 - c.completionPercentage),
        status:               c.status,
        scheduleStatus:       c.scheduleStatus,
        teacherRemarks:       c.teacherRemarks,
      })),
    };
  });
};

// ── GET /teacher/syllabus/classes-subjects ────────────────────────

export const getMyClassesAndSubjects = async (teacherId: string, schoolId: string) => {
  const plans = await prisma.syllabusPlan.findMany({
    where: { teacherId, schoolId, status: { in: [SYLLABUS_PLAN_STATUS.ACTIVE, SYLLABUS_PLAN_STATUS.COMPLETED] } },
    select: {
      classId:   true,
      class:     { select: { id: true, name: true } },
      sectionId: true,
      section:   { select: { id: true, name: true } },
      subjectId: true,
      subject:   { select: { id: true, name: true } },
    },
    distinct: ['classId', 'sectionId', 'subjectId'],
  });

  return plans.map(p => ({
    classId:     p.classId,
    className:   p.class.name,
    sectionId:   p.sectionId,
    sectionName: p.section.name,
    subjectId:   p.subjectId,
    subjectName: p.subject.name,
  }));
};

// ── GET /teacher/syllabus/plan/:planId ───────────────────────────

export const getPlanDetail = async (teacherId: string, schoolId: string, planId: string) => {
  const plan = await prisma.syllabusPlan.findUnique({
    where: { id: planId },
    include: {
      class:   { select: { id: true, name: true } },
      section: { select: { id: true, name: true } },
      subject: { select: { id: true, name: true } },
      chapters: {
        include: {
          ...PLAN_CHAPTER_INCLUDE,
          progressHistory: { orderBy: { progressDate: 'desc' as const }, take: 5 },
        },
        orderBy: { sequenceNumber: 'asc' },
      },
    },
  });

  if (!plan)                        throw notFound('Syllabus plan not found', 'PLAN_NOT_FOUND');
  if (plan.teacherId !== teacherId) throw forbidden('You are not assigned to this syllabus plan', 'NOT_ASSIGNED');
  if (plan.schoolId !== schoolId)   throw forbidden('Access denied', 'FORBIDDEN');

  const totalChapters     = plan.chapters.length;
  const completedChapters = plan.chapters.filter(c => c.status === CHAPTER_PROGRESS_STATUS.COMPLETED).length;
  const avgCompletion     = totalChapters > 0
    ? Math.round(plan.chapters.reduce((sum, c) => sum + c.completionPercentage, 0) / totalChapters)
    : 0;

  return {
    id:              plan.id,
    sessionYear:     plan.sessionYear,
    class:           plan.class,
    section:         plan.section,
    subject:         plan.subject,
    status:          plan.status,
    remarks:         plan.remarks,
    approvalEnabled: plan.approvalEnabled,
    totalChapters,
    completedChapters,
    avgCompletion,
    chapters: plan.chapters.map(c => ({
      id:                   c.id,
      sequenceNumber:       c.sequenceNumber,
      chapter:              c.chapter,
      expectedWorkingDays:  c.expectedWorkingDays,
      plannedStartDate:     c.plannedStartDate,
      plannedEndDate:       c.plannedEndDate,
      actualStartDate:      c.actualStartDate,
      actualEndDate:        c.actualEndDate,
      actualWorkingDays:    c.actualWorkingDays,
      completionPercentage: c.completionPercentage,
      remainingPercentage:  Math.max(0, 100 - c.completionPercentage),
      status:               c.status,
      scheduleStatus:       c.scheduleStatus,
      teacherRemarks:       c.teacherRemarks,
      recentHistory:        c.progressHistory,
    })),
  };
};

// ── GET /teacher/syllabus/plan/:planId/chapter/:planChapterId ────

export const getChapterDetail = async (
  teacherId: string,
  schoolId: string,
  planId: string,
  planChapterId: string,
) => {
  const pc = await prisma.syllabusPlanChapter.findUnique({
    where: { id: planChapterId },
    include: {
      syllabusPlan: {
        select: { id: true, teacherId: true, schoolId: true, sessionYear: true, approvalEnabled: true,
                   class: { select: { id: true, name: true } }, section: { select: { id: true, name: true } }, subject: { select: { id: true, name: true } } },
      },
      chapter: true,
      progressHistory: { orderBy: { progressDate: 'desc' as const } },
      approvals:       { orderBy: { createdAt: 'desc' as const }, take: 10 },
    },
  });

  if (!pc || pc.syllabusPlan.id !== planId)   throw notFound('Chapter not found in this plan', 'PLAN_CHAPTER_NOT_FOUND');
  if (pc.syllabusPlan.teacherId !== teacherId) throw forbidden('You are not assigned to this syllabus plan', 'NOT_ASSIGNED');
  if (pc.syllabusPlan.schoolId !== schoolId)   throw forbidden('Access denied', 'FORBIDDEN');

  return {
    id:                   pc.id,
    sequenceNumber:       pc.sequenceNumber,
    chapter:              pc.chapter,
    plan: {
      id:          pc.syllabusPlan.id,
      sessionYear: pc.syllabusPlan.sessionYear,
      class:       pc.syllabusPlan.class,
      section:     pc.syllabusPlan.section,
      subject:     pc.syllabusPlan.subject,
    },
    expectedWorkingDays:  pc.expectedWorkingDays,
    plannedStartDate:     pc.plannedStartDate,
    plannedEndDate:       pc.plannedEndDate,
    adminRemarks:         pc.adminRemarks,
    actualStartDate:      pc.actualStartDate,
    actualEndDate:        pc.actualEndDate,
    actualWorkingDays:    pc.actualWorkingDays,
    completionPercentage: pc.completionPercentage,
    remainingPercentage:  Math.max(0, 100 - pc.completionPercentage),
    status:               pc.status,
    scheduleStatus:       pc.scheduleStatus,
    teacherRemarks:       pc.teacherRemarks,
    approvalEnabled:      pc.syllabusPlan.approvalEnabled,
    progressHistory:      pc.progressHistory,
    approvals:            pc.approvals,
  };
};

// ── POST /teacher/syllabus/plan/:planId/chapter/:planChapterId/start ─

export const startChapter = async (
  teacherId: string,
  schoolId: string,
  planId: string,
  planChapterId: string,
) => {
  const pc = await assertPlanChapterOwnership(teacherId, schoolId, planId, planChapterId);

  if (pc.status !== CHAPTER_PROGRESS_STATUS.NOT_STARTED) {
    throw badReq('Chapter has already been started', 'CHAPTER_ALREADY_STARTED');
  }

  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');

  const [updated] = await prisma.$transaction([
    prisma.syllabusPlanChapter.update({
      where: { id: planChapterId },
      data:  { actualStartDate: today, status: CHAPTER_PROGRESS_STATUS.IN_PROGRESS, scheduleStatus: 'ON_TRACK' },
      include: PLAN_CHAPTER_INCLUDE,
    }),
    prisma.chapterProgressHistory.create({
      data: {
        syllabusPlanChapterId: planChapterId,
        previousPercentage:    0,
        newPercentage:         0,
        progressDate:          today,
        workingDaysAdded:      0,
        totalActualWorkingDays: 0,
        remarks:               'Chapter started',
        updatedBy:             pc.syllabusPlan.teacherId!,
      },
    }),
  ]);

  return {
    id:              updated.id,
    chapter:         updated.chapter,
    actualStartDate: updated.actualStartDate,
    status:          updated.status,
    scheduleStatus:  updated.scheduleStatus,
  };
};

// ── POST /teacher/syllabus/plan/:planId/chapter/:planChapterId/progress ─

export const submitProgress = async (
  teacherId: string,
  schoolId: string,
  planId: string,
  planChapterId: string,
  input: SubmitProgressSchema,
) => {
  const pc = await assertPlanChapterOwnership(teacherId, schoolId, planId, planChapterId);

  if (pc.status === CHAPTER_PROGRESS_STATUS.NOT_STARTED) {
    throw badReq('Start the chapter before submitting progress', 'CHAPTER_NOT_STARTED');
  }
  if (pc.status === CHAPTER_PROGRESS_STATUS.COMPLETED) {
    throw badReq('Chapter is already completed', 'CHAPTER_ALREADY_COMPLETED');
  }
  if (input.completionPercentage < pc.completionPercentage) {
    throw badReq('Completion percentage cannot decrease. Contact admin for corrections.', 'PERCENTAGE_CANNOT_DECREASE');
  }

  const existingEntry = await prisma.chapterProgressHistory.findFirst({
    where: { syllabusPlanChapterId: planChapterId, progressDate: input.progressDate },
  });

  const effectiveWorkingDays = existingEntry ? 0 : input.workingDaysAdded;
  const newActualWorkingDays = pc.actualWorkingDays + effectiveWorkingDays;
  const isCompleted          = input.completionPercentage >= 100;
  const newStatus            = isCompleted ? CHAPTER_PROGRESS_STATUS.COMPLETED : CHAPTER_PROGRESS_STATUS.IN_PROGRESS;
  const today                = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  const scheduleStatus       = computeScheduleStatus(newActualWorkingDays, pc.expectedWorkingDays, input.completionPercentage);

  const txOps: Prisma.PrismaPromise<any>[] = [
    prisma.syllabusPlanChapter.update({
      where: { id: planChapterId },
      data: {
        completionPercentage: input.completionPercentage,
        actualWorkingDays:    newActualWorkingDays,
        status:               newStatus,
        scheduleStatus,
        teacherRemarks:       input.remarks ?? pc.teacherRemarks,
        ...(isCompleted ? { actualEndDate: today } : {}),
      },
      include: PLAN_CHAPTER_INCLUDE,
    }),
  ];

  if (existingEntry) {
    txOps.push(prisma.chapterProgressHistory.update({
      where: { id: existingEntry.id },
      data: {
        previousPercentage:     pc.completionPercentage,
        newPercentage:          input.completionPercentage,
        totalActualWorkingDays: newActualWorkingDays,
        remarks:                input.remarks,
        updatedBy:              teacherId,
      },
    }));
  } else {
    txOps.push(prisma.chapterProgressHistory.create({
      data: {
        syllabusPlanChapterId: planChapterId,
        previousPercentage:    pc.completionPercentage,
        newPercentage:         input.completionPercentage,
        progressDate:          input.progressDate,
        workingDaysAdded:      input.workingDaysAdded,
        totalActualWorkingDays: newActualWorkingDays,
        remarks:               input.remarks,
        updatedBy:             teacherId,
      },
    }));
  }

  if (pc.syllabusPlan.approvalEnabled) {
    txOps.push(prisma.progressApproval.create({
      data: {
        syllabusPlanChapterId: planChapterId,
        submittedPercentage:   input.completionPercentage,
        status:                'PENDING',
      },
    }));
  }

  const [updated] = await prisma.$transaction(txOps);

  return {
    id:                   updated.id,
    chapter:              updated.chapter,
    completionPercentage: updated.completionPercentage,
    remainingPercentage:  Math.max(0, 100 - updated.completionPercentage),
    actualWorkingDays:    updated.actualWorkingDays,
    expectedWorkingDays:  updated.expectedWorkingDays,
    status:               updated.status,
    scheduleStatus:       updated.scheduleStatus,
    teacherRemarks:       updated.teacherRemarks,
  };
};

// ── POST /teacher/syllabus/plan/:planId/chapter/:planChapterId/complete ─

export const completeChapter = async (
  teacherId: string,
  schoolId: string,
  planId: string,
  planChapterId: string,
) => {
  const pc = await assertPlanChapterOwnership(teacherId, schoolId, planId, planChapterId);

  if (pc.status === CHAPTER_PROGRESS_STATUS.COMPLETED) {
    throw badReq('Chapter is already completed', 'CHAPTER_ALREADY_COMPLETED');
  }
  if (pc.status === CHAPTER_PROGRESS_STATUS.NOT_STARTED) {
    throw badReq('Start the chapter before completing it', 'CHAPTER_NOT_STARTED');
  }

  const today          = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  const scheduleStatus = computeScheduleStatus(pc.actualWorkingDays, pc.expectedWorkingDays, 100);

  const [updated] = await prisma.$transaction([
    prisma.syllabusPlanChapter.update({
      where: { id: planChapterId },
      data: {
        completionPercentage: 100,
        status:               CHAPTER_PROGRESS_STATUS.COMPLETED,
        scheduleStatus,
        actualEndDate:        today,
      },
      include: PLAN_CHAPTER_INCLUDE,
    }),
    prisma.chapterProgressHistory.create({
      data: {
        syllabusPlanChapterId: planChapterId,
        previousPercentage:    pc.completionPercentage,
        newPercentage:         100,
        progressDate:          today,
        workingDaysAdded:      0,
        totalActualWorkingDays: pc.actualWorkingDays,
        remarks:               'Chapter completed',
        updatedBy:             teacherId,
      },
    }),
  ]);

  return {
    id:                   updated.id,
    chapter:              updated.chapter,
    completionPercentage: 100,
    actualWorkingDays:    updated.actualWorkingDays,
    expectedWorkingDays:  updated.expectedWorkingDays,
    status:               updated.status,
    scheduleStatus:       updated.scheduleStatus,
    actualEndDate:        updated.actualEndDate,
  };
};

// ── GET /teacher/syllabus/progress ───────────────────────────────

export const getOverallProgress = async (
  teacherId: string,
  schoolId: string,
  sessionYear?: number,
) => {
  const where: Prisma.SyllabusPlanWhereInput = {
    teacherId,
    schoolId,
    status: { in: [SYLLABUS_PLAN_STATUS.ACTIVE, SYLLABUS_PLAN_STATUS.COMPLETED] },
    ...(sessionYear ? { sessionYear } : {}),
  };

  const plans = await prisma.syllabusPlan.findMany({
    where,
    include: {
      chapters: { select: { status: true, completionPercentage: true, scheduleStatus: true } },
    },
  });

  const allChapters = plans.flatMap(p => p.chapters);
  const totalPlans         = plans.length;
  const totalChapters      = allChapters.length;
  const completedChapters  = allChapters.filter(c => c.status === CHAPTER_PROGRESS_STATUS.COMPLETED).length;
  const inProgressChapters = allChapters.filter(c => c.status === CHAPTER_PROGRESS_STATUS.IN_PROGRESS).length;
  const notStartedChapters = allChapters.filter(c => c.status === CHAPTER_PROGRESS_STATUS.NOT_STARTED).length;
  const avgCompletion      = totalChapters > 0
    ? Math.round(allChapters.reduce((sum, c) => sum + c.completionPercentage, 0) / totalChapters)
    : 0;
  const aheadCount   = allChapters.filter(c => c.scheduleStatus === 'AHEAD').length;
  const onTrackCount = allChapters.filter(c => c.scheduleStatus === 'ON_TRACK').length;
  const delayedCount = allChapters.filter(c => c.scheduleStatus === 'DELAYED').length;

  return {
    totalPlans,
    totalChapters,
    completedChapters,
    inProgressChapters,
    notStartedChapters,
    avgCompletion,
    aheadCount,
    onTrackCount,
    delayedCount,
  };
};
