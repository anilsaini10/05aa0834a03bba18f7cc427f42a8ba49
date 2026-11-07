-- Syllabus Management & Academic Progress Tracking
-- Generated from schema.prisma (column names match the Prisma fields).

-- AlterTable
ALTER TABLE "subjects" ADD COLUMN     "description" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "chapters" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chapterNumber" INTEGER NOT NULL,
    "description" TEXT,
    "expectedWorkingDays" INTEGER NOT NULL DEFAULT 0,
    "sequenceNumber" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syllabus_plans" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sessionYear" INTEGER NOT NULL,
    "classId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "approvalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "syllabus_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syllabus_plan_chapters" (
    "id" TEXT NOT NULL,
    "syllabusPlanId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "expectedWorkingDays" INTEGER NOT NULL DEFAULT 0,
    "plannedStartDate" DATE,
    "plannedEndDate" DATE,
    "adminRemarks" TEXT,
    "actualStartDate" DATE,
    "actualEndDate" DATE,
    "actualWorkingDays" INTEGER NOT NULL DEFAULT 0,
    "completionPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "scheduleStatus" TEXT,
    "teacherRemarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "syllabus_plan_chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapter_progress_history" (
    "id" TEXT NOT NULL,
    "syllabusPlanChapterId" TEXT NOT NULL,
    "previousPercentage" DOUBLE PRECISION NOT NULL,
    "newPercentage" DOUBLE PRECISION NOT NULL,
    "progressDate" DATE NOT NULL,
    "workingDaysAdded" INTEGER NOT NULL DEFAULT 0,
    "totalActualWorkingDays" INTEGER NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chapter_progress_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_approvals" (
    "id" TEXT NOT NULL,
    "syllabusPlanChapterId" TEXT NOT NULL,
    "submittedPercentage" DOUBLE PRECISION NOT NULL,
    "approvedPercentage" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectionRemarks" TEXT,
    "correctionRemarks" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "progress_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chapters_schoolId_subjectId_classId_idx" ON "chapters"("schoolId", "subjectId", "classId");

-- CreateIndex
CREATE UNIQUE INDEX "chapters_schoolId_subjectId_classId_chapterNumber_key" ON "chapters"("schoolId", "subjectId", "classId", "chapterNumber");

-- CreateIndex
CREATE INDEX "syllabus_plans_schoolId_sessionYear_idx" ON "syllabus_plans"("schoolId", "sessionYear");

-- CreateIndex
CREATE INDEX "syllabus_plans_teacherId_idx" ON "syllabus_plans"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "syllabus_plans_schoolId_sessionYear_classId_sectionId_subje_key" ON "syllabus_plans"("schoolId", "sessionYear", "classId", "sectionId", "subjectId");

-- CreateIndex
CREATE INDEX "syllabus_plan_chapters_syllabusPlanId_sequenceNumber_idx" ON "syllabus_plan_chapters"("syllabusPlanId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "syllabus_plan_chapters_syllabusPlanId_chapterId_key" ON "syllabus_plan_chapters"("syllabusPlanId", "chapterId");

-- CreateIndex
CREATE INDEX "chapter_progress_history_syllabusPlanChapterId_progressDate_idx" ON "chapter_progress_history"("syllabusPlanChapterId", "progressDate");

-- CreateIndex
CREATE INDEX "progress_approvals_syllabusPlanChapterId_status_idx" ON "progress_approvals"("syllabusPlanChapterId", "status");

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_plans" ADD CONSTRAINT "syllabus_plans_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_plans" ADD CONSTRAINT "syllabus_plans_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_plans" ADD CONSTRAINT "syllabus_plans_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_plans" ADD CONSTRAINT "syllabus_plans_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_plans" ADD CONSTRAINT "syllabus_plans_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_plans" ADD CONSTRAINT "syllabus_plans_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_plan_chapters" ADD CONSTRAINT "syllabus_plan_chapters_syllabusPlanId_fkey" FOREIGN KEY ("syllabusPlanId") REFERENCES "syllabus_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_plan_chapters" ADD CONSTRAINT "syllabus_plan_chapters_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "chapters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapter_progress_history" ADD CONSTRAINT "chapter_progress_history_syllabusPlanChapterId_fkey" FOREIGN KEY ("syllabusPlanChapterId") REFERENCES "syllabus_plan_chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapter_progress_history" ADD CONSTRAINT "chapter_progress_history_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_approvals" ADD CONSTRAINT "progress_approvals_syllabusPlanChapterId_fkey" FOREIGN KEY ("syllabusPlanChapterId") REFERENCES "syllabus_plan_chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_approvals" ADD CONSTRAINT "progress_approvals_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Seed syllabus feature for subscription gating
INSERT INTO "features" ("id", "key", "name", "description", "isPaid", "roles", "isActive", "createdAt", "updatedAt")
VALUES (
    gen_random_uuid(),
    'syllabus',
    'Syllabus Management',
    'Syllabus planning, chapter management, and academic progress tracking',
    true,
    ARRAY['ADMIN', 'TEACHER', 'PARENT']::"Role"[],
    true,
    NOW(),
    NOW()
)
ON CONFLICT ("key") DO NOTHING;
