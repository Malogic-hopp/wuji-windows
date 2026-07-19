import { describe, expect, it } from 'vitest';
import type { ActivityHeatmapCell, ActivityHeatmapResult } from '../../bridge/contracts';
import {
  buildGrid,
  cellAt,
  clampFocusPosition,
  getCellLabel,
  getDefaultFocusPosition,
  getTimelineHourPath,
  isHeatmapEmpty,
  moveFocus,
  normalizeIntensityLevel,
} from './heatmapModel';

const dates = [
  '2026-07-13',
  '2026-07-14',
  '2026-07-15',
  '2026-07-16',
  '2026-07-17',
  '2026-07-18',
  '2026-07-19',
];

function cell(date: string, hour: number, overrides: Partial<ActivityHeatmapCell> = {}): ActivityHeatmapCell {
  return {
    date,
    hour,
    activeSamples: 0,
    idleSamples: 0,
    unknownSamples: 0,
    activeRatioPercent: 0,
    intensityLevel: 0,
    ...overrides,
  };
}

function weekCells(list: ReadonlyArray<string>): ActivityHeatmapCell[] {
  return list.flatMap((date) => Array.from({ length: 24 }, (_, hour) => cell(date, hour)));
}

function heatmap(cells: ReadonlyArray<ActivityHeatmapCell>, today = '2026-07-19'): ActivityHeatmapResult {
  return { today, cells };
}

describe('heatmapModel buildGrid 与 cellAt', () => {
  it('生成 24 行 × 7 列，小时从上到下 0→23，日期升序从左到右', () => {
    const { dates: gridDates, today, rows } = buildGrid(heatmap(weekCells(dates)));

    expect(gridDates).toEqual(dates);
    expect(today).toBe('2026-07-19');
    expect(rows).toHaveLength(24);
    expect(rows[0].hour).toBe(0);
    expect(rows[23].hour).toBe(23);
    expect(rows.every((row) => row.cells.length === dates.length)).toBe(true);
    expect(rows[0].cells.map((c) => c.date)).toEqual(dates);
  });

  it('乱序输入按日期排序，缺失格子按零补齐', () => {
    const sparse = [
      cell('2026-07-19', 5, { activeSamples: 3, activeRatioPercent: 50, intensityLevel: 2 }),
      cell('2026-07-18', 2),
    ];
    const { dates: gridDates, rows } = buildGrid(heatmap(sparse));

    expect(gridDates).toEqual(['2026-07-18', '2026-07-19']);
    expect(rows).toHaveLength(24);
    expect(rows[5].cells[0]).toMatchObject({ date: '2026-07-18', hour: 5, activeSamples: 0 });
    expect(rows[5].cells[1]).toMatchObject({ activeSamples: 3, intensityLevel: 2 });
    expect(rows[2].cells[0]).toMatchObject({ date: '2026-07-18', hour: 2 });
  });

  it('cellAt 按日期与小时精确查找', () => {
    const cells = weekCells(dates);
    expect(cellAt(cells, '2026-07-19', 14)).toMatchObject({ date: '2026-07-19', hour: 14 });
    expect(cellAt(cells, '2026-07-20', 0)).toBeUndefined();
    expect(cellAt(cells, '2026-07-19', 24)).toBeUndefined();
  });
});

describe('heatmapModel isHeatmapEmpty', () => {
  it('全部活跃采样为 0 时判定为空', () => {
    expect(isHeatmapEmpty(heatmap(weekCells(dates)))).toBe(true);
    expect(isHeatmapEmpty(heatmap([cell('2026-07-19', 9, { idleSamples: 8 })]))).toBe(true);
  });

  it('任一格子有活跃采样则不空', () => {
    expect(isHeatmapEmpty(heatmap([cell('2026-07-19', 9, { activeSamples: 1 })]))).toBe(false);
  });
});

describe('heatmapModel 焦点移动', () => {
  const hourCount = 24;
  const dateCount = 7;

  it('方向键：↑↓ 改小时，←→ 改日期', () => {
    const start = { hourIndex: 14, dateIndex: 3 };
    expect(moveFocus(start, 'ArrowUp', hourCount, dateCount)).toEqual({ hourIndex: 13, dateIndex: 3 });
    expect(moveFocus(start, 'ArrowDown', hourCount, dateCount)).toEqual({ hourIndex: 15, dateIndex: 3 });
    expect(moveFocus(start, 'ArrowLeft', hourCount, dateCount)).toEqual({ hourIndex: 14, dateIndex: 2 });
    expect(moveFocus(start, 'ArrowRight', hourCount, dateCount)).toEqual({ hourIndex: 14, dateIndex: 4 });
  });

  it('边缘收敛不环绕', () => {
    expect(moveFocus({ hourIndex: 0, dateIndex: 0 }, 'ArrowUp', hourCount, dateCount))
      .toEqual({ hourIndex: 0, dateIndex: 0 });
    expect(moveFocus({ hourIndex: 23, dateIndex: 6 }, 'ArrowDown', hourCount, dateCount))
      .toEqual({ hourIndex: 23, dateIndex: 6 });
    expect(moveFocus({ hourIndex: 0, dateIndex: 0 }, 'ArrowLeft', hourCount, dateCount))
      .toEqual({ hourIndex: 0, dateIndex: 0 });
    expect(moveFocus({ hourIndex: 23, dateIndex: 6 }, 'ArrowRight', hourCount, dateCount))
      .toEqual({ hourIndex: 23, dateIndex: 6 });
  });

  it('Home/End 跳到该行最早/最晚日期', () => {
    expect(moveFocus({ hourIndex: 14, dateIndex: 3 }, 'Home', hourCount, dateCount))
      .toEqual({ hourIndex: 14, dateIndex: 0 });
    expect(moveFocus({ hourIndex: 14, dateIndex: 3 }, 'End', hourCount, dateCount))
      .toEqual({ hourIndex: 14, dateIndex: 6 });
  });

  it('clampFocusPosition 收敛越界', () => {
    expect(clampFocusPosition({ hourIndex: 30, dateIndex: 10 }, hourCount, dateCount))
      .toEqual({ hourIndex: 23, dateIndex: 6 });
    expect(clampFocusPosition({ hourIndex: -1, dateIndex: -5 }, hourCount, dateCount))
      .toEqual({ hourIndex: 0, dateIndex: 0 });
  });
});

describe('heatmapModel 默认焦点', () => {
  it('聚焦今天的日期列 + 当前小时行', () => {
    const grid = buildGrid(heatmap(weekCells(dates)));
    expect(getDefaultFocusPosition(grid, 14)).toEqual({ hourIndex: 14, dateIndex: 6 });
  });

  it('小时越界收敛', () => {
    const grid = buildGrid(heatmap(weekCells(dates)));
    expect(getDefaultFocusPosition(grid, 99)).toEqual({ hourIndex: 23, dateIndex: 6 });
    expect(getDefaultFocusPosition(grid, -3)).toEqual({ hourIndex: 0, dateIndex: 6 });
  });

  it('没有今天列时退到最后一列', () => {
    const grid = buildGrid(heatmap(weekCells(dates), '2026-07-25'));
    expect(getDefaultFocusPosition(grid, 14)).toEqual({ hourIndex: 14, dateIndex: 6 });
  });

  it('空数据退到零位置', () => {
    const grid = buildGrid(heatmap([]));
    expect(getDefaultFocusPosition(grid, 14)).toEqual({ hourIndex: 14, dateIndex: 0 });
  });
});

describe('heatmapModel 标签与地址', () => {
  it('无采样格子给出说明', () => {
    expect(getCellLabel(cell('2026-07-19', 14), 'zh-CN')).toBe('7月19日 14时，无采样记录');
  });

  it('有采样格子包含占比、采样数、强度', () => {
    const label = getCellLabel(
      cell('2026-07-19', 14, { activeSamples: 120, idleSamples: 30, activeRatioPercent: 62, intensityLevel: 3 }),
      'zh-CN',
    );
    expect(label).toBe('7月19日 14时，活跃占比 62%，活跃采样 120 条，活跃程度 高');
  });

  it('强度等级防御性收敛', () => {
    expect(normalizeIntensityLevel(0)).toBe(0);
    expect(normalizeIntensityLevel(4)).toBe(4);
    expect(normalizeIntensityLevel(9)).toBe(4);
    expect(normalizeIntensityLevel(-2)).toBe(0);
  });

  it('时间线跳转地址', () => {
    expect(getTimelineHourPath('2026-07-19', 14)).toBe('/activity/timeline?date=2026-07-19&hour=14');
    expect(getTimelineHourPath('2026-07-13', 0)).toBe('/activity/timeline?date=2026-07-13&hour=0');
  });
});
