-- AlterTable
ALTER TABLE "schools" ADD COLUMN     "permissions" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "school_role_permissions" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "customRoleId" TEXT NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "school_role_permissions_schoolId_customRoleId_key" ON "school_role_permissions"("schoolId", "customRoleId");

-- AddForeignKey
ALTER TABLE "school_role_permissions" ADD CONSTRAINT "school_role_permissions_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_role_permissions" ADD CONSTRAINT "school_role_permissions_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "custom_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_role_permissions" ADD CONSTRAINT "school_role_permissions_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
