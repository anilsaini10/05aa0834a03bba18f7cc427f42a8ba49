-- AlterTable: one target role → many. Existing plans keep their role.
ALTER TABLE "subscription_plans" ADD COLUMN "targetRoles" "Role"[] NOT NULL DEFAULT ARRAY[]::"Role"[];
UPDATE "subscription_plans" SET "targetRoles" = ARRAY["targetRole"];
ALTER TABLE "subscription_plans" ALTER COLUMN "targetRoles" DROP DEFAULT;

-- DropIndex
DROP INDEX "subscription_plans_targetRole_isActive_idx";

-- AlterTable
ALTER TABLE "subscription_plans" DROP COLUMN "targetRole";

-- AlterTable: free trial window
ALTER TABLE "subscription_plans" ADD COLUMN "trialStartsAt" TIMESTAMP(3),
ADD COLUMN "trialEndsAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "subscription_plans_isActive_idx" ON "subscription_plans"("isActive");
