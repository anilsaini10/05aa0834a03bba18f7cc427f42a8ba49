import { z } from 'zod';
import { schoolDetailsFields } from '../../superAdmin/superAdmin.validation';

// ── PATCH /admin/school — the school ADMIN updates their own school.
// Same detail fields the super admin can edit (code stays immutable).
// latitude/longitude must be sent together; send both as null to clear
// the school's location.
export const updateMySchoolSchema = schoolDetailsFields
  .extend({
    latitude:  z.coerce.number().min(-90,  'latitude must be between -90 and 90').max(90,  'latitude must be between -90 and 90').nullable().optional(),
    longitude: z.coerce.number().min(-180, 'longitude must be between -180 and 180').max(180, 'longitude must be between -180 and 180').nullable().optional(),
  })
  .refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' })
  .refine(data => (data.latitude === undefined) === (data.longitude === undefined), {
    message: 'latitude and longitude must be sent together', path: ['latitude'],
  })
  .refine(data => (data.latitude === null) === (data.longitude === null), {
    message: 'To clear the location, send both latitude and longitude as null', path: ['latitude'],
  });

export type UpdateMySchoolSchema = z.infer<typeof updateMySchoolSchema>;
