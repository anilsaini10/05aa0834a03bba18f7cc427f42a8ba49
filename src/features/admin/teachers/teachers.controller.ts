import { Request, Response, NextFunction } from 'express';
import * as teachersService from './teachers.service';
import {
  createTeacherSchema,
  updateTeacherSchema,
  assignSubjectSchema,
  listTeachersQuerySchema,
} from './teachers.validation';
import { sendSuccess } from '../../../shared/utils/apiResponse';
import { isBulkBody, parseBulkRequest } from '../../../shared/utils/bulkImport';
import { bulkCreateTeachers } from './teachers.bulk';

// ── POST /admin/teachers ──────────────────────────────────────
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
      const result = await bulkCreateTeachers(schoolId, rows, dryRun);
      sendSuccess(res, result, dryRun ? 200 : 201);
      return;
    }

    const input    = createTeacherSchema.parse(req.body);
    const result   = await teachersService.createTeacher(schoolId, input);
    sendSuccess(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /admin/teachers/:teacherId ───────────────────────────
export const updateHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input    = updateTeacherSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    const result   = await teachersService.updateTeacher(schoolId, req.params.teacherId, input);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── POST /admin/teachers/:teacherId/subjects ──────────────────
export const assignSubjectHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input    = assignSubjectSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    const result   = await teachersService.assignSubject(schoolId, req.params.teacherId, input);
    sendSuccess(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ── DELETE /admin/teachers/:teacherId/subjects/:subjectId/:classId ─
export const removeSubjectAssignmentHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;
    const result   = await teachersService.removeSubjectAssignment(
      schoolId, req.params.teacherId, req.params.subjectId, req.params.classId,
    );
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /admin/teachers/:teacherId ────────────────────────────
export const getByIdHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;
    const teacher  = await teachersService.getTeacherById(schoolId, req.params.teacherId);
    sendSuccess(res, teacher);
  } catch (err) {
    next(err);
  }
};

// ── DELETE /admin/teachers/:teacherId — soft delete ────────────
export const deleteHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;
    const result   = await teachersService.deleteTeacher(schoolId, req.params.teacherId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// ── GET /admin/teachers ───────────────────────────────────────
export const listHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query    = listTeachersQuerySchema.parse(req.query);
    const schoolId = (req as any).user.schoolId;
    const result   = await teachersService.listTeachers(schoolId, query);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};
