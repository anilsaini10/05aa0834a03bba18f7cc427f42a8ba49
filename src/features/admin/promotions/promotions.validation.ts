import { z } from 'zod';

export const promotionPreviewSchema = z.object({
  fromClassId:       z.string().uuid('Invalid fromClassId'),
  fromSectionId:     z.string().uuid('Invalid fromSectionId').optional(),
  toClassId:         z.string().uuid('Invalid toClassId'),
  toSectionId:       z.string().uuid('Invalid toSectionId'),
  academicSessionId: z.string().uuid('Invalid academicSessionId'),
  // Optional list of student IDs to promote (defaults to all ACTIVE in the section)
  studentIds:        z.array(z.string().uuid()).optional(),
});

export const promotionExecuteSchema = promotionPreviewSchema;

export const listPromotionHistorySchema = z.object({
  page:              z.coerce.number().int().positive().default(1),
  pageSize:          z.coerce.number().int().positive().max(50).default(15),
  academicSessionId: z.string().uuid().optional(),
});

export type PromotionPreviewSchema     = z.infer<typeof promotionPreviewSchema>;
export type PromotionExecuteSchema     = z.infer<typeof promotionExecuteSchema>;
export type ListPromotionHistorySchema = z.infer<typeof listPromotionHistorySchema>;
