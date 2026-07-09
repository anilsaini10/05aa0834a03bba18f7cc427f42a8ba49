-- AlterTable
ALTER TABLE "teacher_subjects" DROP CONSTRAINT "teacher_subjects_pkey",
ADD COLUMN     "classId" TEXT NOT NULL,
ADD CONSTRAINT "teacher_subjects_pkey" PRIMARY KEY ("teacherId", "subjectId", "classId");

-- CreateTable
CREATE TABLE "class_subjects" (
    "classId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,

    CONSTRAINT "class_subjects_pkey" PRIMARY KEY ("classId","subjectId")
);

-- CreateIndex
CREATE UNIQUE INDEX "classes_schoolId_name_key" ON "classes"("schoolId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sections_classId_name_key" ON "sections"("classId", "name");

-- AddForeignKey
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_subjects" ADD CONSTRAINT "teacher_subjects_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

