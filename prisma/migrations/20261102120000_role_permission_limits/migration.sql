-- Super admin's per-school cap for each role (see SchoolRolePermission.limits).
ALTER TABLE "school_role_permissions" ADD COLUMN     "limits" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "school_builtin_role_permissions" ADD COLUMN     "limits" JSONB NOT NULL DEFAULT '{}';
