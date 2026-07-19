import { formatCount, formatDuration } from '../dashboard/dashboardFormatting';

export { formatCount, formatDuration };

type Locale = string | readonly string[] | undefined;

export function formatLocalDateParam(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(year)}-${month}-${day}`;
}

export function formatHourLabel(hour: number): string {
  return `${String(hour)}时`;
}

export function formatSessionTimeOfDay(isoUtc: string, locale?: Locale): string {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

export function formatSessionTimeRange(startedAtUtc: string, endedAtUtc: string | undefined, locale?: Locale): string {
  const start = formatSessionTimeOfDay(startedAtUtc, locale);
  if (start === '') return '';
  if (endedAtUtc === undefined) return `${start} 起`;
  const end = formatSessionTimeOfDay(endedAtUtc, locale);
  return end === '' ? start : `${start} – ${end}`;
}

export function formatWeekdayLabel(dateParam: string, locale?: Locale): string {
  const date = parseLocalDateParam(dateParam);
  if (!date) return dateParam;
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
}

export function formatMonthDayLabel(dateParam: string, locale?: Locale): string {
  const date = parseLocalDateParam(dateParam);
  if (!date) return dateParam;
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
}

function parseLocalDateParam(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}
