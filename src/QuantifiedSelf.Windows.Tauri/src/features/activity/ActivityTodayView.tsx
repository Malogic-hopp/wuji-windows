import {
  ArrowClockwiseIcon,
  ChartBarIcon,
  ClockCountdownIcon,
  InfoIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import type { ActivityDailyStatsResult } from '../../bridge/contracts';
import { formatCount, formatDuration, formatHourLabel } from './activityFormatting';
import {
  getMaxActiveSeconds,
  getRelativeBarHeightPercent,
  resolveCurrentHour,
  type ActivityTodayViewState,
} from './activityModel';
import { getTimelineHourPath } from './heatmapModel';
import { formatLastUpdated } from '../dashboard/dashboardFormatting';

interface ActivityTodayViewProps {
  readonly state: ActivityTodayViewState;
  readonly refreshing: boolean;
  readonly currentHour: number;
  readonly onRefresh: () => void;
  readonly locale?: string;
}

export function ActivityTodayView({ state, refreshing, currentHour, onRefresh, locale }: ActivityTodayViewProps) {
  const updatedAt = state.kind === 'ready' || state.kind === 'empty'
    ? state.updatedAt
    : 0;

  return (
    <div className="page activity-page page-enter">
      <header className="page-header dashboard-header">
        <div>
          <p className="eyebrow">今日 24 小时</p>
          <h1 tabIndex={-1}>今天的时间，按小时看</h1>
          <p>按本地自然日汇总每小时的有效使用时长，当前小时会随采样持续更新。</p>
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

      {state.kind === 'loading' && <ActivityTodayLoading />}
      {state.kind === 'empty' && <ActivityTodayEmpty onRefresh={onRefresh} refreshing={refreshing} />}
      {state.kind === 'error' && (
        <ActivityTodayError message={state.message} onRetry={onRefresh} refreshing={refreshing} />
      )}
      {state.kind === 'ready' && (
        <ActivityTodayReady stats={state.stats} currentHour={currentHour} locale={locale} />
      )}

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {refreshing
          ? '正在刷新今日 24 小时分布。'
          : updatedAt > 0
            ? `今日 24 小时分布已更新，最后更新时间 ${formatLastUpdated(updatedAt, locale)}。`
            : ''}
      </p>
    </div>
  );
}

function ActivityTodayLoading() {
  return (
    <section className="dashboard-state" role="status" aria-live="polite" aria-busy="true">
      <ClockCountdownIcon className="spin" size={28} aria-hidden="true" />
      <div>
        <h2>正在读取今日 24 小时分布</h2>
        <p>正在通过本地 Bridge 汇总每小时的有效使用时长。</p>
      </div>
      <div className="dashboard-skeleton" aria-hidden="true">
        <span /><span /><span /><span />
      </div>
    </section>
  );
}

function ActivityTodayEmpty({ onRefresh, refreshing }: { readonly onRefresh: () => void; readonly refreshing: boolean }) {
  return (
    <section className="dashboard-state dashboard-state--centered" aria-labelledby="activity-today-empty-title">
      <InfoIcon size={30} aria-hidden="true" />
      <div>
        <h2 id="activity-today-empty-title">今天还没有采样记录</h2>
        <p>启动 Agent 并使用一段时间后，这里会显示今天 24 小时的有效使用分布。</p>
      </div>
      <button className="button button--secondary" type="button" onClick={onRefresh} disabled={refreshing}>
        <ArrowClockwiseIcon size={17} aria-hidden="true" />
        再检查一次
      </button>
    </section>
  );
}

function ActivityTodayError({
  message,
  onRetry,
  refreshing,
}: {
  readonly message: string;
  readonly onRetry: () => void;
  readonly refreshing: boolean;
}) {
  return (
    <section className="dashboard-state dashboard-state--error" role="alert" aria-labelledby="activity-today-error-title">
      <WarningCircleIcon size={30} aria-hidden="true" />
      <div>
        <h2 id="activity-today-error-title">暂时无法读取今日 24 小时分布</h2>
        <p>{message}</p>
        <p className="dashboard-state__note">Agent 会保持原状态运行；重试只会重新读取今日统计。</p>
      </div>
      <button className="button button--secondary" type="button" onClick={onRetry} disabled={refreshing}>
        <ArrowClockwiseIcon className={refreshing ? 'spin' : undefined} size={17} aria-hidden="true" />
        {refreshing ? '正在重试' : '重试'}
      </button>
    </section>
  );
}

function ActivityTodayReady({
  stats,
  currentHour,
  locale,
}: {
  readonly stats: ActivityDailyStatsResult;
  readonly currentHour: number;
  readonly locale?: string;
}) {
  const navigate = useNavigate();
  const highlightedHour = resolveCurrentHour(stats.isToday, currentHour);
  const maxActiveSeconds = getMaxActiveSeconds(stats.hours.map((bucket) => bucket.activeSeconds));

  return (
    <div className="dashboard-content">
      <section className="dashboard-metrics" aria-label="今日活动摘要">
        <article className="metric-card metric-card--primary">
          <ClockCountdownIcon size={22} aria-hidden="true" />
          <div>
            <h2>今日有效使用时长</h2>
            <strong>{formatDuration(stats.activeSeconds, locale)}</strong>
            <p>采样覆盖 {formatDuration(stats.totalSeconds, locale)}</p>
          </div>
        </article>
        <article className="metric-card">
          <ChartBarIcon size={22} aria-hidden="true" />
          <div className="metric-card__body">
            <h2>会话 / 采样摘要</h2>
            <dl className="summary-list">
              <div><dt>会话数</dt><dd>{formatCount(stats.sessionCount, locale)} 个</dd></div>
              <div><dt>采样数</dt><dd>{formatCount(stats.sampleCount, locale)} 条</dd></div>
              <div><dt>空闲时间</dt><dd>{formatDuration(stats.idleSeconds, locale)}</dd></div>
              <div><dt>未分类</dt><dd>{formatDuration(stats.unknownSeconds, locale)}</dd></div>
            </dl>
          </div>
        </article>
      </section>

      <section className="dashboard-module" aria-labelledby="hour-chart-title">
        <div className="dashboard-module__heading">
          <div className="dashboard-module__icon"><ChartBarIcon size={20} aria-hidden="true" /></div>
          <div><h2 id="hour-chart-title">24 小时分布</h2><p>柱高表示该小时有效使用时长的相对占比{stats.isToday ? '，选择柱子可查看对应小时的时间线' : ''}</p></div>
        </div>
        <ol className="hour-chart" aria-label="今日 24 小时有效使用分布">
          {stats.hours.map((bucket) => {
            const percent = getRelativeBarHeightPercent(bucket.activeSeconds, maxActiveSeconds);
            const isCurrent = bucket.hour === highlightedHour;
            const label = `${formatHourLabel(bucket.hour)}，有效使用 ${formatDuration(bucket.activeSeconds, locale)}`;
            const content = (
              <>
                <span className="hour-chart__bar-wrap" aria-hidden="true">
                  <span className="hour-chart__bar" style={{ height: `${String(percent)}%` }} />
                </span>
                <span className="hour-chart__label" aria-hidden="true">{formatHourLabel(bucket.hour)}</span>
                <span className="sr-only">{stats.isToday ? `${label}，查看该小时时间线` : label}</span>
              </>
            );
            return (
              <li
                key={bucket.hour}
                className={isCurrent ? 'hour-chart__item hour-chart__item--current' : 'hour-chart__item'}
                title={stats.isToday ? `${label}，查看该小时时间线` : label}
                aria-current={isCurrent ? 'true' : undefined}
              >
                {stats.isToday ? (
                  <button
                    type="button"
                    className="hour-chart__item-button"
                    onClick={() => { void navigate(getTimelineHourPath(stats.date, bucket.hour)); }}
                  >
                    {content}
                  </button>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
