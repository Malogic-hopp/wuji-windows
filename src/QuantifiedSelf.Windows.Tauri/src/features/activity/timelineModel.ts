import type {
  ActivityTimelineCloseReason,
  ActivityTimelineGap,
  ActivityTimelineResult,
  ActivityTimelineSession,
} from '../../bridge/contracts';
import { formatLocalDateParam } from './activityFormatting';

export type ActivityTimelineViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty'; readonly updatedAt: number }
  | { readonly kind: 'ready'; readonly timeline: ActivityTimelineResult; readonly updatedAt: number }
  | { readonly kind: 'error'; readonly message: string };

export interface TrackSegmentGeometry {
  readonly leftPercent: number;
  readonly widthPercent: number;
}

export type TimelineTrackSegment =
  | { readonly kind: 'session'; readonly session: ActivityTimelineSession; readonly key: string }
  | { readonly kind: 'gap'; readonly gap: ActivityTimelineGap; readonly key: string };

export type TimelineTrackSegmentWithGeometry = TimelineTrackSegment & TrackSegmentGeometry;

/** 时间线刻度标签（每 3 小时一个，含 0 时与 24 时两个端点）。 */
export const timelineScaleHours = [0, 3, 6, 9, 12, 15, 18, 21, 24] as const;

const dateParamPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const hourParamPattern = /^\d{1,2}$/;
const millisecondsPerDay = 86_400_000;

export function isTimelineEmpty(timeline: ActivityTimelineResult) {
  return timeline.sessions.length === 0 && timeline.gaps.length === 0;
}

/** 严格解析 yyyy-MM-dd 参数，非法日期（含 2026-02-31 这类溢出）返回 undefined。 */
export function parseTimelineDateParam(value: string | null): string | undefined {
  if (value === null) return undefined;
  const match = dateParamPattern.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined;
  }
  return value;
}

/** 在 yyyy-MM-dd 参数上按本地自然日前后偏移，跨月跨年自动进位。 */
export function shiftDateParam(dateParam: string, offsetDays: number): string {
  const match = dateParamPattern.exec(dateParam);
  if (!match) return dateParam;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setDate(date.getDate() + offsetDays);
  return formatLocalDateParam(date);
}

/** 零填充 yyyy-MM-dd 的字典序与时间序一致，可直接比较。 */
export function isDateParamAtOrAfterToday(dateParam: string, todayParam: string) {
  return dateParam >= todayParam;
}

/** 解析 0-23 的小时定位参数，越界或非法输入返回 undefined（不高亮）。 */
export function parseTimelineHourParam(value: string | null): number | undefined {
  if (value === null || !hourParamPattern.test(value)) return undefined;
  const hour = Number(value);
  return hour >= 0 && hour <= 23 ? hour : undefined;
}

/** UTC ISO 时间 → 本地自然日内的小数位置（0 = 本地午夜，1 = 次日午夜），越界收敛到端点。 */
export function getLocalDayFraction(isoUtc: string): number {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return 0;
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const fraction = (date.getTime() - startOfDay.getTime()) / millisecondsPerDay;
  return Math.min(1, Math.max(0, fraction));
}

/**
 * 起止时间 → 轨道上的 left% / width%，端点即 0% 与 100%。
 * 会话已按本地自然日截断：结束于次日 0 时（跨午夜截断点）视为 100%。
 */
export function getTrackSegmentGeometry(startedAtUtc: string, endedAtUtc: string): TrackSegmentGeometry {
  const startFraction = getLocalDayFraction(startedAtUtc);
  let endFraction = getLocalDayFraction(endedAtUtc);
  const startTime = new Date(startedAtUtc).getTime();
  const endTime = new Date(endedAtUtc).getTime();
  if (!Number.isNaN(startTime) && !Number.isNaN(endTime) && endTime > startTime && endFraction <= startFraction) {
    endFraction = 1;
  }
  const leftPercent = roundPercent(Math.min(startFraction, endFraction) * 100);
  const widthPercent = roundPercent(Math.abs(endFraction - startFraction) * 100);
  return { leftPercent, widthPercent };
}

/** 会话与间隔合并为按开始位置排序的轨道片段序列。 */
export function buildTrackSegments(timeline: ActivityTimelineResult): ReadonlyArray<TimelineTrackSegmentWithGeometry> {
  const sessions = timeline.sessions.map((session): TimelineTrackSegmentWithGeometry => ({
    kind: 'session',
    session,
    ...getTrackSegmentGeometry(session.startedAtUtc, session.endedAtUtc ?? session.startedAtUtc),
    key: `session-${session.startedAtUtc}`,
  }));
  const gaps = timeline.gaps.map((gap): TimelineTrackSegmentWithGeometry => ({
    kind: 'gap',
    gap,
    ...getTrackSegmentGeometry(gap.startedAtUtc, gap.endedAtUtc),
    key: `gap-${gap.startedAtUtc}`,
  }));
  return [...sessions, ...gaps].sort((a, b) => a.leftPercent - b.leftPercent);
}

/** 小时定位高亮带的几何（覆盖该小时整段），越界收敛到 0-23。 */
export function getHourHighlightGeometry(hour: number): TrackSegmentGeometry {
  const clamped = Math.min(23, Math.max(0, Math.trunc(hour)));
  const leftPercent = roundPercent((clamped / 24) * 100);
  return { leftPercent, widthPercent: roundPercent(100 / 24) };
}

/** 结束原因只保留对用户有含义的中文说明，其余省略。 */
export function getCloseReasonLabel(closeReason: ActivityTimelineCloseReason): string | undefined {
  switch (closeReason) {
    case 'paused':
      return '已暂停';
    case 'stopped':
      return '已停止';
    default:
      return undefined;
  }
}

function roundPercent(value: number) {
  return Math.round(value * 1000) / 1000;
}
