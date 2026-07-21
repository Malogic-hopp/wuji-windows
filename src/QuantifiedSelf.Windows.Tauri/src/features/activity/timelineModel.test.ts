import { describe, expect, it } from 'vitest';
import type {
  ActivityTimelineResult,
  ActivityTimelineSession,
} from '../../bridge/contracts';
import {
  buildTrackSegments,
  getCloseReasonLabel,
  getHourHighlightGeometry,
  getLocalDayFraction,
  getNowPercent,
  getTrackSegmentGeometry,
  isDateParamAtOrAfterToday,
  isTimelineEmpty,
  parseTimelineDateParam,
  parseTimelineHourParam,
  shiftDateParam,
} from './timelineModel';

function localIso(year: number, month: number, day: number, hour: number, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

function session(overrides: Partial<ActivityTimelineSession>): ActivityTimelineSession {
  return {
    startedAtUtc: localIso(2026, 7, 19, 9, 0),
    endedAtUtc: localIso(2026, 7, 19, 10, 0),
    isOpen: false,
    appName: 'Visual Studio Code',
    totalSeconds: 3_600,
    activeSeconds: 3_000,
    idleSeconds: 600,
    unknownSeconds: 0,
    closeReason: 'other',
    subSegments: [],
    ...overrides,
  };
}

function timeline(overrides: Partial<ActivityTimelineResult>): ActivityTimelineResult {
  return {
    date: '2026-07-19',
    isToday: false,
    rawSessionCount: 0,
    sessions: [],
    gaps: [],
    ...overrides,
  };
}

describe('timelineModel 日期参数', () => {
  it('严格解析 yyyy-MM-dd，非法与垃圾输入返回 undefined', () => {
    expect(parseTimelineDateParam('2026-07-19')).toBe('2026-07-19');
    expect(parseTimelineDateParam(null)).toBeUndefined();
    expect(parseTimelineDateParam('')).toBeUndefined();
    expect(parseTimelineDateParam('today')).toBeUndefined();
    expect(parseTimelineDateParam('2026-7-19')).toBeUndefined();
    expect(parseTimelineDateParam('2026/07/19')).toBeUndefined();
    expect(parseTimelineDateParam('2026-13-01')).toBeUndefined();
    expect(parseTimelineDateParam('2026-02-31')).toBeUndefined();
  });

  it('前后一天按本地自然日进位，覆盖跨月跨年与闰年', () => {
    expect(shiftDateParam('2026-07-19', -1)).toBe('2026-07-18');
    expect(shiftDateParam('2026-07-19', 1)).toBe('2026-07-20');
    expect(shiftDateParam('2026-07-01', -1)).toBe('2026-06-30');
    expect(shiftDateParam('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDateParam('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDateParam('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('到达或超过今天时禁止继续向后翻页', () => {
    expect(isDateParamAtOrAfterToday('2026-07-19', '2026-07-19')).toBe(true);
    expect(isDateParamAtOrAfterToday('2026-07-20', '2026-07-19')).toBe(true);
    expect(isDateParamAtOrAfterToday('2026-07-18', '2026-07-19')).toBe(false);
  });

  it('小时定位参数限制在 0-23，垃圾输入不高亮', () => {
    expect(parseTimelineHourParam(null)).toBeUndefined();
    expect(parseTimelineHourParam('')).toBeUndefined();
    expect(parseTimelineHourParam('0')).toBe(0);
    expect(parseTimelineHourParam('14')).toBe(14);
    expect(parseTimelineHourParam('23')).toBe(23);
    expect(parseTimelineHourParam('24')).toBeUndefined();
    expect(parseTimelineHourParam('-1')).toBeUndefined();
    expect(parseTimelineHourParam('007')).toBeUndefined();
    expect(parseTimelineHourParam('abc')).toBeUndefined();
  });
});

describe('timelineModel 轨道定位', () => {
  it('UTC 时间按本地时区换算为自然日小数位置', () => {
    expect(getLocalDayFraction(localIso(2026, 7, 19, 0, 0))).toBe(0);
    expect(getLocalDayFraction(localIso(2026, 7, 19, 6, 0))).toBe(0.25);
    expect(getLocalDayFraction(localIso(2026, 7, 19, 12, 0))).toBe(0.5);
    expect(getLocalDayFraction(localIso(2026, 7, 19, 18, 0))).toBe(0.75);
    expect(getLocalDayFraction(localIso(2026, 7, 20, 0, 0))).toBe(0);
    expect(getLocalDayFraction('not-a-date')).toBe(0);
  });

  it('起止时间映射为 left% 与 width%，日界即 0% 与 100%', () => {
    expect(getTrackSegmentGeometry(localIso(2026, 7, 19, 6, 0), localIso(2026, 7, 19, 12, 0)))
      .toEqual({ leftPercent: 25, widthPercent: 25 });
    expect(getTrackSegmentGeometry(localIso(2026, 7, 19, 0, 0), localIso(2026, 7, 20, 0, 0)))
      .toEqual({ leftPercent: 0, widthPercent: 100 });
    const crossMidnight = getTrackSegmentGeometry(localIso(2026, 7, 19, 22, 0), localIso(2026, 7, 20, 0, 0));
    expect(crossMidnight.leftPercent).toBeCloseTo(91.667, 3);
    expect(crossMidnight.widthPercent).toBeCloseTo(8.333, 3);
  });

  it('零时长会话宽度为 0，异常反向区间按两端点跨度兜底', () => {
    const atNine = localIso(2026, 7, 19, 9, 0);
    expect(getTrackSegmentGeometry(atNine, atNine)).toEqual({ leftPercent: 37.5, widthPercent: 0 });
    expect(getTrackSegmentGeometry(localIso(2026, 7, 19, 10, 0), localIso(2026, 7, 19, 9, 0)))
      .toEqual({ leftPercent: 37.5, widthPercent: 4.167 });
  });

  it('小时高亮带覆盖整点区间并收敛越界输入', () => {
    expect(getHourHighlightGeometry(0)).toEqual({ leftPercent: 0, widthPercent: 4.167 });
    expect(getHourHighlightGeometry(14).leftPercent).toBeCloseTo(58.333, 3);
    expect(getHourHighlightGeometry(23).leftPercent).toBeCloseTo(95.833, 3);
    expect(getHourHighlightGeometry(99)).toEqual(getHourHighlightGeometry(23));
    expect(getHourHighlightGeometry(-3)).toEqual(getHourHighlightGeometry(0));
  });
});

describe('timelineModel 轨道片段', () => {
  it('会话与间隔按开始位置合并排序，类型保持可区分', () => {
    const result = timeline({
      sessions: [
        session({ startedAtUtc: localIso(2026, 7, 19, 14, 0), endedAtUtc: localIso(2026, 7, 19, 15, 0) }),
        session({ startedAtUtc: localIso(2026, 7, 19, 9, 0), endedAtUtc: localIso(2026, 7, 19, 10, 0) }),
      ],
      gaps: [{ startedAtUtc: localIso(2026, 7, 19, 10, 0), endedAtUtc: localIso(2026, 7, 19, 14, 0), durationSeconds: 14_400 }],
    });

    const segments = buildTrackSegments(result);
    expect(segments.map((item) => item.kind)).toEqual(['session', 'gap', 'session']);
    expect(segments[0]?.leftPercent).toBe(37.5);
    expect(segments[1]?.leftPercent).toBeCloseTo(41.667, 3);
    expect(segments[1]?.widthPercent).toBeCloseTo(16.667, 3);
    expect(segments[2]?.leftPercent).toBeCloseTo(58.333, 3);
  });

  it('缺少结束时间的开放会话按零宽处理', () => {
    const segments = buildTrackSegments(timeline({
      sessions: [session({ isOpen: true, closeReason: 'open', endedAtUtc: undefined })],
    }));

    expect(segments).toHaveLength(1);
    expect(segments[0]?.kind).toBe('session');
    expect(segments[0]?.widthPercent).toBe(0);
  });

  it('有子段时将会话展开为 active/idle 子段，保持时间顺序', () => {
    const s9 = localIso(2026, 7, 19, 9, 0);
    const s9_15 = localIso(2026, 7, 19, 9, 15);
    const s9_45 = localIso(2026, 7, 19, 9, 45);
    const s10 = localIso(2026, 7, 19, 10, 0);

    const result = timeline({
      sessions: [
        session({
          startedAtUtc: s9,
          endedAtUtc: s10,
          subSegments: [
            { startedAtUtc: s9, endedAtUtc: s9_15, isActive: true },
            { startedAtUtc: s9_15, endedAtUtc: s9_45, isActive: false },
            { startedAtUtc: s9_45, endedAtUtc: s10, isActive: true },
          ],
        }),
      ],
    });

    const segments = buildTrackSegments(result);
    expect(segments.map((item) => item.kind)).toEqual([
      'activeSubSegment',
      'idleSubSegment',
      'activeSubSegment',
    ]);
    // Active sub-segments retain the session reference.
    for (const seg of segments) {
      if (seg.kind === 'activeSubSegment' || seg.kind === 'idleSubSegment') {
        expect(seg.session.appName).toBe('Visual Studio Code');
      }
    }
  });

  it('无子段时退化到整段 session 渲染（向后兼容）', () => {
    const result = timeline({
      sessions: [session({ subSegments: [] })],
    });
    expect(buildTrackSegments(result).map((item) => item.kind)).toEqual(['session']);
  });

  it('纯活跃 session 只有一个 active 子段时也正确展开', () => {
    const s9 = localIso(2026, 7, 19, 9, 0);
    const s10 = localIso(2026, 7, 19, 10, 0);
    const result = timeline({
      sessions: [session({
        idleSeconds: 0,
        subSegments: [{ startedAtUtc: s9, endedAtUtc: s10, isActive: true }],
      })],
    });
    expect(buildTrackSegments(result).map((item) => item.kind)).toEqual(['activeSubSegment']);
  });

  it('无会话且无间隔时判定为空', () => {
    expect(isTimelineEmpty(timeline({}))).toBe(true);
    expect(isTimelineEmpty(timeline({ sessions: [session({})] }))).toBe(false);
    expect(isTimelineEmpty(timeline({
      gaps: [{ startedAtUtc: localIso(2026, 7, 19, 10, 0), endedAtUtc: localIso(2026, 7, 19, 11, 0), durationSeconds: 3_600 }],
    }))).toBe(false);
  });
});

describe('timelineModel 结束原因展示', () => {
  it('只保留有含义的中文说明，其余省略', () => {
    expect(getCloseReasonLabel('paused')).toBe('已暂停');
    expect(getCloseReasonLabel('stopped')).toBe('已停止');
    expect(getCloseReasonLabel('open')).toBeUndefined();
    expect(getCloseReasonLabel('process_changed')).toBeUndefined();
    expect(getCloseReasonLabel('other')).toBeUndefined();
  });
});

describe('timelineModel 现在指示线', () => {
  it('仅查看今天时返回当前时刻位置', () => {
    const noon = new Date(2026, 6, 19, 12, 0, 0);
    expect(getNowPercent(true, noon)).toBe(50);
    expect(getNowPercent(false, noon)).toBeUndefined();
  });
});
