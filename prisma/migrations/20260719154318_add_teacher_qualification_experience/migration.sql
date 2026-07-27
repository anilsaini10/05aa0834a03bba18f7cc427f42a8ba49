-- AlterTable
ALTER TABLE "teachers" ADD COLUMN     "experienceMonths" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "experienceYears" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "qualification" TEXT NOT NULL DEFAULT '';
