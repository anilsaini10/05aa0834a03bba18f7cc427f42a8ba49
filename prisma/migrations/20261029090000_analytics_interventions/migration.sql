-- CreateEnum
CREATE TYPE "InterventionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "interventions" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "alertKey" TEXT,
    "alertType" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "actionTaken" TEXT,
    "status" "InterventionStatus" NOT NULL DEFAULT 'OPEN',
    "assignedTo" TEXT,
    "dueDate" DATE,
    "followUpDate" DATE,
    "outcome" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interventions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interventions_schoolId_status_dueDate_idx" ON "interventions"("schoolId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "interventions_schoolId_alertKey_idx" ON "interventions"("schoolId", "alertKey");

-- CreateIndex
CREATE INDEX "interventions_schoolId_entityType_entityId_idx" ON "interventions"("schoolId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "interventions_assignedTo_status_idx" ON "interventions"("assignedTo", "status");

-- CreateIndex (analytics: homework by due date)
CREATE INDEX "homework_schoolId_dueDate_idx" ON "homework"("schoolId", "dueDate");

-- CreateIndex (analytics: active students per section)
CREATE INDEX "students_schoolId_status_sectionId_idx" ON "students"("schoolId", "status", "sectionId");

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
