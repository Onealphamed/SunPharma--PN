// Date utilities. All dates are ISO calendar dates ('YYYY-MM-DD') handled in UTC so
// that results never shift with the server or browser time zone.

export type ISODate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Excel / Google Sheets serial date (days since 1899-12-30) → ISO date. */
export function serialToISO(serial: number): ISODate {
  const ms = Math.round((serial - 25569) * 86400000); // 25569 = 1970-01-01
  return new Date(ms).toISOString().slice(0, 10);
}

export function isoToSerial(iso: ISODate): number {
  return Math.round(toUTC(iso) / 86400000) + 25569;
}

function valid(y: number, m: number, d: number): ISODate | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null; // e.g. 31 Feb
  return dt.toISOString().slice(0, 10);
}

export interface ParsedDate {
  iso: ISODate | null;
  /** True when a non-empty value could not be interpreted as a date. */
  invalid: boolean;
}

/**
 * Accepts the shapes a spreadsheet cell can realistically contain: serial numbers,
 * ISO strings (optionally with time), dd/mm/yyyy (UK/India convention used by the
 * project team), '2 Nov 2026', and JS Date objects. Never guesses on ambiguous input.
 */
export function parseDate(value: unknown): ParsedDate {
  if (value === null || value === undefined) return { iso: null, invalid: false };
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? { iso: null, invalid: true } : { iso: value.toISOString().slice(0, 10), invalid: false };
  }
  if (typeof value === 'number') {
    if (!isFinite(value) || value < 1 || value > 150000) return { iso: null, invalid: true };
    return { iso: serialToISO(Math.floor(value)), invalid: false };
  }
  const s = String(value).trim();
  if (s === '' || /^(n\/?a|tbc|tbd|-|—|not scheduled)$/i.test(s)) return { iso: null, invalid: false };
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) {
    const iso = valid(+m[1], +m[2], +m[3]);
    return { iso, invalid: !iso };
  }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const iso = valid(+m[3], +m[2], +m[1]); // day-first
    return { iso, invalid: !iso };
  }
  m = s.match(/^(?:[a-z]{3,9},?\s+)?(\d{1,2})[\s-]+([a-z]{3,9})[\s,-]+(\d{4})$/i);
  if (m) {
    const name = m[2].toLowerCase();
    const mon = MONTHS[name.slice(0, 4)] ?? MONTHS[name.slice(0, 3)];
    const iso = mon ? valid(+m[3], mon, +m[1]) : null;
    return { iso, invalid: !iso };
  }
  if (/^\d+(\.\d+)?$/.test(s)) return parseDate(Number(s));
  return { iso: null, invalid: true };
}

export function toUTC(iso: ISODate): number {
  const m = iso.match(ISO_RE);
  if (!m) throw new Error(`Invalid ISO date: ${iso}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

export function addDays(iso: ISODate, n: number): ISODate {
  return new Date(toUTC(iso) + n * 86400000).toISOString().slice(0, 10);
}

/** Calendar days from a to b (b - a). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(iso: ISODate): number {
  return new Date(toUTC(iso)).getUTCDay();
}

export interface WorkCalendar {
  /** Weekday numbers treated as non-working (default Sat + Sun). */
  weekend: number[];
  holidays: Set<ISODate>;
}

export const DEFAULT_CALENDAR: WorkCalendar = { weekend: [0, 6], holidays: new Set() };

export function isWorkingDay(iso: ISODate, cal: WorkCalendar): boolean {
  return !cal.weekend.includes(weekday(iso)) && !cal.holidays.has(iso);
}

/** Inclusive working-day count between two dates (0 if end < start). */
export function workingDaysInclusive(start: ISODate, end: ISODate, cal: WorkCalendar): number {
  if (toUTC(end) < toUTC(start)) return 0;
  let n = 0;
  for (let d = start; toUTC(d) <= toUTC(end); d = addDays(d, 1)) if (isWorkingDay(d, cal)) n++;
  return n;
}

/** Move forward (n > 0) or back (n < 0) by n working days. n = 0 rolls forward to a working day. */
export function addWorkingDays(iso: ISODate, n: number, cal: WorkCalendar): ISODate {
  let d = iso;
  if (n === 0) {
    while (!isWorkingDay(d, cal)) d = addDays(d, 1);
    return d;
  }
  const step = n > 0 ? 1 : -1;
  let left = Math.abs(n);
  while (left > 0) {
    d = addDays(d, step);
    if (isWorkingDay(d, cal)) left--;
  }
  return d;
}

/** Signed working-day difference: number of working days you must add to a to reach b. */
export function workingDayDiff(a: ISODate, b: ISODate, cal: WorkCalendar): number {
  if (a === b) return 0;
  if (toUTC(b) > toUTC(a)) return workingDaysInclusive(addDays(a, 1), b, cal);
  return -workingDaysInclusive(addDays(b, 1), a, cal);
}

/** Today's date in an IANA time zone (projects are run on IST by default). */
export function todayInZone(timeZone: string, now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function minDate(dates: (ISODate | null | undefined)[]): ISODate | null {
  const v = dates.filter(Boolean) as ISODate[];
  return v.length ? v.reduce((a, b) => (a < b ? a : b)) : null;
}

export function maxDate(dates: (ISODate | null | undefined)[]): ISODate | null {
  const v = dates.filter(Boolean) as ISODate[];
  return v.length ? v.reduce((a, b) => (a > b ? a : b)) : null;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** '2 Nov 2026' */
export function fmtDate(iso: ISODate | null | undefined, opts: { weekday?: boolean; year?: boolean } = {}): string {
  if (!iso) return '';
  const m = iso.match(ISO_RE);
  if (!m) return iso;
  const s = `${+m[3]} ${SHORT_MONTHS[+m[2] - 1]}${opts.year === false ? '' : ' ' + m[1]}`;
  return opts.weekday ? `${SHORT_DAYS[weekday(iso)]} ${s}` : s;
}
