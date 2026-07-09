import express, { Application, Request, Response } from 'express';
import cors    from 'cors';
import { env } from './config/env';

// ── Routes ────────────────────────────────────────────────────
import authRoutes          from './features/auth/auth.routes';
import notificationRoutes  from './features/notifications/notifications.routes';
import schoolRoutes        from './features/schools/schools.routes';
import classRoutes         from './features/classes/classes.routes';
import subjectRoutes       from './features/subjects/subjects.routes';
import studentRoutes       from './features/students/students.routes';
import teacherRoutes       from './features/teachers/teachers.routes';

// ── Middleware ────────────────────────────────────────────────
import { errorHandler } from './middleware/errorHandler';

const app: Application = express();

// ── Core middleware ───────────────────────────────────────────
app.use(cors({
  origin:         env.ALLOWED_ORIGINS.split(','),
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials:    true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Health check ──────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      status:      'ok',
      environment: env.NODE_ENV,
      timestamp:   new Date().toISOString(),
    },
  });
});

// ── API Routes ────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/schools', schoolRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/admin/students', studentRoutes);
app.use('/api/admin/teachers', teacherRoutes);

// ── 404 handler ───────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: { message: 'Route not found', code: 'NOT_FOUND' },
  });
});

// ── Global error handler ──────────────────────────────────────
app.use(errorHandler);

export default app;
