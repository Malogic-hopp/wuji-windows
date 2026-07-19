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
import { formatWeekdayLabel } from './activityFormatting';
import {
  buildGrid,
  clampFocusPosition,
  getCellLabel,
  getDefaultFocusPosition,
  getTimelineHourPath,
  heatmapHourCount,
  isHourPeriodEnd,
  moveFocus,
  normalizeIntensityLevel,
  type ActivityHeatmapViewState,
  type HeatmapFocusKey,
  type HeatmapFocusPosition,
} from './heatmapModel';
import { formatLastUpdated } from '../dashboard/dashboardFormatting';
import './heatmap-view.css';

type Locale = string | readonly string[] | undefined;

function formatShortDate(date: string): string {
  return date.slice(5).replace('-', '/');
}

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
          <p>颜色越深代表该小时越活跃，点击格子可查看对应小时的时间线。</p>
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
      <div className="heatmap-skeleton" aria-hidden="true">
        {Array.from({ length: 7 * 24 }, (_, i) => (
          <span key={i} />
        ))}
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
  const grid = useMemo(() => buildGrid(heatmap), [heatmap]);
  const { dates, today, rows } = grid;
  const dateCount = dates.length;
  const gridRef = useRef<HTMLDivElement>(null);
  const [focusPosition, setFocusPosition] = useState<HeatmapFocusPosition>(() =>
    getDefaultFocusPosition(grid, currentHour));
  const activeFocus = clampFocusPosition(focusPosition, heatmapHourCount, dateCount);

  const focusCell = (next: HeatmapFocusPosition) => {
    setFocusPosition(next);
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-hour="${String(next.hourIndex)}"][data-date="${String(next.dateIndex)}"]`)
      ?.focus();
  };

  const openCell = (date: string, hour: number) => {
    void navigate(getTimelineHourPath(date, hour));
  };

  const onCellKeyDown = (event: KeyboardEvent<HTMLDivElement>, hourIndex: number, dateIndex: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openCell(dates[dateIndex], rows[hourIndex].hour);
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
        focusCell(moveFocus({ hourIndex, dateIndex }, key, heatmapHourCount, dateCount));
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
          <div className="heatmap-time-labels" aria-hidden="true">
            <span>凌晨</span>
            <span>上午</span>
            <span>下午</span>
            <span>晚上</span>
          </div>
          <div className="heatmap-main">
          <div className="heatmap-grid__cols" aria-hidden="true">
            {dates.map((date) => (
              <span
                key={date}
                className={date === today
                  ? 'heatmap-grid__col-label heatmap-grid__col-label--today'
                  : 'heatmap-grid__col-label'}
              >
                <span className="heatmap-grid__col-weekday">
                  {date === today ? '今天' : formatWeekdayLabel(date, locale)}
                </span>
                <span className="heatmap-grid__col-date">{formatShortDate(date)}</span>
              </span>
            ))}
          </div>
          <div
            className="heatmap-grid"
            role="grid"
            aria-label="最近 7 天每小时活跃热力图"
            ref={gridRef}
          >
            {rows.map((row, hourIndex) => {
              const rowClass = isHourPeriodEnd(row.hour)
                ? 'heatmap-grid__row heatmap-grid__row--divider'
                : 'heatmap-grid__row';
              return (
              <div
                key={row.hour}
                className={rowClass}
                role="row"
              >
                {row.cells.map((cell, dateIndex) => {
                  const label = getCellLabel(cell, locale);
                  const isFocus = hourIndex === activeFocus.hourIndex && dateIndex === activeFocus.dateIndex;
                  const isNow = dates[dateIndex] === today && cell.hour === currentHour;
                  const className = isNow
                    ? `heatmap-grid__cell heatmap-level--${String(normalizeIntensityLevel(cell.intensityLevel))} heatmap-grid__cell--now`
                    : `heatmap-grid__cell heatmap-level--${String(normalizeIntensityLevel(cell.intensityLevel))}`;
                  const tooltipClassName = [
                    'heatmap-grid__tooltip',
                    hourIndex === 0 ? 'heatmap-grid__tooltip--below' : '',
                    dateIndex === 0 ? 'heatmap-grid__tooltip--align-start' : '',
                    dateIndex === dateCount - 1 ? 'heatmap-grid__tooltip--align-end' : '',
                  ].filter(Boolean).join(' ');
                  return (
                    <div
                      key={cell.hour}
                      className={className}
                      role="gridcell"
                      tabIndex={isFocus ? 0 : -1}
                      data-hour={hourIndex}
                      data-date={dateIndex}
                      aria-label={label}
                      aria-current={isNow ? 'date' : undefined}
                      onClick={() => { openCell(dates[dateIndex], row.hour); }}
                      onKeyDown={(event) => { onCellKeyDown(event, hourIndex, dateIndex); }}
                    >
                      <span className={tooltipClassName} role="tooltip" aria-hidden="true">
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>
            );})}
          </div>
          </div>
        </div>
      </section>
    </div>
  );
}
