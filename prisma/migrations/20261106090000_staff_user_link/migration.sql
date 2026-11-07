-- AlterTable: add userId to staff (links staff record to login account)
ALTER TABLE "staff" ADD COLUMN "userId" TEXT;

-- CreateIndex: unique so one user has at most one staff record
CREATE UNIQUE INDEX "staff_userId_key" ON "staff"("userId");

-- AddForeignKey
ALTER TABLE "staff"
    ADD CONSTRAINT "staff_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: link existing staff to matching STAFF users by email (case-insensitive)
UPDATE "staff" s
SET "userId" = u."id"
FROM "users" u
WHERE LOWER(TRIM(s."email")) = LOWER(u."email")
  AND u."role" = 'STAFF'
  AND u."isActive" = true
  AND s."userId" IS NULL
  AND s."email" IS NOT NULL;
