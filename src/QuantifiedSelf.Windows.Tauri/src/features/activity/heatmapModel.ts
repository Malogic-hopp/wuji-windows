import type { ActivityHeatmapCell, ActivityHeatmapResult } from '../../bridge/contracts';
import { formatCount, formatHourLabel, formatMonthDayLabel } from './activityFormatting';

export const heatmapHourCount = 24;

export type ActivityHeatmapViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty'; readonly updatedAt: number }
  | { readonly kind: 'ready'; readonly heatmap: ActivityHeatmapResult; readonly updatedAt: number }
  | { readonly kind: 'error'; readonly message: string };

/** 一行 = 一个小时，cells 按日期升序排列。 */
export interface HeatmapGridRow {
  readonly hour: number;
  readonly cells: ReadonlyArray<ActivityHeatmapCell>;
}

/** buildGrid 返回的完整网格。dates 升序、rows 从上到下 0→23 时。 */
export interface HeatmapGridData {
  readonly dates: ReadonlyArray<string>;
  readonly today: string;
  readonly rows: ReadonlyArray<HeatmapGridRow>;
}

export interface HeatmapFocusPosition {
  readonly hourIndex: number;
  readonly dateIndex: number;
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

/** 转置：24 行（小时 0→23 从上到下）、N 列（日期升序从左到右）。 */
export function buildGrid(heatmap: ActivityHeatmapResult): HeatmapGridData {
  const dates = [...new Set(heatmap.cells.map((cell) => cell.date))].sort();
  const rows = Array.from({ length: heatmapHourCount }, (_, hour) => ({
    hour,
    cells: dates.map((date) =>
      cellAt(heatmap.cells, date, hour) ?? createZeroCell(date, hour)),
  }));
  return { dates, today: heatmap.today, rows };
}

/** 服务端强度等级防御性收敛到 0-4，避免异常值击穿样式与文案下标。 */
export function normalizeIntensityLevel(level: number) {
  return clamp(Math.trunc(level), 0, heatmapIntensityLabels.length - 1);
}

/** 默认聚焦格：今天的日期列 + 当前小时行。没有今天列时退到最后一列。 */
export function getDefaultFocusPosition(
  grid: HeatmapGridData,
  currentHour: number,
): HeatmapFocusPosition {
  const todayIndex = grid.dates.indexOf(grid.today);
  const dateCount = Math.max(1, grid.dates.length);
  const dateIndex = todayIndex < 0 ? dateCount - 1 : todayIndex;
  return {
    hourIndex: clamp(Math.trunc(currentHour), 0, heatmapHourCount - 1),
    dateIndex: clamp(dateIndex, 0, dateCount - 1),
  };
}

/** 方向键移动（边缘收敛、不环绕）。↑↓ 改小时，←→ 改日期，Home/End 跳到行首/行尾。 */
export function moveFocus(
  position: HeatmapFocusPosition,
  key: HeatmapFocusKey,
  hourCount: number,
  dateCount: number,
): HeatmapFocusPosition {
  switch (key) {
    case 'ArrowUp':
      return clampFocusPosition({ hourIndex: position.hourIndex - 1, dateIndex: position.dateIndex }, hourCount, dateCount);
    case 'ArrowDown':
      return clampFocusPosition({ hourIndex: position.hourIndex + 1, dateIndex: position.dateIndex }, hourCount, dateCount);
    case 'ArrowLeft':
      return clampFocusPosition({ hourIndex: position.hourIndex, dateIndex: position.dateIndex - 1 }, hourCount, dateCount);
    case 'ArrowRight':
      return clampFocusPosition({ hourIndex: position.hourIndex, dateIndex: position.dateIndex + 1 }, hourCount, dateCount);
    case 'Home':
      return clampFocusPosition({ hourIndex: position.hourIndex, dateIndex: 0 }, hourCount, dateCount);
    case 'End':
      return clampFocusPosition({ hourIndex: position.hourIndex, dateIndex: dateCount - 1 }, hourCount, dateCount);
  }
}

export function clampFocusPosition(
  position: HeatmapFocusPosition,
  hourCount: number,
  dateCount: number,
): HeatmapFocusPosition {
  return {
    hourIndex: clamp(position.hourIndex, 0, Math.max(0, hourCount - 1)),
    dateIndex: clamp(position.dateIndex, 0, Math.max(0, dateCount - 1)),
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

const timeOfDayLabels: Record<number, string> = {
  3: '凌晨',
  9: '上午',
  15: '下午',
  21: '晚上',
};

/** 时段标签只在每段中间显示：3时→凌晨，9时→上午，15时→下午，21时→晚上。 */
export function getTimeOfDayLabel(hour: number): string {
  return timeOfDayLabels[clamp(Math.trunc(hour), 0, 23)] ?? '';
}

/** 该小时是时段最后一行（5/11/17），下方应画分隔线。 */
export function isHourPeriodEnd(hour: number): boolean {
  return hour === 5 || hour === 11 || hour === 17;
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
