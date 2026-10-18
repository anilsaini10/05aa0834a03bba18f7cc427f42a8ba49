import { Request, Response, NextFunction } from 'express';
import * as studentsService from './students.service';
import { createStudentSchema, updateStudentSchema, listStudentsQuerySchema } from './students.validation';
import { sendSuccess } from '../../../shared/utils/apiResponse';
import { isBulkBody, parseBulkRequest } from '../../../shared/utils/bulkImport';
import { bulkCreateStudents } from './students.bulk';

// ── POST /admin/students ──────────────────────────────────────
export const createHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;

    // An array (or { rows: [...] }) is a bulk create from an Excel upload;
    // a single object keeps the original behaviour.
    if (isBulkBody(req.body)) {
      const { rows, dryRun } = parseBulkRequest(req.body, req.query);
      const result = await bulkCreateStudents(schoolId, rows, dryRun);
      sendSuccess(res, result, dryRun ? 200 : 201);
      return;
    }

    const input    = createStudentSchema.parse(req.body);
    const result    = await studentsService.createStudent(schoolId, input);
    sendSuccess(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ── GET /admin/students/:studentId ─────────────────────────────
export const getByIdHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;
    const student  = await studentsService.getStudentById(schoolId, req.params.studentId);
    sendSuccess(res, student);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /admin/students/:studentId ───────────────────────────
export const updateHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input    = updateStudentSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    const result   = await studentsService.updateStudent(schoolId, req.params.studentId, input);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── DELETE /admin/students/:studentId — soft delete ────────────
export const deleteHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;
    const result   = await studentsService.deleteStudent(schoolId, req.params.studentId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /admin/students ───────────────────────────────────────
export const listHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query    = listStudentsQuerySchema.parse(req.query);
    const schoolId = (req as any).user.schoolId;
    const result   = await studentsService.listStudents(schoolId, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};
