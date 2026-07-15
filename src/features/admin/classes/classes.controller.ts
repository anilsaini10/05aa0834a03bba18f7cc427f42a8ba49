import { Request, Response, NextFunction } from 'express';
import * as classesService from './classes.service';
import {
  createClassSchema,
  addSectionSchema,
  addClassSubjectSchema,
  updateClassSchema,
  updateSectionSchema,
} from './classes.validation';
import { sendSuccess } from '../../../shared/utils/apiResponse';

// ── GET /classes ──────────────────────────────────────────────
export const listHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;
    const classes  = await classesService.listClasses(schoolId);
    sendSuccess(res, classes);
  } catch (err) {
    next(err);
  }
};

// ── POST /classes ─────────────────────────────────────────────
export const createHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input    = createClassSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    const klass    = await classesService.createClass(schoolId, input);
    sendSuccess(res, klass, 201);
  } catch (err) {
    next(err);
  }
};

// ── POST /classes/:classId/sections ───────────────────────────
export const addSectionHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input    = addSectionSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    const section  = await classesService.addSection(schoolId, req.params.classId, input);
    sendSuccess(res, section, 201);
  } catch (err) {
    next(err);
  }
};

// ── POST /classes/:classId/subjects ───────────────────────────
export const addSubjectHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { subjectId } = addClassSubjectSchema.parse(req.body);
    const schoolId       = (req as any).user.schoolId;
    const subjects        = await classesService.addSubjectToClass(schoolId, req.params.classId, subjectId);
    sendSuccess(res, { classId: req.params.classId, subjects });
  } catch (err) {
    next(err);
  }
};

// ── PATCH /classes/:classId ────────────────────────────────────
export const updateHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input    = updateClassSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    const klass    = await classesService.updateClass(schoolId, req.params.classId, input);
    sendSuccess(res, klass);
  } catch (err) {
    next(err);
  }
};

// ── DELETE /classes/:classId ───────────────────────────────────
export const deleteHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;
    await classesService.deleteClass(schoolId, req.params.classId);
    sendSuccess(res, { message: 'Class deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ── PATCH /classes/:classId/sections/:sectionId ────────────────
export const updateSectionHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input    = updateSectionSchema.parse(req.body);
    const schoolId = (req as any).user.schoolId;
    const section  = await classesService.updateSection(schoolId, req.params.classId, req.params.sectionId, input);
    sendSuccess(res, section);
  } catch (err) {
    next(err);
  }
};

// ── DELETE /classes/:classId/sections/:sectionId ───────────────
export const deleteSectionHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const schoolId = (req as any).user.schoolId;
    await classesService.deleteSection(schoolId, req.params.classId, req.params.sectionId);
    sendSuccess(res, { message: 'Section deleted successfully' });
  } catch (err) {
    next(err);
  }
};
