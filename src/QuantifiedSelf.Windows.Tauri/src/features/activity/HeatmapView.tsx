import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowClockwiseIcon,
  ClockCountdownIcon,
  GridFourIcon,
  InfoIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import type { ActivityHeatmapResult } from '../../bridge/contracts';
import { formatMonthDayLabel, formatWeekdayLabel } from './activityFormatting';
import {
  buildGrid,
  clampFocusPosition,
  getCellLabel,
  getDefaultFocusPosition,
  getTimelineHourPath,
  heatmapColumnCount,
  heatmapIntensityLabels,
  moveFocus,
  normalizeIntensityLevel,
  type ActivityHeatmapViewState,
  type HeatmapFocusKey,
  type HeatmapFocusPosition,
  type HeatmapGridRow,
} from './heatmapModel';
import { formatLastUpdated } from '../dashboard/dashboardFormatting';

type Locale = string | readonly string[] | undefined;

interface HeatmapViewProps {
  readonly state: ActivityHeatmapViewState;
  readonly refreshing: boolean;
  readonly currentHour: number;
  readonly onRefresh: () => void;
  readonly locale?: string;
}

export function HeatmapView({ state, refreshing, currentHour, onRefresh, locale }: HeatmapViewProps) {
  const updatedAt = state.kind === 'ready' || state.kind === 'empty'
    ? state.updatedAt
    : 0;

  return (
    <div className="page activity-page page-enter">
      <header className="page-header dashboard-header">
        <div>
          <p className="eyebrow">热力图</p>
          <h1 tabIndex={-1}>最近 7 天，什么时候最忙</h1>
          <p>按本地时间把最近 7 天、每天 24 小时的活跃程度铺成热力格，颜色越深代表越活跃；今天的格子会随采样持续更新，选中任意格子可查看对应小时的时间线。</p>
        </div>
        {(state.kind === 'ready' || state.kind === 'empty') && (
          <div className="dashboard-refresh">
            <span>最后更新 {formatLastUpdated(updatedAt, locale)}</span>
            <button
              className="button button--secondary"
              type="button"
              disabled={refreshing}
              onClick={onRefresh}
            >
              <ArrowClockwiseIcon className={refreshing ? 'spin' : undefined} size={17} aria-hidden="true" />
              {refreshing ? '正在刷新' : '刷新'}
            </button>
          </div>
        )}
      </header>

      {state.kind === 'loading' && <HeatmapLoading />}
      {state.kind === 'empty' && <HeatmapEmpty onRefresh={onRefresh} refreshing={refreshing} />}
      {state.kind === 'error' && (
        <HeatmapError message={state.message} onRetry={onRefresh} refreshing={refreshing} />
      )}
      {state.kind === 'ready' && (
        <HeatmapReady heatmap={state.heatmap} currentHour={currentHour} locale={locale} />
      )}

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {refreshing
          ? '正在刷新 7 天热力图。'
          : updatedAt > 0
            ? `7 天热力图已更新，最后更新时间 ${formatLastUpdated(updatedAt, locale)}。`
            : ''}
      </p>
    </div>
  );
}

function HeatmapLoading() {
  return (
    <section className="dashboard-state" role="status" aria-live="polite" aria-busy="true">
      <ClockCountdownIcon className="spin" size={28} aria-hidden="true" />
      <div>
        <h2>正在读取 7 天热力图</h2>
        <p>正在通过本地 Bridge 汇总最近 7 天、每天 24 小时的活跃分布。</p>
      </div>
      <div className="dashboard-skeleton" aria-hidden="true">
        <span /><span /><span /><span />
      </div>
    </section>
  );
}

function HeatmapEmpty({ onRefresh, refreshing }: { readonly onRefresh: () => void; readonly refreshing: boolean }) {
  return (
    <section className="dashboard-state dashboard-state--centered" aria-labelledby="heatmap-empty-title">
      <InfoIcon size={30} aria-hidden="true" />
      <div>
        <h2 id="heatmap-empty-title">最近 7 天还没有活跃采样</h2>
        <p>启动 Agent 并使用一段时间后，这里会按小时显示最近 7 天的活跃热力分布。</p>
      </div>
      <button className="button button--secondary" type="button" onClick={onRefresh} disabled={refreshing}>
        <ArrowClockwiseIcon size={17} aria-hidden="true" />
        再检查一次
      </button>
    </section>
  );
}

function HeatmapError({
  message,
  onRetry,
  refreshing,
}: {
  readonly message: string;
  readonly onRetry: () => void;
  readonly refreshing: boolean;
}) {
  return (
    <section className="dashboard-state dashboard-state--error" role="alert" aria-labelledby="heatmap-error-title">
      <WarningCircleIcon size={30} aria-hidden="true" />
      <div>
        <h2 id="heatmap-error-title">暂时无法读取 7 天热力图</h2>
        <p>{message}</p>
        <p className="dashboard-state__note">Agent 会保持原状态运行；重试只会重新读取热力图数据。</p>
      </div>
      <button className="button button--secondary" type="button" onClick={onRetry} disabled={refreshing}>
        <ArrowClockwiseIcon className={refreshing ? 'spin' : undefined} size={17} aria-hidden="true" />
        {refreshing ? '正在重试' : '重试'}
      </button>
    </section>
  );
}

function HeatmapReady({
  heatmap,
  currentHour,
  locale,
}: {
  readonly heatmap: ActivityHeatmapResult;
  readonly currentHour: number;
  readonly locale?: Locale;
}) {
  const navigate = useNavigate();
  const rows = useMemo(() => buildGrid(heatmap), [heatmap]);
  const gridRef = useRef<HTMLDivElement>(null);
  const [focusPosition, setFocusPosition] = useState<HeatmapFocusPosition>(() =>
    getDefaultFocusPosition(rows, currentHour));
  const activeFocus = clampFocusPosition(focusPosition, rows.length);

  const focusCell = (next: HeatmapFocusPosition) => {
    setFocusPosition(next);
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-row="${String(next.rowIndex)}"][data-hour="${String(next.hourIndex)}"]`)
      ?.focus();
  };

  const openCell = (row: HeatmapGridRow, hourIndex: number) => {
    void navigate(getTimelineHourPath(row.date, hourIndex));
  };

  const onCellKeyDown = (event: KeyboardEvent<HTMLDivElement>, rowIndex: number, hourIndex: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openCell(rows[rowIndex], hourIndex);
      return;
    }
    const key = event.key as HeatmapFocusKey;
    switch (key) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'Home':
      case 'End':
        event.preventDefault();
        focusCell(moveFocus({ rowIndex, hourIndex }, key, rows.length));
        break;
      default:
        break;
    }
  };

  return (
    <div className="dashboard-content">
      <section className="dashboard-module" aria-labelledby="heatmap-grid-title">
        <div className="dashboard-module__heading">
          <div className="dashboard-module__icon"><GridFourIcon size={20} aria-hidden="true" /></div>
          <div>
            <h2 id="heatmap-grid-title">7 天 × 24 小时热力图</h2>
            <p>Tab 进入网格后用方向键移动，Enter 或空格打开对应小时的时间线</p>
          </div>
        </div>
        <div className="heatmap-wrap">
          <div className="heatmap-grid__cols" aria-hidden="true">
            <span className="heatmap-grid__corner" />
            {Array.from({ length: heatmapColumnCount }, (_, hour) => (
              <span
                key={hour}
                className={hour % 6 === 0
                  ? 'heatmap-grid__col-label'
                  : 'heatmap-grid__col-label heatmap-grid__col-label--minor'}
              >
                {hour % 3 === 0 || hour === 23 ? hour : ''}
              </span>
            ))}
          </div>
          <div
            className="heatmap-grid"
            role="grid"
            aria-label="最近 7 天每小时活跃热力图"
            ref={gridRef}
          >
            {rows.map((row, rowIndex) => (
              <div
                key={row.date}
                className={row.isToday ? 'heatmap-grid__row heatmap-grid__row--today' : 'heatmap-grid__row'}
                role="row"
              >
                <span className="heatmap-grid__row-label" role="rowheader">
                  <strong>{row.isToday ? '今天' : formatWeekdayLabel(row.date, locale)}</strong>
                  <span>{formatMonthDayLabel(row.date, locale)}</span>
                </span>
                {row.cells.map((cell, hourIndex) => {
                  const label = getCellLabel(cell, locale);
                  const isFocus = rowIndex === activeFocus.rowIndex && hourIndex === activeFocus.hourIndex;
                  const isNow = row.isToday && cell.hour === currentHour;
                  const className = isNow
                    ? `heatmap-grid__cell heatmap-level--${String(normalizeIntensityLevel(cell.intensityLevel))} heatmap-grid__cell--now`
                    : `heatmap-grid__cell heatmap-level--${String(normalizeIntensityLevel(cell.intensityLevel))}`;
                  return (
                    <div
                      key={cell.hour}
                      className={className}
                      role="gridcell"
                      tabIndex={isFocus ? 0 : -1}
                      data-row={rowIndex}
                      data-hour={hourIndex}
                      title={label}
                      aria-label={label}
                      aria-current={isNow ? 'date' : undefined}
                      onClick={() => { openCell(row, hourIndex); }}
                      onKeyDown={(event) => { onCellKeyDown(event, rowIndex, hourIndex); }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div className="heatmap-legend">
            <span className="heatmap-legend__title">活跃程度</span>
            {heatmapIntensityLabels.map((text, level) => (
              <span key={text} className="heatmap-legend__item">
                <span
                  className={`heatmap-legend__swatch heatmap-level--${String(level)}`}
                  aria-hidden="true"
                />
                {text}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
