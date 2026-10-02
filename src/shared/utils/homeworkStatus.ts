import { HOMEWORK_STATUS, HomeworkStatus } from '../../constants';

// SCHEDULED overrides whatever is stored whenever fromDate is still in the
// future — it's never written to the DB, just computed at read-time. Once
// fromDate passes, the stored value (ACTIVE/IN_PROGRESS/COMPLETED, set by
// the teacher) takes over. Used by both teacher.service.ts and
// students.service.ts so the two homework views can never disagree.
export const computeHomeworkStatus = (
  fromDate:     Date | null,
  storedStatus: string,
): HomeworkStatus => {
  if (fromDate && new Date() < fromDate) return HOMEWORK_STATUS.SCHEDULED;
  return storedStatus as HomeworkStatus;
};
