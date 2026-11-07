import { Request, Response, NextFunction } from 'express';
import * as svc from './teacherSyllabus.service';
import {
  assignedSyllabusQuerySchema,
  submitProgressSchema,
  overallProgressQuerySchema,
} from './teacherSyllabus.validation';
import { sendSuccess } from '../../shared/utils/apiResponse';

const userOf = (req: Request) => (req as any).user as { sub: string; schoolId: string };

const resolveTeacher = async (req: Request) => {
  const { sub, schoolId } = userOf(req);
  const teacher = await svc.getTeacherByUserId(sub);
  return { teacherId: teacher.id, schoolId };
};

export const getAssignedSyllabusHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { teacherId, schoolId } = await resolveTeacher(req);
    const query = assignedSyllabusQuerySchema.parse(req.query);
    sendSuccess(res, await svc.getAssignedSyllabus(teacherId, schoolId, query));
  } catch (err) { next(err); }
};

export const getMyClassesAndSubjectsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { teacherId, schoolId } = await resolveTeacher(req);
    sendSuccess(res, await svc.getMyClassesAndSubjects(teacherId, schoolId));
  } catch (err) { next(err); }
};

export const getOverallProgressHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { teacherId, schoolId } = await resolveTeacher(req);
    const query = overallProgressQuerySchema.parse(req.query);
    sendSuccess(res, await svc.getOverallProgress(teacherId, schoolId, query.sessionYear));
  } catch (err) { next(err); }
};

export const getPlanDetailHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { teacherId, schoolId } = await resolveTeacher(req);
    sendSuccess(res, await svc.getPlanDetail(teacherId, schoolId, req.params.planId));
  } catch (err) { next(err); }
};

export const getChapterDetailHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { teacherId, schoolId } = await resolveTeacher(req);
    sendSuccess(res, await svc.getChapterDetail(teacherId, schoolId, req.params.planId, req.params.planChapterId));
  } catch (err) { next(err); }
};

export const startChapterHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { teacherId, schoolId } = await resolveTeacher(req);
    sendSuccess(res, await svc.startChapter(teacherId, schoolId, req.params.planId, req.params.planChapterId));
  } catch (err) { next(err); }
};

export const submitProgressHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { teacherId, schoolId } = await resolveTeacher(req);
    const input = submitProgressSchema.parse(req.body);
    sendSuccess(res, await svc.submitProgress(teacherId, schoolId, req.params.planId, req.params.planChapterId, input));
  } catch (err) { next(err); }
};

export const completeChapterHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { teacherId, schoolId } = await resolveTeacher(req);
    sendSuccess(res, await svc.completeChapter(teacherId, schoolId, req.params.planId, req.params.planChapterId));
  } catch (err) { next(err); }
};
