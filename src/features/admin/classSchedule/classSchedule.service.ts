import { Prisma, ClassSchedule, Class, Section, Subject, Teacher, User } from '@prisma/client';
import { prisma } from '../../../config/db';
import {
  CreateScheduleSchema,
  UpdateScheduleSchema,
  ListScheduleQuerySchema,
} from './classSchedule.validation';

// ── Error helpers ──────────────────────────────────────────────
const notFound = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 404;
  return err;
};

const conflict = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 409;
  return err;
};

const forbidden = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 403;
  return err;
};

const badRequest = (message: string, code: string) => {
  const err = new Error(message) as any;
  err.code       = code;
  err.statusCode = 400;
  return err;
};

// Two [start,end) time ranges overlap if one starts before the other ends,
// in both directions. Works via plain string comparison since both are
// fixed-width zero-padded "HH:MM" — lexicographic order == chronological order.
const timesOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string): boolean =>
  aStart < bEnd && aEnd > bStart;

type ScheduleWithRefs = ClassSchedule & {
  class:         Class;
  section:       Section;
  subject:       Subject | null;
  teacher:       (Teacher & { user: User }) | null;
  createdByUser: User;
};

export interface ScheduleResponse {
  id:          string;
  classId:     string;
  className:   string;
  sectionId:   string;
  sectionName: string;
  day:         string;
  type:        string;
  periodNo:    number;
  subjectId:   string | null;
  subjectName: string | null;
  teacherId:   string | null;
  teacherName: string | null;
  roomNo:      string | null;
  title:       string | null;
  startTime:   string;
  endTime:     string;
  createdBy:   { id: string; name: string };
  createdAt:   Date;
  updatedAt:   Date;
}

const SCHEDULE_INCLUDE = {
  class:         true,
  section:       true,
  subject:       true,
  teacher:       { include: { user: true } },
  createdByUser: true,
};

const toScheduleResponse = (s: ScheduleWithRefs): ScheduleResponse => ({
  id:          s.id,
  classId:     s.classId,
  className:   s.class.name,
  sectionId:   s.sectionId,
  sectionName: s.section.name,
  day:         s.day,
  type:        s.type,
  periodNo:    s.periodNo,
  subjectId:   s.subjectId,
  subjectName: s.subject?.name ?? null,
  teacherId:   s.teacherId,
  teacherName: s.teacher?.user.name ?? null,
  roomNo:      s.roomNo,
  title:       s.title,
  startTime:   s.startTime,
  endTime:     s.endTime,
  createdBy:   { id: s.createdByUser.id, name: s.createdByUser.name },
  createdAt:   s.createdAt,
  updatedAt:   s.updatedAt,
});

// ── Shared conflict checks (used by both create and update) ────────
interface ConflictCheckInput {
  sectionId: string;
  day:       string;
  teacherId: string | null;
  roomNo:    string | null;
  startTime: string;
  endTime:   string;
  excludeId?: string; // when updating, don't compare against itself
}

const runConflictChecks = async (input: ConflictCheckInput): Promise<void> => {
  const exclude = input.excludeId ? { NOT: { id: input.excludeId } } : {};

  // 1. Same section, same day — no two periods/breaks may overlap in time,
  //    regardless of periodNo (catches admin mistakes with mismatched numbering).
  const sectionEntries = await prisma.classSchedule.findMany({
    where: { sectionId: input.sectionId, day: input.day as any, ...exclude },
  });
  if (sectionEntries.some(e => timesOverlap(e.startTime, e.endTime, input.startTime, input.endTime))) {
    throw conflict(
      'This time overlaps another period/break already scheduled for this section on this day',
      'TIME_OVERLAP_SECTION',
    );
  }

  // 2. Same teacher, same day, any section — a teacher can't teach two
  //    classes at once.
  if (input.teacherId) {
    const teacherEntries = await prisma.classSchedule.findMany({
      where: { teacherId: input.teacherId, day: input.day as any, ...exclude },
    });
    if (teacherEntries.some(e => timesOverlap(e.startTime, e.endTime, input.startTime, input.endTime))) {
      throw conflict(
        'This teacher already has another class at an overlapping time on this day',
        'TEACHER_TIME_CONFLICT',
      );
    }
  }

  // 3. Same room, same day, any section — two classes can't share a room
  //    at the same time.
  if (input.roomNo) {
    const roomEntries = await prisma.classSchedule.findMany({
      where: { roomNo: input.roomNo, day: input.day as any, ...exclude },
    });
    if (roomEntries.some(e => timesOverlap(e.startTime, e.endTime, input.startTime, input.endTime))) {
      throw conflict(
        'This room is already booked for another class at an overlapping time',
        'ROOM_TIME_CONFLICT',
      );
    }
  }
};

// ── Create a schedule entry (class period or break) ─────────────────
export const createSchedule = async (
  schoolId: string,
  userId: string,
  input: CreateScheduleSchema,
): Promise<ScheduleResponse> => {

  const section = await prisma.section.findFirst({
    where:   { id: input.sectionId, classId: input.classId },
    include: { class: true },
  });
  if (!section || section.class.schoolId !== schoolId) {
    throw notFound('Section not found', 'SECTION_NOT_FOUND');
  }

  if (input.type === 'CLASS_PERIOD') {
    // Subject match only — a teacher assigned to a subject in ANY class can be
    // scheduled for that subject in ANY other class too, as long as the usual
    // time/teacher/room availability checks below still pass.
    const teaches = await prisma.teacherSubject.findFirst({
      where: { teacherId: input.teacherId!, subjectId: input.subjectId! },
    });
    if (!teaches) {
      throw forbidden('This teacher does not teach this subject', 'SUBJECT_NOT_ASSIGNED');
    }
  }

  const dupPeriod = await prisma.classSchedule.findFirst({
    where: { sectionId: input.sectionId, day: input.day, periodNo: input.periodNo },
  });
  if (dupPeriod) {
    throw conflict('This period number already exists for this section on this day', 'PERIOD_NO_TAKEN');
  }

  await runConflictChecks({
    sectionId: input.sectionId,
    day:       input.day,
    teacherId: input.teacherId ?? null,
    roomNo:    input.roomNo ?? null,
    startTime: input.startTime,
    endTime:   input.endTime,
  });

  const schedule = await prisma.classSchedule.create({
    data: {
      schoolId,
      classId:   input.classId,
      sectionId: input.sectionId,
      day:       input.day,
      type:      input.type,
      periodNo:  input.periodNo,
      subjectId: input.subjectId ?? null,
      teacherId: input.teacherId ?? null,
      roomNo:    input.roomNo ?? null,
      title:     input.title ?? null,
      startTime: input.startTime,
      endTime:   input.endTime,
      createdBy: userId,
    },
    include: SCHEDULE_INCLUDE,
  });

  return toScheduleResponse(schedule);
};

// ── List schedule entries (filters, no pagination — bounded dataset) ─
export const listSchedule = async (schoolId: string, query: ListScheduleQuerySchema) => {
  const where: Prisma.ClassScheduleWhereInput = {
    schoolId,
    ...(query.classId ? { classId: query.classId } : {}),
    ...(query.sectionId ? { sectionId: query.sectionId } : {}),
    ...(query.day ? { day: query.day } : {}),
    ...(query.teacherId ? { teacherId: query.teacherId } : {}),
  };

  const entries = await prisma.classSchedule.findMany({
    where,
    include: SCHEDULE_INCLUDE,
    orderBy: [{ day: 'asc' }, { periodNo: 'asc' }],
  });

  return entries.map(toScheduleResponse);
};

// ── Get one entry ───────────────────────────────────────────────
export const getScheduleById = async (schoolId: string, scheduleId: string): Promise<ScheduleResponse> => {
  const schedule = await prisma.classSchedule.findFirst({
    where:   { id: scheduleId, schoolId },
    include: SCHEDULE_INCLUDE,
  });
  if (!schedule) throw notFound('Schedule entry not found', 'SCHEDULE_NOT_FOUND');
  return toScheduleResponse(schedule);
};

// ── Update an entry ─────────────────────────────────────────────
// classId/sectionId/type are immutable — delete + recreate if those need
// to change (mirrors how Homework/Exam updates are scoped).
export const updateSchedule = async (
  schoolId: string,
  scheduleId: string,
  input: UpdateScheduleSchema,
): Promise<ScheduleResponse> => {

  const existing = await prisma.classSchedule.findFirst({ where: { id: scheduleId, schoolId } });
  if (!existing) throw notFound('Schedule entry not found', 'SCHEDULE_NOT_FOUND');

  if (existing.type === 'BREAK' && (input.subjectId || input.teacherId)) {
    throw badRequest('BREAK entries cannot have a subjectId/teacherId', 'INVALID_FOR_BREAK');
  }

  const subjectId = input.subjectId !== undefined ? input.subjectId : existing.subjectId;
  const teacherId = input.teacherId !== undefined ? input.teacherId : existing.teacherId;

  if (existing.type === 'CLASS_PERIOD' && (input.subjectId || input.teacherId)) {
    // Subject match only — see the same note in createSchedule above.
    const teaches = await prisma.teacherSubject.findFirst({
      where: { teacherId: teacherId!, subjectId: subjectId! },
    });
    if (!teaches) {
      throw forbidden('This teacher does not teach this subject', 'SUBJECT_NOT_ASSIGNED');
    }
  }

  const day      = input.day ?? existing.day;
  const periodNo = input.periodNo ?? existing.periodNo;

  if (input.day !== undefined || input.periodNo !== undefined) {
    const dupPeriod = await prisma.classSchedule.findFirst({
      where: { sectionId: existing.sectionId, day, periodNo, NOT: { id: scheduleId } },
    });
    if (dupPeriod) {
      throw conflict('This period number already exists for this section on this day', 'PERIOD_NO_TAKEN');
    }
  }

  await runConflictChecks({
    sectionId: existing.sectionId,
    day,
    teacherId: teacherId ?? null,
    roomNo:    (input.roomNo !== undefined ? input.roomNo : existing.roomNo) ?? null,
    startTime: input.startTime ?? existing.startTime,
    endTime:   input.endTime ?? existing.endTime,
    excludeId: scheduleId,
  });

  const schedule = await prisma.classSchedule.update({
    where:   { id: scheduleId },
    data:    input,
    include: SCHEDULE_INCLUDE,
  });

  return toScheduleResponse(schedule);
};

// ── Delete an entry ─────────────────────────────────────────────
export const deleteSchedule = async (schoolId: string, scheduleId: string): Promise<void> => {
  const existing = await prisma.classSchedule.findFirst({ where: { id: scheduleId, schoolId } });
  if (!existing) throw notFound('Schedule entry not found', 'SCHEDULE_NOT_FOUND');

  await prisma.classSchedule.delete({ where: { id: scheduleId } });
};

// ── A section's full weekly timetable, grouped by day ────────────
export const getSectionTimetable = async (schoolId: string, sectionId: string) => {
  const section = await prisma.section.findFirst({
    where:   { id: sectionId },
    include: { class: true },
  });
  if (!section || section.class.schoolId !== schoolId) {
    throw notFound('Section not found', 'SECTION_NOT_FOUND');
  }

  const entries = await prisma.classSchedule.findMany({
    where:   { sectionId },
    include: SCHEDULE_INCLUDE,
    orderBy: [{ day: 'asc' }, { periodNo: 'asc' }],
  });

  const timetable: Record<string, ScheduleResponse[]> = {};
  for (const e of entries) {
    const day = e.day;
    (timetable[day] ??= []).push(toScheduleResponse(e));
  }

  return {
    sectionId:   section.id,
    sectionName: section.name,
    className:   section.class.name,
    timetable,
  };
};

// ── A specific teacher's full weekly schedule, grouped by day ────
export const getTeacherTimetable = async (schoolId: string, teacherId: string) => {
  const teacher = await prisma.teacher.findFirst({
    where:   { id: teacherId, schoolId },
    include: { user: true },
  });
  if (!teacher) throw notFound('Teacher not found', 'TEACHER_NOT_FOUND');

  const entries = await prisma.classSchedule.findMany({
    where:   { teacherId },
    include: SCHEDULE_INCLUDE,
    orderBy: [{ day: 'asc' }, { periodNo: 'asc' }],
  });

  const timetable: Record<string, ScheduleResponse[]> = {};
  for (const e of entries) {
    const day = e.day;
    (timetable[day] ??= []).push(toScheduleResponse(e));
  }

  return {
    teacherId:   teacher.id,
    teacherName: teacher.user.name,
    timetable,
  };
};
