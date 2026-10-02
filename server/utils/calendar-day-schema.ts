import { z } from "zod";
import { calendarDayYmd, parseCalendarDay } from "./date";

/**
 * Zod schema of the document-date contract: accepts "YYYY-MM-DD" or an ISO instant and yields the UAE calendar day
 * as "YYYY-MM-DD" (see parseCalendarDay in utils/date.ts).
 */
export const calendarDaySchema = z
  .string()
  .refine((v) => parseCalendarDay(v) !== null, { message: "date must be a calendar day (YYYY-MM-DD) or an ISO date-time" })
  .transform((v) => calendarDayYmd(parseCalendarDay(v) as Date));
