import { z } from 'zod';
import { prisma } from '../../../config/db';
import { hashPassword } from '../../../shared/utils/hash';
import { generateDefaultPassword } from '../../../shared/utils/defaultPassword';
import { USERNAME_PATTERN } from '../../../shared/utils/username';
import {
  cellString, optionalCellString, cellNumber, optionalCellNumber, cellGender, cellDate, cellPhone, cellList,
  parseRows, bulkValidationError, findDuplicates, BulkRowResult,
} from '../../../shared/utils/bulkImport';

// ════════════════════════════════════════════════════════════
// Bulk create teachers (from an Excel upload) — same rules as the single
// create, applied to every row first; nothing is saved unless every row
// is valid. Each teacher gets a login with the default password.
// classTeacherOf takes "Class 5 - A" / "Class 5 A" / "5-A" (or use
// classTeacherSectionId).
// ════════════════════════════════════════════════════════════

export const bulkTeacherRowSchema = z.object({
  name:                  cellString(z.string({ required_error: 'name is required' }).min(2, 'Name must be at least 2 characters').max(100)),
  email:                 cellString(z.string({ required_error: 'email is required' }).email('Invalid email address')),
  username:              optionalCellString(z.string().trim().toLowerCase()
                           .regex(USERNAME_PATTERN, 'Username must be 3-30 characters, start with a letter, and use only letters, digits, "." or "_"')),
  phone:                 cellPhone('phone'),
  gender:                cellGender,
  salary:                cellNumber(z.number({ required_error: 'salary is required', invalid_type_error: 'salary must be a number' })
                           .positive('Salary must be a positive number')),
  qualification:         cellString(z.string({ required_error: 'qualification is required' }).min(1, 'Qualification is required').max(200)),
  experienceYears:       optionalCellNumber(z.number({ invalid_type_error: 'experienceYears must be a number' }).int().min(0, 'experienceYears cannot be negative'), 0),
  experienceMonths:      optionalCellNumber(z.number({ invalid_type_error: 'experienceMonths must be a number' }).int().min(0).max(11, 'experienceMonths must be between 0 and 11'), 0),
  subjects:              cellList.pipe(z.array(z.string()).min(1, 'At least one subject is required')),
  joiningDate:           cellDate('joiningDate'),
  classTeacherOf:        optionalCellString(z.string().max(120)),
  classTeacherSectionId: optionalCellString(z.string().uuid('Invalid section id')),
});

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const sameClassName = (stored: string, given: string) =>
  norm(stored) === norm(given) || norm(stored) === norm(`class ${given}`);

// "Class 5 - A" | "Class 5 A" | "5-A" → { className: "Class 5", sectionName: "A" }
const splitClassSection = (value: string) => {
  const m = value.trim().match(/^(.*?)[\s\-/]+([A-Za-z0-9]+)$/);
  return m ? { className: m[1].trim(), sectionName: m[2] } : null;
};

export const bulkCreateTeachers = async (schoolId: string, rows: unknown[], dryRun: boolean) => {
  const parsed  = parseRows(rows, bulkTeacherRowSchema);
  const results: BulkRowResult[] = parsed.map(p => ({
    index: p.index, status: p.errors.length ? 'error' : 'valid', ...(p.errors.length ? { errors: [...p.errors] } : {}),
  }));
  const addError = (index: number, message: string) => {
    const r = results[index];
    r.status = 'error';
    (r.errors ??= []).push(message);
  };

  const valid = parsed.filter(p => p.data) as { index: number; data: z.infer<typeof bulkTeacherRowSchema> }[];

  // ── Email / phone must be new — in the database and in the file ──
  const existing = valid.length ? await prisma.user.findMany({
    where:  { OR: [
      ...valid.map(v => ({ email: { equals: v.data.email, mode: 'insensitive' as const } })),
      { phone: { in: valid.map(v => v.data.phone) } },
      { username: { in: valid.flatMap(v => (v.data.username ? [v.data.username] : [])) } },
    ] },
    select: { email: true, phone: true, username: true },
  }) : [];
  const takenEmails    = new Set(existing.map(u => u.email.toLowerCase()));
  const takenPhones    = new Set(existing.map(u => u.phone).filter(Boolean));
  const takenUsernames = new Set(existing.map(u => u.username).filter(Boolean));
  const emailDupes     = findDuplicates(valid.map(v => ({ index: v.index, key: v.data.email.toLowerCase() })));
  const phoneDupes     = findDuplicates(valid.map(v => ({ index: v.index, key: v.data.phone })));
  const usernameDupes  = findDuplicates(valid.flatMap(v => (v.data.username ? [{ index: v.index, key: v.data.username }] : [])));

  for (const v of valid) {
    if (takenEmails.has(v.data.email.toLowerCase())) addError(v.index, 'email: Email already registered');
    if (takenPhones.has(v.data.phone))               addError(v.index, 'phone: Phone number already registered');
    if (v.data.username && takenUsernames.has(v.data.username)) addError(v.index, 'username: Username already taken');
    if (emailDupes.has(v.index))    addError(v.index, `email: Same email as row index ${emailDupes.get(v.index)}`);
    if (phoneDupes.has(v.index))    addError(v.index, `phone: Same phone as row index ${phoneDupes.get(v.index)}`);
    if (usernameDupes.has(v.index)) addError(v.index, `username: Same username as row index ${usernameDupes.get(v.index)}`);
  }

  // ── Class teacher section (optional) ────────────────────────
  const classes = await prisma.class.findMany({ where: { schoolId }, include: { sections: true } });
  const allSections = classes.flatMap(c => c.sections.map(s => ({ ...s, className: c.name })));
  const sectionOf = new Map<number, string>(); // row index → sectionId

  for (const v of valid) {
    const { classTeacherSectionId, classTeacherOf } = v.data;
    if (!classTeacherSectionId && !classTeacherOf) continue;

    let section = classTeacherSectionId ? allSections.find(s => s.id === classTeacherSectionId) : undefined;
    if (!classTeacherSectionId && classTeacherOf) {
      const split = splitClassSection(classTeacherOf);
      const klass = split && classes.find(c => sameClassName(c.name, split.className));
      section = klass ? allSections.find(s => s.classId === klass.id && norm(s.name) === norm(split!.sectionName)) : undefined;
    }
    if (!section) { addError(v.index, `classTeacherOf: Section "${classTeacherOf ?? classTeacherSectionId}" not found (use e.g. "Class 5 - A")`); continue; }
    if (section.classTeacherId) { addError(v.index, `classTeacherOf: ${section.className} - ${section.name} already has a class teacher`); continue; }
    sectionOf.set(v.index, section.id);
  }
  const sectionDupes = findDuplicates([...sectionOf.entries()].map(([index, key]) => ({ index, key })));
  for (const [index, first] of sectionDupes) addError(index, `classTeacherOf: Same section as row index ${first}`);

  const invalid = results.filter(r => r.status === 'error').length;
  if (dryRun) {
    return { dryRun: true, total: results.length, valid: results.length - invalid, invalid, created: 0, results };
  }
  if (invalid > 0) throw bulkValidationError(results);

  // ── Save everything in one transaction ───────────────────────
  const defaultPassword = generateDefaultPassword(valid[0].data.email);
  const passwordHash    = await hashPassword(defaultPassword);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const users = await tx.user.createManyAndReturn({
        data: valid.map(v => ({
          name: v.data.name, email: v.data.email, username: v.data.username ?? null, phone: v.data.phone,
          passwordHash, role: 'TEACHER' as const, schoolId,
        })),
      });
      const userIdByEmail = new Map(users.map(u => [u.email.toLowerCase(), u.id]));

      const start    = await tx.teacher.count({ where: { schoolId } });
      const teachers = await tx.teacher.createManyAndReturn({
        data: valid.map((v, i) => ({
          employeeId:       `EMP${String(start + i + 1).padStart(4, '0')}`,
          userId:           userIdByEmail.get(v.data.email.toLowerCase())!,
          gender:           v.data.gender,
          joiningDate:      v.data.joiningDate,
          salary:           v.data.salary,
          qualification:    v.data.qualification,
          experienceYears:  v.data.experienceYears,
          experienceMonths: v.data.experienceMonths,
          subjectsTaught:   v.data.subjects,
          schoolId,
        })),
      });
      const teacherByUser = new Map(teachers.map(t => [t.userId, t]));

      // Only one class teacher per section — the conditional update closes
      // the race with anyone assigning it between the checks and now.
      for (const v of valid) {
        const sectionId = sectionOf.get(v.index);
        if (!sectionId) continue;
        const teacher = teacherByUser.get(userIdByEmail.get(v.data.email.toLowerCase())!)!;
        const done = await tx.section.updateMany({ where: { id: sectionId, classTeacherId: null }, data: { classTeacherId: teacher.id } });
        if (done.count !== 1) {
          const e = new Error('Some records changed while importing — please upload again') as any;
          e.code = 'BULK_CONFLICT'; e.statusCode = 409;
          throw e;
        }
      }

      return { teacherByUser, userIdByEmail };
    }, { maxWait: 10_000, timeout: 120_000 });

    for (const v of valid) {
      const t = created.teacherByUser.get(created.userIdByEmail.get(v.data.email.toLowerCase())!)!;
      Object.assign(results[v.index], {
        status: 'created', id: t.id, userId: t.userId, employeeId: t.employeeId, name: v.data.name, email: v.data.email,
        username: v.data.username ?? null,
      });
    }

    return { dryRun: false, total: results.length, valid: results.length, invalid: 0, created: valid.length, defaultPassword, results };
  } catch (err: any) {
    if (err?.code === 'P2002') {
      const e = new Error('Some records changed while importing — please upload again') as any;
      e.code = 'BULK_CONFLICT'; e.statusCode = 409;
      throw e;
    }
    throw err;
  }
};
