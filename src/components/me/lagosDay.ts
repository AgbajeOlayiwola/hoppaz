/**
 * Lagos calendar days as plain "YYYY-MM-DD" strings. Lagos is UTC+1 all year
 * (no daylight saving), the same day the database uses (Africa/Lagos). Every
 * function here is pure; pass in the clock.
 */

/** The Lagos date for a moment. */
export const lagosDate = (ms: number) => new Date(ms + 3.6e6).toISOString().slice(0, 10);

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const MONTH_NAMES = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

/** The seven dates of the week a date sits in, Monday first (the database's week starts on Monday too). */
export function weekDates(today: string): string[] {
  const monday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** The month before a date: its first day, the first day of this month (the end, exclusive), a key like "2026-09" and the name. */
export function lastMonth(today: string) {
  const end = `${today.slice(0, 7)}-01`;
  const start = addDays(end, -1).slice(0, 7) + "-01";
  return { start, end, key: start.slice(0, 7), name: MONTH_NAMES[Number(start.slice(5, 7)) - 1] };
}

/** The month card shows on the first three days of a month. */
export const inMonthWindow = (today: string) => Number(today.slice(8, 10)) <= 3;
