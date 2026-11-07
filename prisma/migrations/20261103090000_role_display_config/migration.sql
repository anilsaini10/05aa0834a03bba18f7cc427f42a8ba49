-- CreateTable
CREATE TABLE "role_display_configs" (
    "id" TEXT NOT NULL,
    "builtInRole" "Role",
    "customRoleId" TEXT,
    "label" TEXT NOT NULL,
    "showOnWeb" BOOLEAN NOT NULL DEFAULT true,
    "showOnMobile" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_display_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "role_display_configs_builtInRole_key" ON "role_display_configs"("builtInRole");

-- CreateIndex
CREATE UNIQUE INDEX "role_display_configs_customRoleId_key" ON "role_display_configs"("customRoleId");

-- AddForeignKey
ALTER TABLE "role_display_configs"
    ADD CONSTRAINT "role_display_configs_customRoleId_fkey"
    FOREIGN KEY ("customRoleId") REFERENCES "custom_roles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CHECK: exactly one of builtInRole / customRoleId is set
ALTER TABLE "role_display_configs"
    ADD CONSTRAINT "role_display_configs_exactly_one_role"
    CHECK (
        ("builtInRole" IS NOT NULL AND "customRoleId" IS NULL)
        OR
        ("builtInRole" IS NULL AND "customRoleId" IS NOT NULL)
    );

-- Seed default display configs for built-in roles
INSERT INTO "role_display_configs" ("id", "builtInRole", "label", "showOnWeb", "showOnMobile", "displayOrder", "createdAt", "updatedAt")
VALUES
    (gen_random_uuid(), 'SUPER_ADMIN', 'Super Admin', true,  false, 0, NOW(), NOW()),
    (gen_random_uuid(), 'ADMIN',       'Admin',       true,  true,  1, NOW(), NOW()),
    (gen_random_uuid(), 'TEACHER',     'Teacher',     true,  true,  2, NOW(), NOW()),
    (gen_random_uuid(), 'PARENT',      'Parent',      false, true,  3, NOW(), NOW());

-- Seed display configs for any custom roles that already exist
INSERT INTO "role_display_configs" ("id", "customRoleId", "label", "showOnWeb", "showOnMobile", "displayOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid(), cr."id", cr."name", true, true, 100, NOW(), NOW()
FROM "custom_roles" cr
WHERE NOT EXISTS (
    SELECT 1 FROM "role_display_configs" rdc WHERE rdc."customRoleId" = cr."id"
);
