-- CreateEnum
CREATE TYPE "AccountRecoveryStatus" AS ENUM ('PENDING', 'RESOLVED', 'REJECTED');

-- CreateTable
CREATE TABLE "account_recovery_requests" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phones" TEXT[],
    "status" "AccountRecoveryStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_recovery_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_recovery_requests_schoolId_status_createdAt_idx" ON "account_recovery_requests"("schoolId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "account_recovery_requests_userId_status_idx" ON "account_recovery_requests"("userId", "status");

-- AddForeignKey
ALTER TABLE "account_recovery_requests" ADD CONSTRAINT "account_recovery_requests_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_recovery_requests" ADD CONSTRAINT "account_recovery_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_recovery_requests" ADD CONSTRAINT "account_recovery_requests_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
