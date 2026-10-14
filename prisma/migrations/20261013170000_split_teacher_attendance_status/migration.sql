-- Split a teacher's attendance for a day into two independent markings:
--   teacherStatus / teacherMarkedAt              — the teacher's own check-in
--   adminStatus / adminMarkedBy / adminMarkedAt  — the admin's marking
-- "status" stays as the final status (= adminStatus ?? teacherStatus).
-- Existing data is carried over (columns renamed, not dropped).

ALTER TABLE "teacher_attendance_records" DROP CONSTRAINT "teacher_attendance_records_markedBy_fkey";

ALTER TABLE "teacher_attendance_records" RENAME COLUMN "checkInAt" TO "teacherMarkedAt";
ALTER TABLE "teacher_attendance_records" RENAME COLUMN "markedBy"  TO "adminMarkedBy";
ALTER TABLE "teacher_attendance_records" ALTER COLUMN "adminMarkedBy" DROP NOT NULL;

ALTER TABLE "teacher_attendance_records"
  ADD COLUMN "teacherStatus" "AttendanceStatus",
  ADD COLUMN "adminStatus"   "AttendanceStatus",
  ADD COLUMN "adminMarkedAt" TIMESTAMP(3);

-- Backfill 1: rows with a check-in time were the teacher checking in (always PRESENT).
UPDATE "teacher_attendance_records"
SET    "teacherStatus" = 'PRESENT'
WHERE  "teacherMarkedAt" IS NOT NULL;

-- Backfill 2: rows last written by someone other than the teacher were an admin's marking.
UPDATE "teacher_attendance_records" r
SET    "adminStatus" = r."status", "adminMarkedAt" = r."updatedAt"
FROM   "teachers" t
WHERE  t."id" = r."teacherId" AND r."adminMarkedBy" <> t."userId";

-- Backfill 3: rows written by the teacher themselves carry no admin marking.
UPDATE "teacher_attendance_records" r
SET    "adminMarkedBy" = NULL
FROM   "teachers" t
WHERE  t."id" = r."teacherId" AND r."adminMarkedBy" = t."userId";

ALTER TABLE "teacher_attendance_records" ADD CONSTRAINT "teacher_attendance_records_adminMarkedBy_fkey"
  FOREIGN KEY ("adminMarkedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
