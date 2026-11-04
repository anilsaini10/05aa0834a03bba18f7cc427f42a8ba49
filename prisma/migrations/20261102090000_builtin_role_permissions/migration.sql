-- CreateTable
CREATE TABLE "school_builtin_role_permissions" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_builtin_role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "school_builtin_role_permissions_schoolId_role_key" ON "school_builtin_role_permissions"("schoolId", "role");

-- AddForeignKey
ALTER TABLE "school_builtin_role_permissions" ADD CONSTRAINT "school_builtin_role_permissions_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_builtin_role_permissions" ADD CONSTRAINT "school_builtin_role_permissions_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Only TEACHER and PARENT get admin-set role permissions.
ALTER TABLE "school_builtin_role_permissions" ADD CONSTRAINT "school_builtin_role_permissions_role_check"
  CHECK (role IN ('TEACHER', 'PARENT'));
