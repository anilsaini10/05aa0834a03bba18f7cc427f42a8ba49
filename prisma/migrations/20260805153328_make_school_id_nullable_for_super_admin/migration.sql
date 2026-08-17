-- AlterTable
ALTER TABLE "users" ALTER COLUMN "schoolId" DROP NOT NULL;

-- CheckConstraint
-- schoolId may only be NULL for SUPER_ADMIN — every other role must stay
-- scoped to a school, enforced at the DB level in addition to the app layer.
ALTER TABLE "users" ADD CONSTRAINT "users_schoolid_required_unless_super_admin"
  CHECK (role = 'SUPER_ADMIN' OR "schoolId" IS NOT NULL);
