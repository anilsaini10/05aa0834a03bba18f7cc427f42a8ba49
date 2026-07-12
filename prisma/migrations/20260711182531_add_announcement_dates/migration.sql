-- AlterTable
ALTER TABLE "announcements" ADD COLUMN     "eventDate" TIMESTAMP(3),
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "publishAt" TIMESTAMP(3);
