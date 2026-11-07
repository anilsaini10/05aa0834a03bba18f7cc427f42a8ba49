import { prisma } from '../../config/db';
import { SYLLABUS_PLAN_STATUS, APPROVAL_STATUS } from '../../constants';

const forbidden = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code = code; err.statusCode = 403;
  return err;
};

const notFound = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code = code; err.statusCode = 404;
  return err;
};

const validateParentChild = async (parentUserId: string, studentId: string) => {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, classId: true, sectionId: true, schoolId: true, parentUserId: true },
  });
  if (!student) throw notFound('Student not found', 'STUDENT_NOT_FOUND');
  if (student.parentUserId !== parentUserId) {
    throw forbidden('This student is not linked to your account', 'NOT_YOUR_CHILD');
  }
  return student;
};

const effectiveCompletion = (
  chapter: { completionPercentage: number; approvals: { status: string; approvedPercentage: number | null }[] },
  approvalEnabled: boolean,
): number => {
  if (!approvalEnabled) return chapter.completionPercentage;
  const latest = chapter.approvals
    .filter(a => a.status === APPROVAL_STATUS.APPROVED && a.approvedPercentage !== null)
    .at(-1);
  return latest ? latest.approvedPercentage! : chapter.completionPercentage;
};

// ── GET /students/syllabus ───────────────────────────────────────
export const getChildSyllabus = async (
  parentUserId: string,
  studentId: string,
  sessionYear?: number,
) => {
  const student = await validateParentChild(parentUserId, studentId);

  const plans = await prisma.syllabusPlan.findMany({
    where: {
      schoolId:  student.schoolId,
      classId:   student.classId,
      sectionId: student.sectionId,
      status:    { in: [SYLLABUS_PLAN_STATUS.ACTIVE, SYLLABUS_PLAN_STATUS.COMPLETED] },
      ...(sessionYear ? { sessionYear } : {}),
    },
    include: {
      subject: { select: { id: true, name: true } },
      teacher: { select: { id: true, user: { select: { name: true } } } },
      chapters: {
        orderBy: { sequenceNumber: 'asc' },
        include: {
          chapter: { select: { name: true, chapterNumber: true } },
          approvals: {
            where: { status: APPROVAL_STATUS.APPROVED },
            orderBy: { createdAt: 'asc' },
            select: { status: true, approvedPercentage: true },
          },
        },
      },
    },
    orderBy: { subject: { name: 'asc' } },
  });

  return plans.map(plan => {
    const chapters = plan.chapters.map(ch => ({
      id:                   ch.id,
      chapterName:          ch.chapter.name,
      chapterNumber:        ch.chapter.chapterNumber,
      sequenceNumber:       ch.sequenceNumber,
      completionPercentage: effectiveCompletion(ch, plan.approvalEnabled),
      status:               ch.status,
      scheduleStatus:       ch.scheduleStatus,
      expectedWorkingDays:  ch.expectedWorkingDays,
      actualWorkingDays:    ch.actualWorkingDays,
    }));

    const totalChapters    = chapters.length;
    const completedChapters = chapters.filter(c => c.status === 'COMPLETED').length;
    const avgCompletion     = totalChapters > 0
      ? Math.round(chapters.reduce((s, c) => s + c.completionPercentage, 0) / totalChapters * 100) / 100
      : 0;

    return {
      id:           plan.id,
      sessionYear:  plan.sessionYear,
      subject:      plan.subject,
      teacherName:  plan.teacher?.user?.name ?? null,
      status:       plan.status,
      totalChapters,
      completedChapters,
      avgCompletion,
      chapters,
    };
  });
};

// ── GET /students/syllabus/subject/:subjectId ────────────────────
export const getSubjectProgress = async (
  parentUserId: string,
  studentId: string,
  subjectId: string,
) => {
  const student = await validateParentChild(parentUserId, studentId);

  const plan = await prisma.syllabusPlan.findFirst({
    where: {
      schoolId:  student.schoolId,
      classId:   student.classId,
      sectionId: student.sectionId,
      subjectId,
      status: { in: [SYLLABUS_PLAN_STATUS.ACTIVE, SYLLABUS_PLAN_STATUS.COMPLETED] },
    },
    include: {
      subject: { select: { id: true, name: true } },
      teacher: { select: { id: true, user: { select: { name: true } } } },
      chapters: {
        orderBy: { sequenceNumber: 'asc' },
        include: {
          chapter: { select: { name: true, chapterNumber: true, description: true } },
          approvals: {
            where: { status: APPROVAL_STATUS.APPROVED },
            orderBy: { createdAt: 'asc' },
            select: { status: true, approvedPercentage: true },
          },
        },
      },
    },
  });

  if (!plan) throw notFound('Syllabus plan not found for this subject', 'PLAN_NOT_FOUND');

  const chapters = plan.chapters.map(ch => ({
    id:                   ch.id,
    chapterName:          ch.chapter.name,
    chapterNumber:        ch.chapter.chapterNumber,
    description:          ch.chapter.description,
    completionPercentage: effectiveCompletion(ch, plan.approvalEnabled),
    status:               ch.status,
    scheduleStatus:       ch.scheduleStatus,
    expectedWorkingDays:  ch.expectedWorkingDays,
    actualWorkingDays:    ch.actualWorkingDays,
    teacherRemarks:       ch.teacherRemarks || null,
  }));

  const totalChapters   = chapters.length;
  const completedCount  = chapters.filter(c => c.status === 'COMPLETED').length;
  const avgCompletion   = totalChapters > 0
    ? Math.round(chapters.reduce((s, c) => s + c.completionPercentage, 0) / totalChapters * 100) / 100
    : 0;

  return {
    planId:      plan.id,
    subject:     plan.subject,
    teacherName: plan.teacher?.user?.name ?? null,
    sessionYear: plan.sessionYear,
    status:      plan.status,
    totalChapters,
    completedCount,
    avgCompletion,
    chapters,
  };
};

// ── GET /students/syllabus/chapter/:planChapterId ────────────────
export const getChapterDetail = async (
  parentUserId: string,
  studentId: string,
  planChapterId: string,
) => {
  const student = await validateParentChild(parentUserId, studentId);

  const planChapter = await prisma.syllabusPlanChapter.findUnique({
    where: { id: planChapterId },
    include: {
      chapter: { select: { name: true, chapterNumber: true, description: true } },
      syllabusPlan: {
        select: {
          schoolId: true, classId: true, sectionId: true,
          status: true, approvalEnabled: true,
          subject: { select: { id: true, name: true } },
        },
      },
      progressHistory: {
        orderBy: { progressDate: 'asc' },
        select: { progressDate: true, newPercentage: true, remarks: true, createdAt: true },
      },
      approvals: {
        orderBy: { createdAt: 'asc' },
        select: { status: true, approvedPercentage: true, submittedPercentage: true, reviewedAt: true },
      },
    },
  });

  if (!planChapter) throw notFound('Chapter progress not found', 'PLAN_CHAPTER_NOT_FOUND');

  const sp = planChapter.syllabusPlan;
  if (sp.schoolId !== student.schoolId || sp.classId !== student.classId || sp.sectionId !== student.sectionId) {
    throw forbidden('This chapter does not belong to your child\'s class', 'NOT_YOUR_CHILD');
  }
  if (sp.status !== SYLLABUS_PLAN_STATUS.ACTIVE && sp.status !== SYLLABUS_PLAN_STATUS.COMPLETED) {
    throw notFound('Syllabus plan is not available', 'PLAN_NOT_AVAILABLE');
  }

  const history = sp.approvalEnabled
    ? planChapter.progressHistory.filter(h => {
        const approved = planChapter.approvals.find(
          a => a.status === APPROVAL_STATUS.APPROVED && a.approvedPercentage === h.newPercentage,
        );
        return !!approved;
      })
    : planChapter.progressHistory;

  return {
    id:                   planChapter.id,
    chapterName:          planChapter.chapter.name,
    chapterNumber:        planChapter.chapter.chapterNumber,
    description:          planChapter.chapter.description,
    subject:              sp.subject,
    expectedWorkingDays:  planChapter.expectedWorkingDays,
    plannedStartDate:     planChapter.plannedStartDate,
    plannedEndDate:       planChapter.plannedEndDate,
    actualStartDate:      planChapter.actualStartDate,
    actualEndDate:        planChapter.actualEndDate,
    actualWorkingDays:    planChapter.actualWorkingDays,
    completionPercentage: effectiveCompletion(planChapter, sp.approvalEnabled),
    remainingPercentage:  Math.max(0, 100 - effectiveCompletion(planChapter, sp.approvalEnabled)),
    status:               planChapter.status,
    scheduleStatus:       planChapter.scheduleStatus,
    teacherRemarks:       planChapter.teacherRemarks || null,
    progressHistory:      history.map(h => ({
      date:       h.progressDate,
      percentage: h.newPercentage,
      remarks:    h.remarks,
    })),
  };
};

// ── GET /students/syllabus/progress ──────────────────────────────
export const getOverallProgress = async (
  parentUserId: string,
  studentId: string,
  sessionYear?: number,
) => {
  const student = await validateParentChild(parentUserId, studentId);

  const plans = await prisma.syllabusPlan.findMany({
    where: {
      schoolId:  student.schoolId,
      classId:   student.classId,
      sectionId: student.sectionId,
      status:    { in: [SYLLABUS_PLAN_STATUS.ACTIVE, SYLLABUS_PLAN_STATUS.COMPLETED] },
      ...(sessionYear ? { sessionYear } : {}),
    },
    include: {
      subject: { select: { id: true, name: true } },
      chapters: {
        include: {
          approvals: {
            where: { status: APPROVAL_STATUS.APPROVED },
            orderBy: { createdAt: 'asc' },
            select: { status: true, approvedPercentage: true },
          },
        },
      },
    },
    orderBy: { subject: { name: 'asc' } },
  });

  const subjects = plans.map(plan => {
    const chapters = plan.chapters;
    const totalChapters    = chapters.length;
    const completedChapters = chapters.filter(c => c.status === 'COMPLETED').length;
    const avgCompletion = totalChapters > 0
      ? Math.round(
          chapters.reduce((s, c) => s + effectiveCompletion(c, plan.approvalEnabled), 0) / totalChapters * 100,
        ) / 100
      : 0;

    const delayed = chapters.some(c => c.scheduleStatus === 'DELAYED');
    const inProgress = chapters.some(c => c.status === 'IN_PROGRESS');

    let scheduleStatus = 'ON_TRACK';
    if (delayed) scheduleStatus = 'DELAYED';
    else if (avgCompletion >= 100) scheduleStatus = 'COMPLETED';
    else if (!inProgress && totalChapters > 0 && completedChapters === 0) scheduleStatus = 'NOT_STARTED';

    return {
      subjectId:       plan.subject.id,
      subjectName:     plan.subject.name,
      totalChapters,
      completedChapters,
      avgCompletion,
      scheduleStatus,
    };
  });

  const totalSubjects = subjects.length;
  const overallCompletion = totalSubjects > 0
    ? Math.round(subjects.reduce((s, sub) => s + sub.avgCompletion, 0) / totalSubjects * 100) / 100
    : 0;

  return {
    studentId,
    totalSubjects,
    overallCompletion,
    subjects,
  };
};
