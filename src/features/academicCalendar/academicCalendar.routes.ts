import { Router } from 'express';
import {
  getAdminCalendarHandler,
  getTeacherCalendarHandler,
  getParentCalendarHandler,
} from './academicCalendar.controller';
import { authGuard } from '../../middleware/authGuard';
import { roleGuard } from '../../middleware/roleGuard';

// Mounted at /api/admin/academic-calendar, /api/teacher/academic-calendar
// and /api/students/academic-calendar respectively. Calendar entries are
// created/edited through the events API (/api/events, bulk supported).
export const adminCalendarRouter   = Router().get('/', authGuard, roleGuard('ADMIN'),   getAdminCalendarHandler);
export const teacherCalendarRouter = Router().get('/', authGuard, roleGuard('TEACHER'), getTeacherCalendarHandler);
export const parentCalendarRouter  = Router().get('/', authGuard, roleGuard('PARENT'),  getParentCalendarHandler);
