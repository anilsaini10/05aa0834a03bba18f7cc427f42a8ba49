import { Router } from 'express';
import {
  createHandler,
  listHandler,
  getByIdHandler,
  updateHandler,
  deleteHandler,
  addClassHandler,
  listClassesHandler,
  removeClassHandler,
  listClassStudentsHandler,
  createResultHandler,
  getResultHandler,
  updateResultHandler,
  deleteResultHandler,
  createScheduleHandler,
  bulkCreateScheduleHandler,
  listScheduleHandler,
  updateScheduleHandler,
  deleteScheduleHandler,
  listScheduleStudentsHandler,
  saveScheduleMarksHandler,
} from './exams.controller';
import { authGuard } from '../../../middleware/authGuard';
import { roleGuard } from '../../../middleware/roleGuard';

const router = Router();
const admin  = [authGuard, roleGuard('ADMIN')] as const;

// ── Exam CRUD ───────────────────────────────────────────────────
router.post('/',           ...admin, createHandler);
router.get('/',            ...admin, listHandler);
router.get('/:examId',     ...admin, getByIdHandler);
router.patch('/:examId',   ...admin, updateHandler);
router.delete('/:examId',  ...admin, deleteHandler);

// ── Exam ↔ Class assignment ─────────────────────────────────────
router.post('/:examId/classes',              ...admin, addClassHandler);
router.get('/:examId/classes',                ...admin, listClassesHandler);
router.delete('/:examId/classes/:classId',    ...admin, removeClassHandler);

// ── Students within an exam's class ─────────────────────────────
router.get('/:examId/classes/:classId/students', ...admin, listClassStudentsHandler);

// ── Exam results (marks/grade per student) ──────────────────────
router.post('/:examId/results',            ...admin, createResultHandler);
router.get('/:examId/results/:resultId',   ...admin, getResultHandler);
router.patch('/:examId/results/:resultId', ...admin, updateResultHandler);
router.delete('/:examId/results/:resultId', ...admin, deleteResultHandler);

// ── Exam schedule (date sheet: class + subject + date/time + invigilator) ─
router.post('/:examId/schedule',                ...admin, createScheduleHandler);
router.post('/:examId/schedule/bulk',           ...admin, bulkCreateScheduleHandler);
router.get('/:examId/schedule',                 ...admin, listScheduleHandler);
router.patch('/:examId/schedule/:scheduleId',   ...admin, updateScheduleHandler);
router.delete('/:examId/schedule/:scheduleId',  ...admin, deleteScheduleHandler);

// ── Per-subject marks for one paper (admin can view/override) ───────────
router.get('/:examId/schedule/:scheduleId/students', ...admin, listScheduleStudentsHandler);
router.put('/:examId/schedule/:scheduleId/marks',    ...admin, saveScheduleMarksHandler);

export default router;
