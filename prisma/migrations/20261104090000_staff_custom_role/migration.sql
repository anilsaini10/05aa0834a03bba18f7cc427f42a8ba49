-- AlterTable: add customRoleId to staff
ALTER TABLE "staff" ADD COLUMN "customRoleId" TEXT;

-- CreateIndex
CREATE INDEX "staff_customRoleId_idx" ON "staff"("customRoleId");

-- AddForeignKey
ALTER TABLE "staff"
    ADD CONSTRAINT "staff_customRoleId_fkey"
    FOREIGN KEY ("customRoleId") REFERENCES "custom_roles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: link existing staff to matching custom roles by designation name
UPDATE "staff" s
SET "customRoleId" = cr."id"
FROM "custom_roles" cr
WHERE LOWER(TRIM(s."designation")) = LOWER(cr."name")
  AND cr."isActive" = true
  AND s."customRoleId" IS NULL;
