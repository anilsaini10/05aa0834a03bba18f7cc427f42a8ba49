-- CreateEnum
CREATE TYPE "FeeStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'WAIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FeePaymentStatus" AS ENUM ('SUCCESS', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'ONLINE');

-- CreateEnum
CREATE TYPE "SalaryStatus" AS ENUM ('PENDING', 'ON_HOLD', 'CREDITED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EmployeeType" AS ENUM ('TEACHER', 'STAFF');

-- CreateTable
CREATE TABLE "fee_structures" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "dueDate" DATE NOT NULL,
    "sessionYear" INTEGER NOT NULL,
    "classId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_fees" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "feeStructureId" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sessionYear" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fine" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "dueDate" DATE NOT NULL,
    "status" "FeeStatus" NOT NULL DEFAULT 'PENDING',
    "statusReason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_payments" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentFeeId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "referenceNo" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "status" "FeePaymentStatus" NOT NULL DEFAULT 'SUCCESS',
    "voidReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "collectedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_slips" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "slipNo" TEXT NOT NULL,
    "employeeType" "EmployeeType" NOT NULL,
    "teacherId" TEXT,
    "staffId" TEXT,
    "employeeName" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "baseSalary" DECIMAL(12,2) NOT NULL,
    "allowances" JSONB NOT NULL DEFAULT '[]',
    "deductions" JSONB NOT NULL DEFAULT '[]',
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "totalDeductions" DECIMAL(12,2) NOT NULL,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "status" "SalaryStatus" NOT NULL DEFAULT 'PENDING',
    "statusReason" TEXT,
    "note" TEXT,
    "paymentMode" "PaymentMode",
    "referenceNo" TEXT,
    "creditedAt" TIMESTAMP(3),
    "creditedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_slips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_sequences" (
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "school_sequences_pkey" PRIMARY KEY ("schoolId","name")
);

-- CreateIndex
CREATE INDEX "fee_structures_schoolId_sessionYear_idx" ON "fee_structures"("schoolId", "sessionYear");

-- CreateIndex
CREATE INDEX "student_fees_schoolId_sessionYear_status_idx" ON "student_fees"("schoolId", "sessionYear", "status");

-- CreateIndex
CREATE INDEX "student_fees_schoolId_status_dueDate_idx" ON "student_fees"("schoolId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "student_fees_studentId_feeStructureId_key" ON "student_fees"("studentId", "feeStructureId");

-- CreateIndex
CREATE INDEX "fee_payments_studentFeeId_idx" ON "fee_payments"("studentFeeId");

-- CreateIndex
CREATE INDEX "fee_payments_studentId_idx" ON "fee_payments"("studentId");

-- CreateIndex
CREATE INDEX "fee_payments_schoolId_paidAt_idx" ON "fee_payments"("schoolId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "fee_payments_schoolId_receiptNo_key" ON "fee_payments"("schoolId", "receiptNo");

-- CreateIndex
CREATE INDEX "salary_slips_schoolId_year_month_status_idx" ON "salary_slips"("schoolId", "year", "month", "status");

-- CreateIndex
CREATE UNIQUE INDEX "salary_slips_teacherId_month_year_key" ON "salary_slips"("teacherId", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "salary_slips_staffId_month_year_key" ON "salary_slips"("staffId", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "salary_slips_schoolId_slipNo_key" ON "salary_slips"("schoolId", "slipNo");

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fees" ADD CONSTRAINT "student_fees_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fees" ADD CONSTRAINT "student_fees_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fees" ADD CONSTRAINT "student_fees_feeStructureId_fkey" FOREIGN KEY ("feeStructureId") REFERENCES "fee_structures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_studentFeeId_fkey" FOREIGN KEY ("studentFeeId") REFERENCES "student_fees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_collectedBy_fkey" FOREIGN KEY ("collectedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_slips" ADD CONSTRAINT "salary_slips_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_slips" ADD CONSTRAINT "salary_slips_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_slips" ADD CONSTRAINT "salary_slips_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_slips" ADD CONSTRAINT "salary_slips_creditedBy_fkey" FOREIGN KEY ("creditedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_sequences" ADD CONSTRAINT "school_sequences_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Money is never negative, and a fee can't be paid beyond what's payable.
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_amount_check" CHECK ("amount" >= 0);
ALTER TABLE "student_fees" ADD CONSTRAINT "student_fees_amounts_check"
  CHECK ("amount" >= 0 AND "discount" >= 0 AND "fine" >= 0 AND "paidAmount" >= 0
         AND "discount" <= "amount" + "fine"
         AND "paidAmount" <= "amount" - "discount" + "fine");
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_amount_check" CHECK ("amount" > 0);

-- A slip belongs to exactly one employee, matching employeeType.
ALTER TABLE "salary_slips" ADD CONSTRAINT "salary_slips_employee_check"
  CHECK (("employeeType" = 'TEACHER' AND "teacherId" IS NOT NULL AND "staffId" IS NULL)
      OR ("employeeType" = 'STAFF'   AND "staffId"   IS NOT NULL AND "teacherId" IS NULL));
ALTER TABLE "salary_slips" ADD CONSTRAINT "salary_slips_period_check" CHECK ("month" BETWEEN 1 AND 12);
ALTER TABLE "salary_slips" ADD CONSTRAINT "salary_slips_amounts_check"
  CHECK ("baseSalary" >= 0 AND "grossAmount" >= 0 AND "totalDeductions" >= 0 AND "netAmount" >= 0);
