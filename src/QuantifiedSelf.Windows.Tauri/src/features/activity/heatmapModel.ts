import type { ActivityHeatmapCell, ActivityHeatmapResult } from '../../bridge/contracts';
import { formatCount, formatHourLabel, formatMonthDayLabel } from './activityFormatting';

export const heatmapColumnCount = 24;

export type ActivityHeatmapViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty'; readonly updatedAt: number }
  | { readonly kind: 'ready'; readonly heatmap: ActivityHeatmapResult; readonly updatedAt: number }
  | { readonly kind: 'error'; readonly message: string };

export interface HeatmapGridRow {
  readonly date: string;
  readonly isToday: boolean;
  /** 固定 24 格，按小时 0-23 排列，缺失小时已按零补齐。 */
  readonly cells: ReadonlyArray<ActivityHeatmapCell>;
}

export interface HeatmapFocusPosition {
  readonly rowIndex: number;
  readonly hourIndex: number;
}

export type HeatmapFocusKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

type Locale = string | readonly string[] | undefined;

/** 五级强度的展示文案（图例与读屏共用）。等级由服务端计算，前端不做二次推导。 */
export const heatmapIntensityLabels = ['无', '低', '中', '高', '极高'] as const;

export function isHeatmapEmpty(heatmap: ActivityHeatmapResult) {
  return heatmap.cells.every((cell) => cell.activeSamples <= 0);
}

export function cellAt(cells: ReadonlyArray<ActivityHeatmapCell>, date: string, hour: number) {
  return cells.find((cell) => cell.date === date && cell.hour === hour);
}

/** 按本地日期升序分行（最早在上、今天在下），缺失小时按零补齐为完整 24 格。 */
export function buildGrid(heatmap: ActivityHeatmapResult): ReadonlyArray<HeatmapGridRow> {
  const dates = [...new Set(heatmap.cells.map((cell) => cell.date))].sort();
  return dates.map((date) => ({
    date,
    isToday: date === heatmap.today,
    cells: Array.from({ length: heatmapColumnCount }, (_, hour) =>
      cellAt(heatmap.cells, date, hour) ?? createZeroCell(date, hour)),
  }));
}

/** 服务端强度等级防御性收敛到 0-4，避免异常值击穿样式与文案下标。 */
export function normalizeIntensityLevel(level: number) {
  return clamp(Math.trunc(level), 0, heatmapIntensityLabels.length - 1);
}

/** 默认聚焦格：今天的当前本地小时；没有今天行时退到最后一格。 */
export function getDefaultFocusPosition(
  rows: ReadonlyArray<HeatmapGridRow>,
  currentHour: number,
): HeatmapFocusPosition {
  const todayRowIndex = rows.findIndex((row) => row.isToday);
  if (todayRowIndex < 0) {
    return { rowIndex: Math.max(0, rows.length - 1), hourIndex: heatmapColumnCount - 1 };
  }
  return { rowIndex: todayRowIndex, hourIndex: clamp(Math.trunc(currentHour), 0, heatmapColumnCount - 1) };
}

/** 方向键移动（边缘收敛、不环绕），Home/End 跳到行首/行尾。 */
export function moveFocus(
  position: HeatmapFocusPosition,
  key: HeatmapFocusKey,
  rowCount: number,
  columnCount = heatmapColumnCount,
): HeatmapFocusPosition {
  switch (key) {
    case 'ArrowUp':
      return clampFocusPosition({ rowIndex: position.rowIndex - 1, hourIndex: position.hourIndex }, rowCount, columnCount);
    case 'ArrowDown':
      return clampFocusPosition({ rowIndex: position.rowIndex + 1, hourIndex: position.hourIndex }, rowCount, columnCount);
    case 'ArrowLeft':
      return clampFocusPosition({ rowIndex: position.rowIndex, hourIndex: position.hourIndex - 1 }, rowCount, columnCount);
    case 'ArrowRight':
      return clampFocusPosition({ rowIndex: position.rowIndex, hourIndex: position.hourIndex + 1 }, rowCount, columnCount);
    case 'Home':
      return clampFocusPosition({ rowIndex: position.rowIndex, hourIndex: 0 }, rowCount, columnCount);
    case 'End':
      return clampFocusPosition({ rowIndex: position.rowIndex, hourIndex: columnCount - 1 }, rowCount, columnCount);
  }
}

export function clampFocusPosition(
  position: HeatmapFocusPosition,
  rowCount: number,
  columnCount = heatmapColumnCount,
): HeatmapFocusPosition {
  return {
    rowIndex: clamp(position.rowIndex, 0, Math.max(0, rowCount - 1)),
    hourIndex: clamp(position.hourIndex, 0, Math.max(0, columnCount - 1)),
  };
}

/**
 * 格子标签（tooltip 与 aria-label 共用）。
 * 只使用已下发字段：占比与采样计数，不推导服务端未提供的时长。
 */
export function getCellLabel(cell: ActivityHeatmapCell, locale?: Locale): string {
  const prefix = `${formatMonthDayLabel(cell.date, locale)} ${formatHourLabel(cell.hour)}`;
  const totalSamples = cell.activeSamples + cell.idleSamples + cell.unknownSamples;
  if (totalSamples <= 0) {
    return `${prefix}，无采样记录`;
  }
  const intensity = heatmapIntensityLabels[normalizeIntensityLevel(cell.intensityLevel)];
  return `${prefix}，活跃占比 ${formatCount(cell.activeRatioPercent, locale)}%，活跃采样 ${formatCount(cell.activeSamples, locale)} 条，活跃程度 ${intensity}`;
}

/** 跳转到时间线对应日期小时的地址（热力图格子与今日页柱状图共用）。 */
export function getTimelineHourPath(date: string, hour: number) {
  return `/activity/timeline?date=${date}&hour=${String(hour)}`;
}

function createZeroCell(date: string, hour: number): ActivityHeatmapCell {
  return {
    date,
    hour,
    activeSamples: 0,
    idleSamples: 0,
    unknownSamples: 0,
    activeRatioPercent: 0,
    intensityLevel: 0,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
