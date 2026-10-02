// Employee date columns (join date, termination date, opening-provisions as-of date) are calendar days.
//
//  - Input: "YYYY-MM-DD" is kept exactly (never shifted); an ISO instant ("2023-03-31T20:00:00.000Z") becomes the UAE
//    calendar day it falls on (1 April). Anything that is not a real date is refused (null).
//  - Output: node-pg reads a date as SERVER-LOCAL midnight, which `JSON.stringify` turns into the previous UTC day on a
//    UAE host: an unchanged edit form then saved the date one day earlier every time. Rows therefore leave the API as
//    date-only strings.

import { parseCalendarDay } from "../utils/date";

export const EMPLOYEE_DATE_COLUMNS = ["join_date", "termination_date", "opening_provisions_as_of"] as const;

/** A client date as "YYYY-MM-DD", or null when it is not a real date. */
export function employeeDayInput(value: unknown): string | null {
  const d = parseCalendarDay(value);
  return d ? d.toISOString().slice(0, 10) : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The row with its date columns as date-only strings (their own calendar day, whatever the server's time zone). */
export function employeeOut<R extends Record<string, any> | undefined>(row: R): R {
  if (!row) return row;
  const out: Record<string, any> = { ...row };
  for (const column of EMPLOYEE_DATE_COLUMNS) {
    const v = out[column];
    if (v instanceof Date && !Number.isNaN(v.getTime())) out[column] = `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  return out as R;
}
