-- AlterTable
ALTER TABLE "teacher_attendance_records" ADD COLUMN     "teacherCheckOutAt" TIMESTAMP(3),
ADD COLUMN     "teacherCheckOutLatitude" DOUBLE PRECISION,
ADD COLUMN     "teacherCheckOutLongitude" DOUBLE PRECISION;
