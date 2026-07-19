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
  it('生成 7 行 × 24 格，日期升序、今天在最后并标记', () => {
    const rows = buildGrid(heatmap(weekCells(dates)));

    expect(rows).toHaveLength(7);
    expect(rows.map((row) => row.date)).toEqual(dates);
    expect(rows[6].isToday).toBe(true);
    expect(rows.slice(0, 6).every((row) => !row.isToday)).toBe(true);
    expect(rows.every((row) => row.cells.length === 24)).toBe(true);
    expect(rows[0].cells.map((item) => item.hour)).toEqual(Array.from({ length: 24 }, (_, hour) => hour));
  });

  it('乱序输入按日期排序，缺失格子按零补齐', () => {
    const sparse = [
      cell('2026-07-19', 5, { activeSamples: 3, activeRatioPercent: 50, intensityLevel: 2 }),
      cell('2026-07-18', 2),
    ];
    const rows = buildGrid(heatmap(sparse));

    expect(rows.map((row) => row.date)).toEqual(['2026-07-18', '2026-07-19']);
    expect(rows[0].cells).toHaveLength(24);
    expect(rows[1].cells[5]).toMatchObject({ activeSamples: 3, intensityLevel: 2 });
    expect(rows[1].cells[4]).toMatchObject({
      date: '2026-07-19',
      hour: 4,
      activeSamples: 0,
      activeRatioPercent: 0,
      intensityLevel: 0,
    });
  });

  it('cellAt 按日期与小时精确查找', () => {
    const cells = weekCells(dates);

    expect(cellAt(cells, '2026-07-19', 14)).toMatchObject({ date: '2026-07-19', hour: 14 });
    expect(cellAt(cells, '2026-07-20', 0)).toBeUndefined();
    expect(cellAt(cells, '2026-07-19', 24)).toBeUndefined();
  });
});

describe('heatmapModel isHeatmapEmpty', () => {
  it('全部活跃采样为 0 时判定为空（含只有空闲采样的情况）', () => {
    expect(isHeatmapEmpty(heatmap(weekCells(dates)))).toBe(true);
    expect(isHeatmapEmpty(heatmap([cell('2026-07-19', 9, { idleSamples: 8 })]))).toBe(true);
  });

  it('任一格子有活跃采样则不空', () => {
    expect(isHeatmapEmpty(heatmap([cell('2026-07-19', 9, { activeSamples: 1 })]))).toBe(false);
  });
});

describe('heatmapModel 焦点移动', () => {
  it('方向键在网格内移动', () => {
    const start = { rowIndex: 3, hourIndex: 10 };

    expect(moveFocus(start, 'ArrowLeft', 7)).toEqual({ rowIndex: 3, hourIndex: 9 });
    expect(moveFocus(start, 'ArrowRight', 7)).toEqual({ rowIndex: 3, hourIndex: 11 });
    expect(moveFocus(start, 'ArrowUp', 7)).toEqual({ rowIndex: 2, hourIndex: 10 });
    expect(moveFocus(start, 'ArrowDown', 7)).toEqual({ rowIndex: 4, hourIndex: 10 });
  });

  it('边缘收敛不环绕', () => {
    expect(moveFocus({ rowIndex: 0, hourIndex: 0 }, 'ArrowLeft', 7)).toEqual({ rowIndex: 0, hourIndex: 0 });
    expect(moveFocus({ rowIndex: 0, hourIndex: 0 }, 'ArrowUp', 7)).toEqual({ rowIndex: 0, hourIndex: 0 });
    expect(moveFocus({ rowIndex: 6, hourIndex: 23 }, 'ArrowRight', 7)).toEqual({ rowIndex: 6, hourIndex: 23 });
    expect(moveFocus({ rowIndex: 6, hourIndex: 23 }, 'ArrowDown', 7)).toEqual({ rowIndex: 6, hourIndex: 23 });
  });

  it('Home/End 跳到行首与行尾', () => {
    expect(moveFocus({ rowIndex: 2, hourIndex: 7 }, 'Home', 7)).toEqual({ rowIndex: 2, hourIndex: 0 });
    expect(moveFocus({ rowIndex: 2, hourIndex: 7 }, 'End', 7)).toEqual({ rowIndex: 2, hourIndex: 23 });
  });

  it('clampFocusPosition 收敛越界位置', () => {
    expect(clampFocusPosition({ rowIndex: 9, hourIndex: 30 }, 7)).toEqual({ rowIndex: 6, hourIndex: 23 });
    expect(clampFocusPosition({ rowIndex: -1, hourIndex: -5 }, 7)).toEqual({ rowIndex: 0, hourIndex: 0 });
  });
});

describe('heatmapModel 默认焦点', () => {
  it('默认聚焦今天的当前本地小时', () => {
    const rows = buildGrid(heatmap(weekCells(dates)));

    expect(getDefaultFocusPosition(rows, 14)).toEqual({ rowIndex: 6, hourIndex: 14 });
  });

  it('当前小时越界时收敛到 0-23', () => {
    const rows = buildGrid(heatmap(weekCells(dates)));

    expect(getDefaultFocusPosition(rows, 99)).toEqual({ rowIndex: 6, hourIndex: 23 });
    expect(getDefaultFocusPosition(rows, -3)).toEqual({ rowIndex: 6, hourIndex: 0 });
  });

  it('没有今天行时退到最后一格', () => {
    const rows = buildGrid(heatmap(weekCells(dates), '2026-07-25'));

    expect(getDefaultFocusPosition(rows, 14)).toEqual({ rowIndex: 6, hourIndex: 23 });
    expect(getDefaultFocusPosition([], 14)).toEqual({ rowIndex: 0, hourIndex: 23 });
  });
});

describe('heatmapModel 标签与地址', () => {
  it('无采样格子给出事实说明', () => {
    expect(getCellLabel(cell('2026-07-19', 14), 'zh-CN')).toBe('7月19日 14时，无采样记录');
  });

  it('有采样格子包含占比、活跃采样数与强度等级', () => {
    const label = getCellLabel(
      cell('2026-07-19', 14, { activeSamples: 120, idleSamples: 30, activeRatioPercent: 62, intensityLevel: 3 }),
      'zh-CN',
    );

    expect(label).toBe('7月19日 14时，活跃占比 62%，活跃采样 120 条，活跃程度 高');
  });

  it('强度等级防御性收敛，不重新推导', () => {
    expect(normalizeIntensityLevel(0)).toBe(0);
    expect(normalizeIntensityLevel(4)).toBe(4);
    expect(normalizeIntensityLevel(9)).toBe(4);
    expect(normalizeIntensityLevel(-2)).toBe(0);
  });

  it('构造时间线跳转地址', () => {
    expect(getTimelineHourPath('2026-07-19', 14)).toBe('/activity/timeline?date=2026-07-19&hour=14');
    expect(getTimelineHourPath('2026-07-13', 0)).toBe('/activity/timeline?date=2026-07-13&hour=0');
  });
});
