-- CreateEnum
CREATE TYPE "SupportQueryStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "support_queries" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdByRole" "Role" NOT NULL,
    "subject" TEXT NOT NULL,
    "category" TEXT,
    "message" TEXT NOT NULL,
    "status" "SupportQueryStatus" NOT NULL DEFAULT 'OPEN',
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "repliedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_queries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_queries_schoolId_createdBy_createdAt_idx" ON "support_queries"("schoolId", "createdBy", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "support_queries_status_createdAt_idx" ON "support_queries"("status", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "support_queries" ADD CONSTRAINT "support_queries_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_queries" ADD CONSTRAINT "support_queries_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_queries" ADD CONSTRAINT "support_queries_repliedBy_fkey" FOREIGN KEY ("repliedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
