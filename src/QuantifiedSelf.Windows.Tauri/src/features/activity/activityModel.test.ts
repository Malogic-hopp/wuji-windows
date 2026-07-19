import { describe, expect, it } from 'vitest';
import type {
  ActivityDailyStatsResult,
  ActivityHourlyBucket,
  ActivityTrendDay,
  ActivityWeeklyTrendResult,
} from '../../bridge/contracts';
import {
  getMaxActiveSeconds,
  getRelativeBarHeightPercent,
  isDailyStatsEmpty,
  isWeeklyTrendEmpty,
  resolveCurrentHour,
} from './activityModel';

function hourlyBucket(hour: number, activeSeconds: number): ActivityHourlyBucket {
  return { hour, activeSeconds, idleSeconds: 0, unknownSeconds: 0 };
}

function dailyStats(overrides: Partial<ActivityDailyStatsResult>): ActivityDailyStatsResult {
  return {
    date: '2026-07-19',
    isToday: true,
    totalSeconds: 0,
    activeSeconds: 0,
    idleSeconds: 0,
    unknownSeconds: 0,
    sessionCount: 0,
    sampleCount: 0,
    hours: Array.from({ length: 24 }, (_, hour) => hourlyBucket(hour, 0)),
    ...overrides,
  };
}

function trendDay(date: string, activeSeconds: number, isToday = false): ActivityTrendDay {
  return {
    date,
    isToday,
    activeSeconds,
    focusSeconds: 0,
    contextSwitchCount: 0,
    sessionCount: activeSeconds > 0 ? 1 : 0,
    topAppName: '',
  };
}

function weeklyTrend(days: ReadonlyArray<ActivityTrendDay>): ActivityWeeklyTrendResult {
  return {
    days,
    averageActiveSeconds: 0,
    comparisonToAverageText: '',
    comparisonToYesterdayText: '',
    weekToDateText: '',
  };
}

describe('activityModel', () => {
  it('没有采样时今日统计进入 Empty', () => {
    expect(isDailyStatsEmpty(dailyStats({}))).toBe(true);
    expect(isDailyStatsEmpty(dailyStats({ sampleCount: 12 }))).toBe(false);
  });

  it('7 天全部为零时趋势进入 Empty', () => {
    const emptyDays = Array.from({ length: 7 }, (_, index) => trendDay(`2026-07-${String(13 + index)}`, 0));
    expect(isWeeklyTrendEmpty(weeklyTrend(emptyDays))).toBe(true);

    const withActivity = [...emptyDays.slice(0, 6), trendDay('2026-07-19', 300, true)];
    expect(isWeeklyTrendEmpty(weeklyTrend(withActivity))).toBe(false);
  });

  it('柱高按最大值等比缩放并处理零与负值', () => {
    expect(getMaxActiveSeconds([])).toBe(0);
    expect(getMaxActiveSeconds([120, 480, 240])).toBe(480);

    expect(getRelativeBarHeightPercent(480, 480)).toBe(100);
    expect(getRelativeBarHeightPercent(240, 480)).toBe(50);
    expect(getRelativeBarHeightPercent(0, 480)).toBe(0);
    expect(getRelativeBarHeightPercent(120, 0)).toBe(0);
    expect(getRelativeBarHeightPercent(-30, 480)).toBe(0);
  });

  it('只有今天的数据才高亮当前小时', () => {
    expect(resolveCurrentHour(true, 14)).toBe(14);
    expect(resolveCurrentHour(false, 14)).toBe(-1);
  });
});
