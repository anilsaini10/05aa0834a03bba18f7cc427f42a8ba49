import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { sendSuccess } from '../../../shared/utils/apiResponse';
import { AnalyticsContext, resolveContext } from './analytics.context';
import { teacherIdParamSchema } from './analytics.validation';

// Every analytics handler is the same three steps — validate the query,
// resolve the period + school-scoped filters, run the service — so they
// share one wrapper instead of 40 copies of the try/catch.
// schoolId always comes from the token, never from the request.
export const analyticsHandler = <S extends z.ZodTypeAny>(
  schema: S,
  run: (ctx: AnalyticsContext, query: z.infer<S>) => Promise<unknown>,
) => async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query  = schema.parse(req.query);
    const ctx    = await resolveContext((req as any).user.schoolId, query);
    sendSuccess(res, await run(ctx, query));
  } catch (err) {
    next(err);
  }
};

// Same, with :teacherId from the path used as the teacher filter.
export const teacherAnalyticsHandler = <S extends z.ZodTypeAny>(
  schema: S,
  run: (ctx: AnalyticsContext, query: z.infer<S>) => Promise<unknown>,
) => async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { teacherId } = teacherIdParamSchema.parse(req.params);
    const query = schema.parse(req.query);
    const ctx   = await resolveContext((req as any).user.schoolId, { ...query, teacherId });
    sendSuccess(res, await run(ctx, query));
  } catch (err) {
    next(err);
  }
};
