import { z } from 'zod';
import { prisma } from '../../../config/db';
import {
  cellString, optionalCellString, cellNumber, optionalCellNumber, cellGender, cellDate, cellPhone,
  parseRows, bulkValidationError, findDuplicates, BulkRowResult,
} from '../../../shared/utils/bulkImport';

// ════════════════════════════════════════════════════════════
// Bulk create staff (from an Excel upload) — same rules as the single
// create, applied to every row first; nothing is saved unless every row
// is valid. Staff have no login, so no accounts are created.
// ════════════════════════════════════════════════════════════

export const bulkStaffRowSchema = z.object({
  name:             cellString(z.string({ required_error: 'name is required' }).min(2, 'Name must be at least 2 characters').max(100)),
  email:            optionalCellString(z.string().email('Invalid email address')),
  phone:            cellPhone('phone'),
  gender:           cellGender,
  designation:      cellString(z.string({ required_error: 'designation is required' }).min(1, 'Designation is required').max(100)),
  salary:           cellNumber(z.number({ required_error: 'salary is required', invalid_type_error: 'salary must be a number' })
                      .positive('Salary must be a positive number')),
  qualification:    cellString(z.string({ required_error: 'qualification is required' }).min(1, 'Qualification is required').max(200)),
  experienceYears:  optionalCellNumber(z.number({ invalid_type_error: 'experienceYears must be a number' }).int().min(0, 'experienceYears cannot be negative'), 0),
  experienceMonths: optionalCellNumber(z.number({ invalid_type_error: 'experienceMonths must be a number' }).int().min(0).max(11, 'experienceMonths must be between 0 and 11'), 0),
  joiningDate:      cellDate('joiningDate'),
});

export const bulkCreateStaff = async (schoolId: string, rows: unknown[], dryRun: boolean) => {
  const parsed  = parseRows(rows, bulkStaffRowSchema);
  const results: BulkRowResult[] = parsed.map(p => ({
    index: p.index, status: p.errors.length ? 'error' : 'valid', ...(p.errors.length ? { errors: [...p.errors] } : {}),
  }));

  const valid = parsed.filter(p => p.data) as { index: number; data: z.infer<typeof bulkStaffRowSchema> }[];

  // The same phone twice in one file is almost always a duplicated row.
  for (const [index, first] of findDuplicates(valid.map(v => ({ index: v.index, key: v.data.phone })))) {
    results[index].status = 'error';
    (results[index].errors ??= []).push(`phone: Same phone as row index ${first} — duplicated row?`);
  }

  const invalid = results.filter(r => r.status === 'error').length;
  if (dryRun) {
    return { dryRun: true, total: results.length, valid: results.length - invalid, invalid, created: 0, results };
  }
  if (invalid > 0) throw bulkValidationError(results);

  const created = await prisma.$transaction(async (tx) => {
    const start = await tx.staff.count({ where: { schoolId } });
    const staff = await tx.staff.createManyAndReturn({
      data: valid.map((v, i) => ({
        employeeId:       `STF${String(start + i + 1).padStart(4, '0')}`,
        name:             v.data.name,
        email:            v.data.email ?? null,
        phone:            v.data.phone,
        gender:           v.data.gender,
        designation:      v.data.designation,
        salary:           v.data.salary,
        qualification:    v.data.qualification,
        experienceYears:  v.data.experienceYears,
        experienceMonths: v.data.experienceMonths,
        joiningDate:      v.data.joiningDate,
        schoolId,
      })),
    });
    return { start, staff };
  }, { maxWait: 10_000, timeout: 120_000 });

  // Match created rows back to the upload by their employee id.
  const byEmployeeId = new Map(created.staff.map(s => [s.employeeId, s]));
  valid.forEach((v, i) => {
    const s = byEmployeeId.get(`STF${String(created.start + i + 1).padStart(4, '0')}`)!;
    Object.assign(results[v.index], { status: 'created', id: s.id, employeeId: s.employeeId, name: s.name });
  });

  return { dryRun: false, total: results.length, valid: results.length, invalid: 0, created: created.staff.length, results };
};
