-- CreateTable
CREATE TABLE "teacher_attendance_records" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "markedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teacher_attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "teacher_attendance_records_schoolId_date_idx" ON "teacher_attendance_records"("schoolId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_attendance_records_teacherId_date_key" ON "teacher_attendance_records"("teacherId", "date");

-- AddForeignKey
ALTER TABLE "teacher_attendance_records" ADD CONSTRAINT "teacher_attendance_records_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_attendance_records" ADD CONSTRAINT "teacher_attendance_records_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_attendance_records" ADD CONSTRAINT "teacher_attendance_records_markedBy_fkey" FOREIGN KEY ("markedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
