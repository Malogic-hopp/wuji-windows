import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatHourLabel,
  formatLocalDateParam,
  formatMonthDayLabel,
  formatSessionTimeOfDay,
  formatSessionTimeRange,
  formatWeekdayLabel,
} from './activityFormatting';

describe('activityFormatting', () => {
  it('按本地时区生成零填充的日期参数', () => {
    expect(formatLocalDateParam(new Date(2026, 6, 19, 9, 5, 0))).toBe('2026-07-19');
    expect(formatLocalDateParam(new Date(2026, 0, 5, 23, 59, 0))).toBe('2026-01-05');
    expect(formatLocalDateParam(new Date(2026, 11, 31, 0, 0, 0))).toBe('2026-12-31');
  });

  it('复用共享的中文时长格式化并覆盖边界', () => {
    expect(formatDuration(0, 'zh-CN')).toBe('0秒');
    expect(formatDuration(59, 'zh-CN')).toBe('59秒');
    expect(formatDuration(60, 'zh-CN')).toBe('1分钟');
    expect(formatDuration(3_600, 'zh-CN')).toBe('1小时');
    expect(formatDuration(3_660, 'zh-CN')).toBe('1小时1分钟');
  });

  it('将 0-23 小时格式化为中文小时标签', () => {
    expect(formatHourLabel(0)).toBe('0时');
    expect(formatHourLabel(14)).toBe('14时');
    expect(formatHourLabel(23)).toBe('23时');
  });

  it('按本地日期参数格式化星期和月日标签', () => {
    const localDate = new Date(2026, 6, 19);
    expect(formatWeekdayLabel('2026-07-19', 'zh-CN'))
      .toBe(new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(localDate));
    expect(formatMonthDayLabel('2026-07-19', 'zh-CN')).toBe('7月19日');
    expect(formatMonthDayLabel('2026-01-05', 'zh-CN')).toBe('1月5日');
  });

  it('对非法日期参数返回原始文本', () => {
    expect(formatWeekdayLabel('not-a-date', 'zh-CN')).toBe('not-a-date');
    expect(formatMonthDayLabel('not-a-date', 'zh-CN')).toBe('not-a-date');
  });

  it('按本地时区格式会话时刻为 HH:mm', () => {
    const atNineFive = new Date(2026, 6, 19, 9, 5, 0).toISOString();
    const expected = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
      .format(new Date(2026, 6, 19, 9, 5, 0));
    expect(formatSessionTimeOfDay(atNineFive, 'zh-CN')).toBe(expected);
    expect(formatSessionTimeOfDay(atNineFive, 'zh-CN')).toMatch(/^\d{2}:\d{2}$/);
    expect(formatSessionTimeOfDay('not-a-date', 'zh-CN')).toBe('');
  });

  it('会话时间范围拼接起止，缺结束时间与非法输入有安全回退', () => {
    const start = new Date(2026, 6, 19, 9, 0, 0).toISOString();
    const end = new Date(2026, 6, 19, 10, 30, 0).toISOString();
    expect(formatSessionTimeRange(start, end, 'zh-CN')).toBe('09:00 – 10:30');
    expect(formatSessionTimeRange(start, undefined, 'zh-CN')).toBe('09:00 起');
    expect(formatSessionTimeRange('not-a-date', end, 'zh-CN')).toBe('');
    expect(formatSessionTimeRange(start, 'not-a-date', 'zh-CN')).toBe('09:00');
  });
});
