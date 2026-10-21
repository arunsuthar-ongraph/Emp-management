/** Date helpers. All dates are handled as UTC midnight to match Postgres DATE columns. */

export const toDate = (v: string | Date) => {
  const d = new Date(v);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/** Today's date in IST, as UTC midnight. */
export const todayIST = () => {
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

export const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

export const monthRange = (year: number, month: number) => ({
  start: new Date(Date.UTC(year, month - 1, 1)),
  end: new Date(Date.UTC(year, month, 0)),
  days: new Date(Date.UTC(year, month, 0)).getUTCDate(),
});

export const dateKey = (d: Date) => d.toISOString().slice(0, 10);

export function eachDay(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
