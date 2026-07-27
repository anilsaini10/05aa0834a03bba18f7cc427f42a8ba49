-- AlterTable
ALTER TABLE "teachers" ADD COLUMN     "subjectsTaught" TEXT[] DEFAULT ARRAY[]::TEXT[];
