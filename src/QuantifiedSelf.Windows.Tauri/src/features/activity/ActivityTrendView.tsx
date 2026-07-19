import {
  ArrowClockwiseIcon,
  ChartLineUpIcon,
  ClockCountdownIcon,
  InfoIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import type { ActivityWeeklyTrendResult } from '../../bridge/contracts';
import {
  formatDuration,
  formatMonthDayLabel,
  formatWeekdayLabel,
} from './activityFormatting';
import {
  getMaxActiveSeconds,
  getRelativeBarHeightPercent,
  type ActivityTrendViewState,
} from './activityModel';
import { formatLastUpdated } from '../dashboard/dashboardFormatting';

interface ActivityTrendViewProps {
  readonly state: ActivityTrendViewState;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly locale?: string;
}

export function ActivityTrendView({ state, refreshing, onRefresh, locale }: ActivityTrendViewProps) {
  const updatedAt = state.kind === 'ready' || state.kind === 'empty'
    ? state.updatedAt
    : 0;

  return (
    <div className="page activity-page page-enter">
      <header className="page-header dashboard-header">
        <div>
          <p className="eyebrow">7 天趋势</p>
          <h1 tabIndex={-1}>这一周，节奏怎么样</h1>
          <p>按本地自然日展示最近 7 天的有效使用时长，缺失的日期已按零补齐。</p>
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

      {state.kind === 'loading' && <ActivityTrendLoading />}
      {state.kind === 'empty' && <ActivityTrendEmpty onRefresh={onRefresh} refreshing={refreshing} />}
      {state.kind === 'error' && (
        <ActivityTrendError message={state.message} onRetry={onRefresh} refreshing={refreshing} />
      )}
      {state.kind === 'ready' && (
        <ActivityTrendReady trend={state.trend} locale={locale} />
      )}

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {refreshing
          ? '正在刷新 7 天趋势。'
          : updatedAt > 0
            ? `7 天趋势已更新，最后更新时间 ${formatLastUpdated(updatedAt, locale)}。`
            : ''}
      </p>
    </div>
  );
}

function ActivityTrendLoading() {
  return (
    <section className="dashboard-state" role="status" aria-live="polite" aria-busy="true">
      <ClockCountdownIcon className="spin" size={28} aria-hidden="true" />
      <div>
        <h2>正在读取 7 天趋势</h2>
        <p>正在通过本地 Bridge 汇总最近 7 天的有效使用时长。</p>
      </div>
      <div className="dashboard-skeleton" aria-hidden="true">
        <span /><span /><span /><span />
      </div>
    </section>
  );
}

function ActivityTrendEmpty({ onRefresh, refreshing }: { readonly onRefresh: () => void; readonly refreshing: boolean }) {
  return (
    <section className="dashboard-state dashboard-state--centered" aria-labelledby="activity-trend-empty-title">
      <InfoIcon size={30} aria-hidden="true" />
      <div>
        <h2 id="activity-trend-empty-title">最近 7 天还没有活动记录</h2>
        <p>启动 Agent 并积累几天数据后，这里会显示 7 天的有效使用趋势。</p>
      </div>
      <button className="button button--secondary" type="button" onClick={onRefresh} disabled={refreshing}>
        <ArrowClockwiseIcon size={17} aria-hidden="true" />
        再检查一次
      </button>
    </section>
  );
}

function ActivityTrendError({
  message,
  onRetry,
  refreshing,
}: {
  readonly message: string;
  readonly onRetry: () => void;
  readonly refreshing: boolean;
}) {
  return (
    <section className="dashboard-state dashboard-state--error" role="alert" aria-labelledby="activity-trend-error-title">
      <WarningCircleIcon size={30} aria-hidden="true" />
      <div>
        <h2 id="activity-trend-error-title">暂时无法读取 7 天趋势</h2>
        <p>{message}</p>
        <p className="dashboard-state__note">Agent 会保持原状态运行；重试只会重新读取趋势统计。</p>
      </div>
      <button className="button button--secondary" type="button" onClick={onRetry} disabled={refreshing}>
        <ArrowClockwiseIcon className={refreshing ? 'spin' : undefined} size={17} aria-hidden="true" />
        {refreshing ? '正在重试' : '重试'}
      </button>
    </section>
  );
}

function ActivityTrendReady({
  trend,
  locale,
}: {
  readonly trend: ActivityWeeklyTrendResult;
  readonly locale?: string;
}) {
  const maxActiveSeconds = getMaxActiveSeconds(trend.days.map((day) => day.activeSeconds));

  return (
    <div className="dashboard-content">
      <section className="dashboard-metrics" aria-label="7 天趋势摘要">
        <article className="metric-card metric-card--primary">
          <ChartLineUpIcon size={22} aria-hidden="true" />
          <div>
            <h2>日均有效使用时长</h2>
            <strong>{formatDuration(trend.averageActiveSeconds, locale)}</strong>
            <p>按最近 7 个本地自然日平均</p>
          </div>
        </article>
        <article className="metric-card">
          <ClockCountdownIcon size={22} aria-hidden="true" />
          <div className="metric-card__body">
            <h2>趋势对比</h2>
            <ul className="trend-comparisons">
              <li>{trend.comparisonToAverageText}</li>
              <li>{trend.comparisonToYesterdayText}</li>
              <li>{trend.weekToDateText}</li>
            </ul>
          </div>
        </article>
      </section>

      <section className="dashboard-module" aria-labelledby="trend-chart-title">
        <div className="dashboard-module__heading">
          <div className="dashboard-module__icon"><ChartLineUpIcon size={20} aria-hidden="true" /></div>
          <div><h2 id="trend-chart-title">最近 7 天</h2><p>柱高表示当天有效使用时长的相对占比</p></div>
        </div>
        <ol className="trend-chart" aria-label="最近 7 天有效使用趋势">
          {trend.days.map((day) => {
            const percent = getRelativeBarHeightPercent(day.activeSeconds, maxActiveSeconds);
            const dayLabel = day.isToday ? '今天' : formatWeekdayLabel(day.date, locale);
            const fullLabel = `${formatMonthDayLabel(day.date, locale)} ${dayLabel}，有效使用 ${formatDuration(day.activeSeconds, locale)}`;
            return (
              <li
                key={day.date}
                className={day.isToday ? 'trend-chart__item trend-chart__item--today' : 'trend-chart__item'}
                title={fullLabel}
                aria-current={day.isToday ? 'date' : undefined}
              >
                <span className="trend-chart__value" aria-hidden="true">{formatDuration(day.activeSeconds, locale)}</span>
                <span className="trend-chart__bar-wrap" aria-hidden="true">
                  <span className="trend-chart__bar" style={{ height: `${String(percent)}%` }} />
                </span>
                <span className="trend-chart__label" aria-hidden="true">
                  <strong>{dayLabel}</strong>
                  <span>{formatMonthDayLabel(day.date, locale)}</span>
                </span>
                <span className="sr-only">{fullLabel}</span>
              </li>
            );
          })}
        </ol>
        <p className="trend-chart__average">日均有效使用 {formatDuration(trend.averageActiveSeconds, locale)}</p>
      </section>
    </div>
  );
}
