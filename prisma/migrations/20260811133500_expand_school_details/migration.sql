-- CreateEnum
CREATE TYPE "Board" AS ENUM ('CBSE', 'ICSE', 'STATE_BOARD', 'IB', 'OTHER');

-- CreateEnum
CREATE TYPE "SchoolType" AS ENUM ('CO_ED', 'BOYS', 'GIRLS');

-- AlterTable
ALTER TABLE "schools" ADD COLUMN     "academicSessionStartMonth" INTEGER,
ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "alternatePhone" TEXT,
ADD COLUMN     "board" "Board",
ADD COLUMN     "classesFrom" TEXT,
ADD COLUMN     "classesTo" TEXT,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "country" TEXT DEFAULT 'India',
ADD COLUMN     "establishedYear" INTEGER,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "medium" TEXT,
ADD COLUMN     "pincode" TEXT,
ADD COLUMN     "principalEmail" TEXT,
ADD COLUMN     "principalName" TEXT,
ADD COLUMN     "principalPhone" TEXT,
ADD COLUMN     "schoolType" "SchoolType",
ADD COLUMN     "state" TEXT,
ADD COLUMN     "totalStaffApprox" INTEGER,
ADD COLUMN     "totalStudentsApprox" INTEGER,
ADD COLUMN     "websiteUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "schools_code_key" ON "schools"("code");

