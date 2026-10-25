-- CreateEnum
CREATE TYPE "PlanScope" AS ENUM ('SELF', 'SCHOOL');

-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('BASE', 'ADDON');

-- CreateEnum
CREATE TYPE "IntervalUnit" AS ENUM ('DAY', 'MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "SubscriberType" AS ENUM ('USER', 'SCHOOL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'SUCCESS', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('MANUAL', 'RAZORPAY');

-- CreateTable
CREATE TABLE "features" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "roles" "Role"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" "PlanScope" NOT NULL DEFAULT 'SELF',
    "planType" "PlanType" NOT NULL DEFAULT 'BASE',
    "targetRole" "Role" NOT NULL,
    "schoolId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_features" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_prices" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "label" TEXT,
    "intervalUnit" "IntervalUnit" NOT NULL,
    "intervalCount" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "subscriberType" "SubscriberType" NOT NULL,
    "userId" TEXT,
    "schoolId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "paidByUserId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planPriceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "intervalUnit" "IntervalUnit" NOT NULL,
    "intervalCount" INTEGER NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "activatedBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "gateway" "PaymentGateway" NOT NULL DEFAULT 'MANUAL',
    "gatewayOrderId" TEXT,
    "gatewayPaymentId" TEXT,
    "reference" TEXT,
    "rawResponse" JSONB,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "features_key_key" ON "features"("key");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_code_key" ON "subscription_plans"("code");

-- CreateIndex
CREATE INDEX "subscription_plans_targetRole_isActive_idx" ON "subscription_plans"("targetRole", "isActive");

-- CreateIndex
CREATE INDEX "plan_features_featureId_idx" ON "plan_features"("featureId");

-- CreateIndex
CREATE UNIQUE INDEX "plan_features_planId_featureId_role_key" ON "plan_features"("planId", "featureId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "plan_prices_planId_intervalUnit_intervalCount_key" ON "plan_prices"("planId", "intervalUnit", "intervalCount");

-- CreateIndex
CREATE INDEX "subscriptions_userId_status_endDate_idx" ON "subscriptions"("userId", "status", "endDate");

-- CreateIndex
CREATE INDEX "subscriptions_schoolId_subscriberType_status_endDate_idx" ON "subscriptions"("schoolId", "subscriberType", "status", "endDate");

-- CreateIndex
CREATE INDEX "subscriptions_planId_idx" ON "subscriptions"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gatewayPaymentId_key" ON "payments"("gatewayPaymentId");

-- CreateIndex
CREATE INDEX "payments_subscriptionId_idx" ON "payments"("subscriptionId");

-- CreateIndex
CREATE INDEX "payments_schoolId_createdAt_idx" ON "payments"("schoolId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planPriceId_fkey" FOREIGN KEY ("planPriceId") REFERENCES "plan_prices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_activatedBy_fkey" FOREIGN KEY ("activatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A USER subscription must name its user; a SCHOOL one must not.
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_subscriber_check"
  CHECK (("subscriberType" = 'USER' AND "userId" IS NOT NULL) OR ("subscriberType" = 'SCHOOL' AND "userId" IS NULL));

-- An ACTIVE subscription always has its period.
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_active_period_check"
  CHECK ("status" <> 'ACTIVE' OR ("startDate" IS NOT NULL AND "endDate" IS NOT NULL AND "endDate" > "startDate"));

ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_amount_check" CHECK ("amount" >= 0 AND "intervalCount" > 0);
