import { z } from 'zod';
import { prisma } from '../../../config/db';
import { hashPassword } from '../../../shared/utils/hash';
import { generateDefaultPassword } from '../../../shared/utils/defaultPassword';
import { RECORD_STATUS } from '../../../constants';
import {
  cellString, optionalCellString, cellNumber, cellGender, cellDate, cellPhone,
  parseRows, bulkValidationError, findDuplicates, BulkRowResult,
} from '../../../shared/utils/bulkImport';

// ════════════════════════════════════════════════════════════
// Bulk create students (from an Excel upload) — same rules as the single
// create, applied to every row first; nothing is saved unless every row
// is valid. Class/section can be given by name ("Class 5" / "A") or id.
// Siblings sharing a parent phone get one parent account.
// ════════════════════════════════════════════════════════════

export const bulkStudentRowSchema = z.object({
  name:        cellString(z.string({ required_error: 'name is required' }).min(2, 'Name must be at least 2 characters').max(100)),
  gender:      cellGender,
  dateOfBirth: cellDate('dateOfBirth'),
  classId:     optionalCellString(z.string().uuid('Invalid class id')),
  className:   optionalCellString(z.string().max(100)),
  sectionId:   optionalCellString(z.string().uuid('Invalid section id')),
  sectionName: optionalCellString(z.string().max(50)),
  rollNo:      cellNumber(z.number({ required_error: 'rollNo is required', invalid_type_error: 'rollNo must be a number' })
                 .int('Roll number must be a whole number').positive('Roll number must be a positive integer')),
  parentName:  cellString(z.string({ required_error: 'parentName is required' }).min(2, 'Parent name must be at least 2 characters').max(100)),
  parentPhone: cellPhone('parentPhone'),
  parentEmail: cellString(z.string({ required_error: 'parentEmail is required' }).email('Invalid parent email address')),
  bloodGroup:  optionalCellString(z.string().max(10)),
  address:     optionalCellString(z.string().max(300)),
})
  .refine(r => r.classId || r.className,     { message: 'className is required', path: ['className'] })
  .refine(r => r.sectionId || r.sectionName, { message: 'sectionName is required', path: ['sectionName'] });

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
// "Class 5" matches "class 5", "CLASS  5" and also just "5".
const sameClassName = (stored: string, given: string) =>
  norm(stored) === norm(given) || norm(stored) === norm(`class ${given}`);

export const bulkCreateStudents = async (schoolId: string, rows: unknown[], dryRun: boolean) => {
  const parsed  = parseRows(rows, bulkStudentRowSchema);
  const results: BulkRowResult[] = parsed.map(p => ({
    index: p.index, status: p.errors.length ? 'error' : 'valid', ...(p.errors.length ? { errors: [...p.errors] } : {}),
  }));
  const addError = (index: number, message: string) => {
    const r = results[index];
    r.status = 'error';
    (r.errors ??= []).push(message);
  };

  // ── Resolve class + section (by id or name) ──────────────────
  const classes = await prisma.class.findMany({ where: { schoolId }, include: { sections: true } });
  const resolved: { index: number; data: z.infer<typeof bulkStudentRowSchema>; classId: string; sectionId: string }[] = [];

  for (const p of parsed) {
    if (!p.data) continue;
    const r = p.data;
    const klass = r.classId
      ? classes.find(c => c.id === r.classId)
      : classes.find(c => sameClassName(c.name, r.className!));
    if (!klass) { addError(p.index, `className: Class "${r.className ?? r.classId}" not found`); continue; }

    const section = r.sectionId
      ? klass.sections.find(s => s.id === r.sectionId)
      : klass.sections.find(s => norm(s.name) === norm(r.sectionName!));
    if (!section) { addError(p.index, `sectionName: Section "${r.sectionName ?? r.sectionId}" not found in ${klass.name}`); continue; }

    resolved.push({ index: p.index, data: r, classId: klass.id, sectionId: section.id });
  }

  // ── Roll numbers: unique per section among ACTIVE students ───
  const taken = new Set(
    (await prisma.student.findMany({
      where:  { sectionId: { in: [...new Set(resolved.map(r => r.sectionId))] }, status: RECORD_STATUS.ACTIVE },
      select: { sectionId: true, rollNo: true },
    })).map(s => `${s.sectionId}:${s.rollNo}`),
  );
  const rollDupes = findDuplicates(resolved.map(r => ({ index: r.index, key: `${r.sectionId}:${r.data.rollNo}` })));
  for (const r of resolved) {
    if (taken.has(`${r.sectionId}:${r.data.rollNo}`)) addError(r.index, `rollNo: Roll number ${r.data.rollNo} is already taken in this section`);
    if (rollDupes.has(r.index)) addError(r.index, `rollNo: Same class, section and roll number as row index ${rollDupes.get(r.index)}`);
  }

  // ── Parents: reuse an existing PARENT of this school (matched by phone
  //    or email, like the single create); otherwise one new account per
  //    phone, shared by siblings in the file. ─────────────────────────
  const existingUsers = await prisma.user.findMany({
    where: { OR: [
      { phone: { in: resolved.map(r => r.data.parentPhone) } },
      { email: { in: resolved.map(r => r.data.parentEmail) } },
    ] },
  });
  const byPhone = new Map(existingUsers.filter(u => u.phone).map(u => [u.phone!, u]));
  const byEmail = new Map(existingUsers.map(u => [u.email, u]));

  const parentOf    = new Map<number, string>();                       // row index → existing parent userId
  const newParents  = new Map<string, { name: string; email: string; firstIndex: number }>(); // phone → new account
  const newEmailOwner = new Map<string, string>();                     // email → phone of the new account using it

  for (const r of resolved) {
    const phoneUser = byPhone.get(r.data.parentPhone);
    const emailUser = byEmail.get(r.data.parentEmail);

    if (phoneUser && emailUser && phoneUser.id !== emailUser.id) {
      addError(r.index, 'parentEmail: This email and phone belong to two different accounts');
      continue;
    }
    const existing = phoneUser ?? emailUser;
    if (existing) {
      if (existing.role !== 'PARENT' || existing.schoolId !== schoolId) {
        addError(r.index, 'parentPhone: Email or phone number already registered to a different account');
      } else {
        parentOf.set(r.index, existing.id);
      }
      continue;
    }

    const owner = newEmailOwner.get(r.data.parentEmail);
    if (owner && owner !== r.data.parentPhone) {
      addError(r.index, `parentEmail: Same parent email used with a different phone (row index ${newParents.get(owner)!.firstIndex})`);
      continue;
    }
    if (!newParents.has(r.data.parentPhone)) {
      newParents.set(r.data.parentPhone, { name: r.data.parentName, email: r.data.parentEmail, firstIndex: r.index });
      newEmailOwner.set(r.data.parentEmail, r.data.parentPhone);
    }
  }

  const invalid = results.filter(r => r.status === 'error').length;
  if (dryRun) {
    return { dryRun: true, total: results.length, valid: results.length - invalid, invalid, created: 0, results };
  }
  if (invalid > 0) throw bulkValidationError(results);

  // ── Save everything in one transaction ───────────────────────
  // All new parents get the same default password → hash it once.
  const firstNew        = [...newParents.values()][0];
  const defaultPassword = generateDefaultPassword(firstNew?.email ?? '');
  const passwordHash    = newParents.size ? await hashPassword(defaultPassword) : '';

  try {
    const created = await prisma.$transaction(async (tx) => {
      const parents = newParents.size
        ? await tx.user.createManyAndReturn({
            data: [...newParents.entries()].map(([phone, p]) => ({
              name: p.name, email: p.email, phone, passwordHash, role: 'PARENT' as const, schoolId,
            })),
          })
        : [];
      const newParentId = new Map(parents.map(u => [u.phone!, u.id]));

      const start    = await tx.student.count({ where: { schoolId } });
      const students = await tx.student.createManyAndReturn({
        data: resolved.map((r, i) => ({
          admissionNo:  `ADM${String(start + i + 1).padStart(4, '0')}`,
          name:         r.data.name,
          gender:       r.data.gender,
          dateOfBirth:  r.data.dateOfBirth,
          classId:      r.classId,
          sectionId:    r.sectionId,
          rollNo:       r.data.rollNo,
          parentUserId: parentOf.get(r.index) ?? newParentId.get(r.data.parentPhone)!,
          parentName:   r.data.parentName,
          parentPhone:  r.data.parentPhone,
          parentEmail:  r.data.parentEmail,
          bloodGroup:   r.data.bloodGroup ?? null,
          address:      r.data.address ?? null,
          schoolId,
        })),
      });
      return { start, students };
    }, { maxWait: 10_000, timeout: 120_000 });

    // Match created rows back to the upload by their admission number.
    const byAdmission = new Map(created.students.map(st => [st.admissionNo, st]));
    resolved.forEach((r, i) => {
      const s = byAdmission.get(`ADM${String(created.start + i + 1).padStart(4, '0')}`)!;
      Object.assign(results[r.index], {
        status:      'created',
        id:          s.id,
        admissionNo: s.admissionNo,
        name:        s.name,
        parentAccount: {
          isNew: !parentOf.has(r.index),
          email: r.data.parentEmail,
        },
      });
    });

    return {
      dryRun:            false,
      total:             results.length,
      valid:             results.length,
      invalid:           0,
      created:           created.students.length,
      newParentAccounts: newParents.size,
      ...(newParents.size ? { defaultPassword } : {}),
      results,
    };
  } catch (err: any) {
    // Someone created a clashing parent between the checks and the insert.
    if (err?.code === 'P2002') {
      const e = new Error('Some records changed while importing — please upload again') as any;
      e.code = 'BULK_CONFLICT'; e.statusCode = 409;
      throw e;
    }
    throw err;
  }
};
