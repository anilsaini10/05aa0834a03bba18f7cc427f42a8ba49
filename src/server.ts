import app           from './app';
import { env }        from './config/env';
import { connectDB, disconnectDB } from './config/db';
import { initFirebase } from './config/firebase';

const startServer = async (): Promise<void> => {
  await connectDB();
  initFirebase();

  const server = app.listen(Number(env.PORT), () => {
    console.log('');
    console.log('📚 ─────────────────────────────────────');
    console.log(`🚀  FieldBook API running on port ${env.PORT}`);
    console.log(`🌍  http://localhost:${env.PORT}`);
    console.log(`📦  ENV: ${env.NODE_ENV}`);
    console.log('📚 ─────────────────────────────────────');
    console.log('');
    console.log('  Routes:');
    console.log('  GET  /health');
    console.log('  POST /api/auth/signup');
    console.log('  POST /api/auth/login');
    console.log('  POST /api/auth/refresh');
    console.log('  POST /api/auth/logout');
    console.log('  GET  /api/auth/me');
    console.log('  POST /api/notifications/register');
    console.log('  POST /api/notifications/unregister');
    console.log('  POST /api/notifications/send');
    console.log('  GET  /api/schools');
    console.log('  GET  /api/classes');
    console.log('  POST /api/classes');
    console.log('  POST /api/classes/:classId/sections');
    console.log('  POST /api/classes/:classId/subjects');
    console.log('  GET  /api/subjects');
    console.log('  POST /api/subjects');
    console.log('  POST /api/admin/students');
    console.log('  GET  /api/admin/students');
    console.log('  GET  /api/admin/students/:studentId');
    console.log('  POST /api/admin/teachers');
    console.log('  GET  /api/admin/teachers');
    console.log('  GET  /api/admin/teachers/:teacherId');
    console.log('  POST /api/admin/announcements');
    console.log('  GET  /api/admin/announcements');
    console.log('  GET  /api/admin/announcements/:announcementId');
    console.log('  PATCH /api/admin/announcements/:announcementId');
    console.log('  DELETE /api/admin/announcements/:announcementId');
    console.log('  GET  /api/teacher/profile');
    console.log('  PATCH /api/teacher/profile');
    console.log('  POST /api/teacher/reset-password');
    console.log('  GET  /api/teacher/classes');
    console.log('  GET  /api/teacher/students');
    console.log('  GET  /api/teacher/announcements');
    console.log('  GET  /api/students/profile');
    console.log('  PATCH /api/students/profile');
    console.log('  POST /api/students/reset-password');
    console.log('  GET  /api/students/announcements');
    console.log('');
  });

  // ── Graceful shutdown ──────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down gracefully...`);
    server.close(async () => {
      await disconnectDB();
      console.log('✅ Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
};

startServer().catch(err => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});
