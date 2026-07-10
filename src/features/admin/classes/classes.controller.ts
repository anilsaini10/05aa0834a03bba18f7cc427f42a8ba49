import { Request, Response, NextFunction } from 'express';
import * as classesService from './classes.service';
import { createClassSchema, addSectionSchema, addClassSubjectSchema } from './classes.validation';
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
