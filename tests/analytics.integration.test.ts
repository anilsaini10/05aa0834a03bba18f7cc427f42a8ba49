// Analytics against a real Postgres, in a throwaway schema.
//   TEST_DATABASE_URL="postgresql://…/db?schema=analytics_test" npm run test:integration
// Pushes the Prisma schema into that schema, seeds two schools, asserts,
// then DROPs the schema. Refuses to run unless the schema name contains
// "test", so it can never touch real data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

const url = process.env.TEST_DATABASE_URL;
const schemaName = url ? new URL(url).searchParams.get('schema') : null;
const enabled = !!url && !!schemaName && schemaName.includes('test');
if (url && !enabled) throw new Error('TEST_DATABASE_URL must set ?schema=<name containing "test">');

// Must be set before the app's prisma client is created.
if (enabled) process.env.DATABASE_URL = url;
process.env.NODE_ENV = 'test';

let prisma: any, resolveContext: any, svc: any, v: any;
const ids: Record<string, string> = {};

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

before(async () => {
  if (!enabled) return;
  execSync('npx prisma db push --skip-generate', { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
  ({ prisma } = require('../src/config/db'));
  ({ resolveContext } = require('../src/features/admin/analytics/analytics.context'));
  v = require('../src/features/admin/analytics/analytics.validation');
  svc = {
    ...require('../src/features/admin/analytics/academics.service'),
    ...require('../src/features/admin/analytics/attendance.service'),
    ...require('../src/features/admin/analytics/homework.service'),
    ...require('../src/features/admin/analytics/enrollment.service'),
  };

  // ── School A ──
  const a = await prisma.school.create({ data: { name: 'A', academicSessionStartMonth: 4 } });
  const admin  = await prisma.user.create({ data: { name: 'Admin A', email: 'admin@a.t', passwordHash: 'x', role: 'ADMIN', schoolId: a.id } });
  const parent = await prisma.user.create({ data: { name: 'Parent A', email: 'parent@a.t', passwordHash: 'x', role: 'PARENT', schoolId: a.id } });
  const tUser  = await prisma.user.create({ data: { name: 'Teacher A', email: 'teacher@a.t', passwordHash: 'x', role: 'TEACHER', schoolId: a.id } });
  const c1 = await prisma.class.create({ data: { name: 'Class 1', numericLevel: 1, schoolId: a.id } });
  const s1 = await prisma.section.create({ data: { name: 'A', classId: c1.id, capacity: 10 } });
  const [math, sci, eng] = await Promise.all(['Math', 'Science', 'English'].map(n => prisma.subject.create({ data: { name: n, schoolId: a.id } })));
  const teacher = await prisma.teacher.create({ data: { employeeId: 'T1', userId: tUser.id, gender: 'MALE', joiningDate: day('2020-01-01'), salary: 1, schoolId: a.id } });
  await prisma.teacherSubject.create({ data: { teacherId: teacher.id, subjectId: math.id, classId: c1.id } });

  const student = (n: number, status = 'ACTIVE') => prisma.student.create({ data: {
    admissionNo: `A${n}`, name: `Student ${n}`, gender: n % 2 ? 'MALE' : 'FEMALE', dateOfBirth: day('2018-01-01'),
    classId: c1.id, sectionId: s1.id, rollNo: n, parentUserId: parent.id, parentName: 'P', parentPhone: '9000000000',
    parentEmail: 'p@a.t', schoolId: a.id, status,
  } });
  const [st1, st2, st3, st4] = [await student(1), await student(2), await student(3), await student(4, 'INACTIVE')];

  // Exam: Math /50, Science /100, English /20 — all on 2026-07-15.
  const exam = await prisma.exam.create({ data: { schoolId: a.id, title: 'Unit 1', createdBy: admin.id } });
  const paper = (subjectId: string, maxMarks: number) => prisma.examSchedule.create({ data: {
    schoolId: a.id, examId: exam.id, classId: c1.id, subjectId, date: day('2026-07-15'), startTime: '09:00', endTime: '10:00', maxMarks, createdBy: admin.id,
  } });
  const [pm, ps, pe] = [await paper(math.id, 50), await paper(sci.id, 100), await paper(eng.id, 20)];
  const mark = (examScheduleId: string, studentId: string, status: string, marksObtained: number | null) =>
    prisma.examMark.create({ data: { examScheduleId, studentId, status, marksObtained } });
  await mark(pm.id, st1.id, 'GRADED', 40);   // 80%
  await mark(ps.id, st1.id, 'GRADED', 90);   // 90%
  await mark(pe.id, st1.id, 'GRADED', 10);   // 50%  (English /20 — normalized)
  await mark(pm.id, st2.id, 'GRADED', 10);   // 20% → fail
  await mark(ps.id, st2.id, 'ABSENT', null); // absent, not a fail
  await mark(pm.id, st3.id, 'PENDING', null);// pending, not a fail
  await mark(ps.id, st3.id, 'GRADED', 50);   // 50%
  // English: st2 and st3 have NO row → 2 missing entries (st4 inactive: not expected)

  // Attendance (2026-07-05 is a Sunday → its row is ignored)
  const att = (studentId: string, date: string, status: string) => prisma.attendanceRecord.create({ data: {
    schoolId: a.id, studentId, classId: c1.id, sectionId: s1.id, date: day(date), status, markedBy: admin.id,
  } });
  for (const d of ['2026-07-06', '2026-07-07', '2026-07-08']) { await att(st1.id, d, 'PRESENT'); await att(st2.id, d, 'ABSENT'); }
  await att(st1.id, '2026-07-05', 'ABSENT');
  await att(st3.id, '2026-07-06', 'PRESENT'); await att(st3.id, '2026-07-07', 'LEAVE'); await att(st3.id, '2026-07-08', 'LATE');
  await att(st3.id, '2026-07-09', 'HOLIDAY');

  // Homework for section A, checked for 2 of 3 active students.
  const hw = await prisma.homework.create({ data: {
    schoolId: a.id, classId: c1.id, sectionId: s1.id, subjectId: math.id, title: 'HW', dueDate: day('2026-07-10'), createdBy: tUser.id,
  } });
  await prisma.homeworkSubmission.create({ data: { homeworkId: hw.id, studentId: st1.id, status: 'SUBMITTED', markedBy: tUser.id } });
  await prisma.homeworkSubmission.create({ data: { homeworkId: hw.id, studentId: st2.id, status: 'NOT_SUBMITTED', markedBy: tUser.id } });

  // ── School B (must never leak into A) ──
  const b = await prisma.school.create({ data: { name: 'B', academicSessionStartMonth: 4 } });
  const bAdmin  = await prisma.user.create({ data: { name: 'Admin B', email: 'admin@b.t', passwordHash: 'x', role: 'ADMIN', schoolId: b.id } });
  const bParent = await prisma.user.create({ data: { name: 'Parent B', email: 'parent@b.t', passwordHash: 'x', role: 'PARENT', schoolId: b.id } });
  const bc = await prisma.class.create({ data: { name: 'Class 1', numericLevel: 1, schoolId: b.id } });
  const bs = await prisma.section.create({ data: { name: 'A', classId: bc.id, capacity: 10 } });
  const bst = await prisma.student.create({ data: {
    admissionNo: 'B1', name: 'B Student', gender: 'MALE', dateOfBirth: day('2018-01-01'), classId: bc.id, sectionId: bs.id, rollNo: 1,
    parentUserId: bParent.id, parentName: 'P', parentPhone: '9000000001', parentEmail: 'p@b.t', schoolId: b.id,
  } });
  await prisma.attendanceRecord.create({ data: { schoolId: b.id, studentId: bst.id, classId: bc.id, sectionId: bs.id, date: day('2026-07-06'), status: 'ABSENT', markedBy: bAdmin.id } });

  Object.assign(ids, {
    a: a.id, b: b.id, c1: c1.id, bc: bc.id, teacher: teacher.id, st2: st2.id, st3: st3.id, st4: st4.id,
    admin: admin.id, tUser: tUser.id, parent: parent.id, bStudent: bst.id, bAdmin: bAdmin.id,
  });
});

after(async () => {
  if (!enabled) return;
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await prisma.$disconnect();
});

const ctxFor = (query: Record<string, string> = {}) =>
  resolveContext(ids.a, v.analyticsQuerySchema.parse({ year: '2026', ...query }));

test('paper-level stats: normalized, absent/pending not failed', { skip: !enabled }, async () => {
  const s = await svc.overallPaperStats(await ctxFor());
  assert.equal(s.gradedPapers, 5);
  assert.equal(s.passCount, 4);
  assert.equal(s.failCount, 1);
  assert.equal(s.absentCount, 1);
  assert.equal(s.pendingCount, 1);
  assert.equal(s.passPercentage, 80);
  assert.equal(s.averagePercentage, 58);   // (80+90+50+20+50)/5
  assert.equal(s.medianPercentage, 50);
  assert.equal(s.highestPercentage, 90);
  assert.equal(s.lowestPercentage, 20);
});

test('student-exam outcomes and missing marks', { skip: !enabled }, async () => {
  const ctx = await ctxFor();
  const o = await svc.studentExamOutcomes(ctx);
  assert.deepEqual([o.passCount, o.failCount, o.pendingCount, o.absentCount], [1, 1, 1, 0]);
  assert.equal(o.passPercentage, 50);
  const m = await svc.missingMarkEntries(ctx);
  assert.equal(m.missingMarkEntries, 2);      // English: st2, st3 (inactive st4 not expected)
  assert.equal(m.papersWithMissingEntries, 1);
});

test('passPercentage filter changes outcomes', { skip: !enabled }, async () => {
  const s = await svc.overallPaperStats(await ctxFor({ passPercentage: '60' }));
  assert.equal(s.passCount, 2);  // 80, 90
  assert.equal(s.failCount, 3);
});

test('teacher filter = their assigned class+subject only', { skip: !enabled }, async () => {
  const s = await svc.overallPaperStats(await ctxFor({ teacherId: ids.teacher }));
  assert.equal(s.gradedPapers, 2);           // Math: 80%, 20%
  assert.equal(s.averagePercentage, 50);
  assert.equal(s.pendingCount, 1);
});

test('attendance: Sunday and HOLIDAY rows excluded', { skip: !enabled }, async () => {
  const s = await svc.studentAttendanceTotals(await ctxFor());
  assert.equal(s.markedRecords, 9);
  assert.equal(s.present, 4);
  assert.equal(s.late, 1);
  assert.equal(s.absent, 3);
  assert.equal(s.approvedLeave, 1);
  assert.equal(s.attendancePercentage, 55.56);
});

test('low attendance + repeated absences', { skip: !enabled }, async () => {
  const ctx = await ctxFor();
  const low = await svc.lowAttendanceRows(ctx, 75, 1);
  assert.deepEqual(low.map((r: any) => [r.studentId, r.attendancePercentage]), [[ids.st2, 0], [ids.st3, 66.67]]);
  const rep = await svc.repeatedAbsenceRows(ctx, 3);
  assert.equal(rep.length, 1);
  assert.equal(rep[0].studentId, ids.st2);
  assert.equal(rep[0].currentStreak, 3);
  assert.equal(rep[0].ongoing, true);
});

test('homework rates use eligible students', { skip: !enabled }, async () => {
  const ctx = await ctxFor();
  const s = svc.homeworkSummary(await svc.homeworkRows(ctx), ctx.today);
  assert.equal(s.expectedSubmissions, 3);    // 3 active students in the section
  assert.equal(s.submissionRate, 50);
  assert.equal(s.completionRate, 33.33);
  assert.equal(s.checkingCompletionRate, 66.67);
  assert.equal(s.notCheckedYet, 1);
});

test('enrollment counts each student once; previous year empty → null growth', { skip: !enabled }, async () => {
  const e = await svc.enrollmentSnapshot(await ctxFor());
  assert.equal(e.currentEnrollment, 3);
  assert.equal(e.previousEnrollment, 0);
  assert.equal(e.growthPercentage, null);
  assert.equal(e.retentionRate, null);
  assert.equal(e.activeStudents, 3);
  assert.equal(e.inactiveStudents, 1);
});

test('different academic year sees none of this data', { skip: !enabled }, async () => {
  const ctx = await resolveContext(ids.a, v.analyticsQuerySchema.parse({ year: '2025' }));
  assert.equal((await svc.overallPaperStats(ctx)).gradedPapers, 0);
  assert.equal((await svc.studentAttendanceTotals(ctx)).attendancePercentage, null);
});

test('cross-school: foreign ids are 404, totals exclude other schools', { skip: !enabled }, async () => {
  await assert.rejects(ctxFor({ classId: ids.bc }), (e: any) => e.statusCode === 404 && e.code === 'CLASS_NOT_FOUND');
  const s = await svc.studentAttendanceTotals(await ctxFor());
  assert.equal(s.absent, 3);                 // school B's ABSENT row not counted
});

test('class filter', { skip: !enabled }, async () => {
  const s = await svc.studentAttendanceTotals(await ctxFor({ classId: ids.c1 }));
  assert.equal(s.markedRecords, 9);
});

test('interventions: school-scoped entity + assignee, completion, alert link', { skip: !enabled }, async () => {
  const iv = require('../src/features/admin/interventions/interventions.service');
  const alerts = require('../src/features/admin/analytics/alerts.service');
  const base = { entityType: 'STUDENT', title: 'Call parent', status: 'OPEN' };

  await assert.rejects(iv.createIntervention(ids.a, ids.admin, { ...base, entityId: ids.bStudent }), (e: any) => e.code === 'ENTITY_NOT_FOUND');
  await assert.rejects(iv.createIntervention(ids.a, ids.admin, { ...base, entityId: ids.st2, assignedTo: ids.parent }), (e: any) => e.code === 'INVALID_ASSIGNEE');
  await assert.rejects(iv.createIntervention(ids.a, ids.admin, { ...base, entityId: ids.st2, assignedTo: ids.bAdmin }), (e: any) => e.code === 'INVALID_ASSIGNEE');

  const ctx = await ctxFor();
  const q = v.alertsQuerySchema.parse({ year: '2026' });
  const before = await alerts.getAlerts(ctx, q);
  const lowAtt = before.alerts.find((a: any) => a.type === 'REPEATED_ABSENCE' && a.entity.id === ids.st2);
  assert.ok(lowAtt);
  assert.equal(lowAtt.status, 'OPEN');

  const created = await iv.createIntervention(ids.a, ids.admin, {
    ...base, entityId: ids.st2, alertKey: lowAtt.key, alertType: lowAtt.type, assignedTo: ids.tUser, dueDate: day('2026-01-01'),
  });
  assert.equal(created.overdue, true);
  const after = await alerts.getAlerts(ctx, q);
  const linked = after.alerts.find((a: any) => a.key === lowAtt.key);
  assert.equal(linked.status, 'OPEN');
  assert.equal(linked.assignedTo.id, ids.tUser);

  const done = await iv.updateIntervention(ids.a, ids.admin, created.id, { status: 'COMPLETED', outcome: 'Parent informed' });
  assert.equal(done.status, 'COMPLETED');
  assert.ok(done.completedAt);
  assert.equal(done.overdue, false);
  await assert.rejects(iv.getIntervention(ids.b, created.id), (e: any) => e.statusCode === 404);   // other school can't read it

  // The assignee got an in-app notification.
  assert.equal(await prisma.notification.count({ where: { userId: ids.tUser, type: 'INTERVENTION' } }), 1);
});
