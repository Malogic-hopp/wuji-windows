import type {
  ActivityDailyStatsResult,
  ActivityWeeklyTrendResult,
} from '../../bridge/contracts';

export type ActivityTodayViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty'; readonly updatedAt: number }
  | { readonly kind: 'ready'; readonly stats: ActivityDailyStatsResult; readonly updatedAt: number }
  | { readonly kind: 'error'; readonly message: string };

export type ActivityTrendViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty'; readonly updatedAt: number }
  | { readonly kind: 'ready'; readonly trend: ActivityWeeklyTrendResult; readonly updatedAt: number }
  | { readonly kind: 'error'; readonly message: string };

export function isDailyStatsEmpty(stats: ActivityDailyStatsResult) {
  return stats.sampleCount <= 0;
}

export function isWeeklyTrendEmpty(trend: ActivityWeeklyTrendResult) {
  return trend.days.every((day) => day.activeSeconds <= 0 && day.sessionCount <= 0);
}

export function getMaxActiveSeconds(values: ReadonlyArray<number>) {
  return values.reduce((max, value) => Math.max(max, value), 0);
}

export function getRelativeBarHeightPercent(value: number, maxValue: number) {
  if (maxValue <= 0) return 0;
  return Math.round((Math.max(0, value) / maxValue) * 100);
}

export function resolveCurrentHour(isToday: boolean, currentHour: number) {
  return isToday ? currentHour : -1;
}
