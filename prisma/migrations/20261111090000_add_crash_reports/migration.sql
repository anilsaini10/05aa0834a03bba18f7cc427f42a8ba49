-- CreateTable
CREATE TABLE "crash_reports" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "appVersion" TEXT,
    "buildNumber" TEXT,
    "platform" "Platform",
    "osVersion" TEXT,
    "deviceModel" TEXT,
    "errorMessage" TEXT NOT NULL,
    "stackTrace" TEXT,
    "errorType" TEXT,
    "isFatal" BOOLEAN NOT NULL DEFAULT true,
    "crashedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crash_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crash_reports_createdAt_idx" ON "crash_reports"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "crash_reports_userId_idx" ON "crash_reports"("userId");

-- CreateIndex
CREATE INDEX "crash_reports_platform_idx" ON "crash_reports"("platform");

-- AddForeignKey
ALTER TABLE "crash_reports" ADD CONSTRAINT "crash_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
