import { z } from 'zod';

export const listLoginRolesQuerySchema = z.object({
  platform: z.enum(['web', 'mobile']),
  schoolId: z.string().uuid().optional(),
});

export type ListLoginRolesQuery = z.infer<typeof listLoginRolesQuerySchema>;

export const listSchoolsQuerySchema = z.object({
  search: z.string().max(100).optional(),
});

export type ListSchoolsQuery = z.infer<typeof listSchoolsQuerySchema>;

export const updateRoleDisplaySchema = z.object({
  showOnWeb:    z.boolean().optional(),
  showOnMobile: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});

export type UpdateRoleDisplaySchema = z.infer<typeof updateRoleDisplaySchema>;

export const bulkUpdateRoleDisplaySchema = z.object({
  items: z.array(z.object({
    id:           z.string().uuid(),
    showOnWeb:    z.boolean().optional(),
    showOnMobile: z.boolean().optional(),
    displayOrder: z.number().int().min(0).optional(),
  })).min(1).max(50),
});

export type BulkUpdateRoleDisplaySchema = z.infer<typeof bulkUpdateRoleDisplaySchema>;
