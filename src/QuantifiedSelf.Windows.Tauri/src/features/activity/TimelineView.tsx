import { useEffect, useRef } from 'react';
import {
  ArrowClockwiseIcon,
  CalendarDotsIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ClockCountdownIcon,
  InfoIcon,
  LineSegmentsIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import type { ActivityTimelineResult } from '../../bridge/contracts';
import {
  formatDuration,
  formatHourLabel,
  formatMonthDayLabel,
  formatSessionTimeRange,
  formatWeekdayLabel,
} from './activityFormatting';
import {
  buildTrackSegments,
  getCloseReasonLabel,
  getHourHighlightGeometry,
  getNowPercent,
  isDateParamAtOrAfterToday,
  shiftDateParam,
  timelineScaleHours,
  type ActivityTimelineViewState,
  type TimelineTrackSegmentWithGeometry,
} from './timelineModel';
import { formatLastUpdated } from '../dashboard/dashboardFormatting';

type Locale = string | readonly string[] | undefined;

/** 超过 2 小时的间隔按长间隔渲染（平涂 + 中央文字），短间隔保留斜纹。 */
const longGapThresholdSeconds = 2 * 60 * 60;

interface TimelineViewProps {
  readonly state: ActivityTimelineViewState;
  readonly refreshing: boolean;
  readonly dateParam: string;
  readonly todayParam: string;
  readonly highlightHour?: number;
  readonly onSelectDate: (dateParam: string | undefined) => void;
  readonly onRefresh: () => void;
  readonly locale?: string;
}

export function TimelineView({
  state,
  refreshing,
  dateParam,
  todayParam,
  highlightHour,
  onSelectDate,
  onRefresh,
  locale,
}: TimelineViewProps) {
  const updatedAt = state.kind === 'ready' || state.kind === 'empty'
    ? state.updatedAt
    : 0;
  const isToday = dateParam === todayParam;
  const canGoForward = !isDateParamAtOrAfterToday(dateParam, todayParam);
  const dateLabel = `${formatMonthDayLabel(dateParam, locale)} ${formatWeekdayLabel(dateParam, locale)}`;

  return (
    <div className="page activity-page page-enter">
      <header className="page-header dashboard-header">
        <div>
          <p className="eyebrow">时间线</p>
          <h1 tabIndex={-1}>这一天的时间，落在哪些应用上</h1>
          <p>按本地时间展示{isToday ? `今天（${dateLabel}）` : dateLabel}每个应用会话的起止与时长，以及会话之间的暂停与空闲间隔。</p>
        </div>
        <div className="timeline-controls">
          <div className="timeline-date-nav" role="group" aria-label="切换查看日期">
            <button
              className="button button--secondary"
              type="button"
              onClick={() => { onSelectDate(shiftDateParam(dateParam, -1)); }}
            >
              <CaretLeftIcon size={16} aria-hidden="true" />
              前一天
            </button>
            <span className="timeline-date-nav__current" aria-live="polite">
              {dateLabel}{isToday ? ' · 今天' : ''}
            </span>
            <button
              className="button button--secondary"
              type="button"
              disabled={!canGoForward}
              onClick={() => { onSelectDate(shiftDateParam(dateParam, 1)); }}
            >
              后一天
              <CaretRightIcon size={16} aria-hidden="true" />
            </button>
            {!isToday && (
              <button
                className="button button--secondary"
                type="button"
                onClick={() => { onSelectDate(undefined); }}
              >
                <CalendarDotsIcon size={16} aria-hidden="true" />
                回到今天
              </button>
            )}
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
        </div>
      </header>

      {state.kind === 'loading' && <TimelineLoading />}
      {state.kind === 'empty' && <TimelineEmpty onRefresh={onRefresh} refreshing={refreshing} />}
      {state.kind === 'error' && (
        <TimelineError message={state.message} onRetry={onRefresh} refreshing={refreshing} />
      )}
      {state.kind === 'ready' && (
        <TimelineReady
          timeline={state.timeline}
          dateLabel={dateLabel}
          highlightHour={highlightHour}
          locale={locale}
        />
      )}

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {refreshing
          ? '正在刷新时间线。'
          : updatedAt > 0
            ? `时间线已更新，最后更新时间 ${formatLastUpdated(updatedAt, locale)}。`
            : ''}
      </p>
    </div>
  );
}

function TimelineLoading() {
  return (
    <section className="dashboard-state" role="status" aria-live="polite" aria-busy="true">
      <ClockCountdownIcon className="spin" size={28} aria-hidden="true" />
      <div>
        <h2>正在读取时间线</h2>
        <p>正在通过本地 Bridge 汇总这一天的会话与间隔。</p>
      </div>
      <div className="dashboard-skeleton" aria-hidden="true">
        <span /><span /><span /><span />
      </div>
    </section>
  );
}

function TimelineEmpty({
  onRefresh,
  refreshing,
}: {
  readonly onRefresh: () => void;
  readonly refreshing: boolean;
}) {
  return (
    <section className="dashboard-state dashboard-state--centered" aria-labelledby="timeline-empty-title">
      <InfoIcon size={30} aria-hidden="true" />
      <div>
        <h2 id="timeline-empty-title">这一天还没有活动记录</h2>
        <p>启动 Agent 并使用一段时间后，这里会显示当天每个应用会话的起止与间隔。</p>
      </div>
      <button className="button button--secondary" type="button" onClick={onRefresh} disabled={refreshing}>
        <ArrowClockwiseIcon size={17} aria-hidden="true" />
        再检查一次
      </button>
    </section>
  );
}

function TimelineError({
  message,
  onRetry,
  refreshing,
}: {
  readonly message: string;
  readonly onRetry: () => void;
  readonly refreshing: boolean;
}) {
  return (
    <section className="dashboard-state dashboard-state--error" role="alert" aria-labelledby="timeline-error-title">
      <WarningCircleIcon size={30} aria-hidden="true" />
      <div>
        <h2 id="timeline-error-title">暂时无法读取时间线</h2>
        <p>{message}</p>
        <p className="dashboard-state__note">Agent 会保持原状态运行；重试只会重新读取时间线数据。</p>
      </div>
      <button className="button button--secondary" type="button" onClick={onRetry} disabled={refreshing}>
        <ArrowClockwiseIcon className={refreshing ? 'spin' : undefined} size={17} aria-hidden="true" />
        {refreshing ? '正在重试' : '重试'}
      </button>
    </section>
  );
}

function TimelineReady({
  timeline,
  dateLabel,
  highlightHour,
  locale,
}: {
  readonly timeline: ActivityTimelineResult;
  readonly dateLabel: string;
  readonly highlightHour?: number;
  readonly locale?: string;
}) {
  const segments = buildTrackSegments(timeline);
  const highlight = highlightHour === undefined ? undefined : getHourHighlightGeometry(highlightHour);
  const highlightRef = useRef<HTMLLIElement>(null);
  const nowPercent = getNowPercent(timeline.isToday);
  // rawSessionCount 为可选字段：旧 Bridge 不下发时回退为当前段数（此时不会显示合并提示）
  const rawSessionCount = timeline.rawSessionCount ?? timeline.sessions.length;

  useEffect(() => {
    if (highlightHour === undefined) return;
    const node = highlightRef.current;
    if (node && 'scrollIntoView' in node) {
      node.scrollIntoView({ block: 'center' });
    }
  }, [highlightHour]);

  return (
    <div className="dashboard-content">
      <section className="dashboard-module" aria-labelledby="timeline-track-title">
        <div className="dashboard-module__heading">
          <div className="dashboard-module__icon"><LineSegmentsIcon size={20} aria-hidden="true" /></div>
          <div><h2 id="timeline-track-title">24 小时时间线</h2><p>色块表示会话，斜纹表示暂停与空闲间隔</p></div>
        </div>
        <div className="timeline-track-wrap">
          {highlight !== undefined && highlightHour !== undefined && (
            <p className="timeline-highlight-note">定位到 {formatHourLabel(highlightHour)}</p>
          )}
          <ul className="timeline-track" aria-label={`${dateLabel} 24 小时时间线`}>
            <li className="timeline-track__grid" aria-hidden="true" />
            {highlight !== undefined && (
              <li
                ref={highlightRef}
                className="timeline-track__highlight"
                style={{ left: `${String(highlight.leftPercent)}%`, width: `${String(highlight.widthPercent)}%` }}
                aria-hidden="true"
              />
            )}
            {segments.map((segment) => <TimelineSegment key={segment.key} segment={segment} locale={locale} />)}
            {nowPercent !== undefined && (
              <li
                className="timeline-track__future"
                style={{ left: `${String(nowPercent)}%`, width: `${(100 - nowPercent).toFixed(3)}%` }}
                aria-hidden="true"
              />
            )}
            {nowPercent !== undefined && (
              <li
                className="timeline-track__now"
                style={{ left: `${String(nowPercent)}%` }}
                aria-hidden="true"
              />
            )}
          </ul>
          <div className="timeline-track__scale" aria-hidden="true">
            {timelineScaleHours.map((hour) => (
              <span key={hour} style={{ left: `${String((hour / 24) * 100)}%` }}>{formatHourLabel(hour)}</span>
            ))}
            {nowPercent !== undefined && (
              <span className="timeline-track__scale-now" style={{ left: `${String(nowPercent)}%` }}>现在</span>
            )}
          </div>
          <div className="timeline-legend">
            <span className="timeline-legend__item">
              <span className="timeline-legend__swatch timeline-legend__swatch--session" aria-hidden="true" />
              会话
            </span>
            <span className="timeline-legend__item">
              <span className="timeline-legend__swatch timeline-legend__swatch--gap" aria-hidden="true" />
              暂停与空闲间隔
            </span>
          </div>
        </div>
      </section>

      <section className="dashboard-module" aria-labelledby="timeline-list-title">
        <div className="dashboard-module__heading">
          <div className="dashboard-module__icon"><ClockCountdownIcon size={20} aria-hidden="true" /></div>
          <div>
            <h2 id="timeline-list-title">当天会话</h2>
            <p>
              按开始时间倒序，共 {timeline.sessions.length} 段使用
              {rawSessionCount > timeline.sessions.length ? '（相邻碎片已合并）' : ''}
            </p>
          </div>
        </div>
        {timeline.sessions.length === 0 ? (
          <p className="module-empty">这一天只有间隔，没有会话记录。</p>
        ) : (
          <ol className="activity-list activity-list--timeline">
            {/* 服务端按开始时间升序下发；列表倒序展示，最新会话在最前 */}
            {[...timeline.sessions].reverse().map((session) => {
              const closeLabel = session.isOpen ? undefined : getCloseReasonLabel(session.closeReason);
              const detailParts = [`有效使用 ${formatDuration(session.activeSeconds, locale)}`];
              if (session.idleSeconds > 0) detailParts.push(`空闲 ${formatDuration(session.idleSeconds, locale)}`);
              if (session.unknownSeconds > 0) detailParts.push(`未分类 ${formatDuration(session.unknownSeconds, locale)}`);
              return (
                <li key={`${session.startedAtUtc}-${session.appName}`}>
                  <div className="activity-list__main timeline-session__time">
                    <strong>{formatSessionTimeRange(session.startedAtUtc, session.endedAtUtc, locale)}</strong>
                    <span>时长 {formatDuration(session.totalSeconds, locale)}</span>
                  </div>
                  <div className="activity-list__main">
                    <strong>{session.appName}</strong>
                    <span>{detailParts.join(' · ')}</span>
                  </div>
                  {session.isOpen ? (
                    <span className="timeline-badge">进行中</span>
                  ) : closeLabel === undefined ? null : (
                    <span className="timeline-session__note">{closeLabel}</span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

function TimelineSegment({
  segment,
  locale,
}: {
  readonly segment: TimelineTrackSegmentWithGeometry;
  readonly locale?: Locale;
}) {
  const style = {
    left: `${String(segment.leftPercent)}%`,
    width: `${String(segment.widthPercent)}%`,
  };

  if (segment.kind === 'gap') {
    const { gap } = segment;
    const range = formatSessionTimeRange(gap.startedAtUtc, gap.endedAtUtc, locale);
    // 超过 2 小时的长间隔：平静平涂 + 中央时长文字，短间隔保留斜纹
    const isLongGap = gap.durationSeconds > longGapThresholdSeconds;
    const label = `暂停与空闲间隔，${range}，时长 ${formatDuration(gap.durationSeconds, locale)}`;
    // 长间隔是有意义的信息（当天最长的未使用时段），可聚焦并对读屏可见；
    // 短间隔仅作视觉纹理，保持 aria-hidden。
    if (isLongGap) {
      return (
        <li
          className="timeline-track__segment timeline-track__segment--gap timeline-track__segment--gap-long"
          style={style}
          title={label}
          tabIndex={0}
          aria-label={label}
        >
          <span className="timeline-track__gap-label" aria-hidden="true">
            无记录 {formatDuration(gap.durationSeconds, locale)}
          </span>
        </li>
      );
    }
    return (
      <li
        className="timeline-track__segment timeline-track__segment--gap"
        style={style}
        title={label}
        aria-hidden="true"
      />
    );
  }

  if (segment.kind === 'idleSubSegment') {
    const { session, subSegment } = segment;
    const range = formatSessionTimeRange(subSegment.startedAtUtc, subSegment.endedAtUtc, locale);
    const blockSeconds = Math.round(
      (new Date(subSegment.endedAtUtc).getTime() - new Date(subSegment.startedAtUtc).getTime()) / 1000,
    );
    return (
      <li
        className="timeline-track__segment timeline-track__segment--gap"
        style={style}
        title={`${session.appName} 空闲，${range}，时长 ${formatDuration(blockSeconds, locale)}`}
        aria-hidden="true"
      />
    );
  }

  // kind === 'session' or kind === 'activeSubSegment'
  const { session } = segment;
  const subSegment = segment.kind === 'activeSubSegment' ? segment.subSegment : undefined;

  if (subSegment !== undefined) {
    // 子段拆分后轨道仅作视觉呈现（完整信息见下方会话列表），子段不进 Tab 序，
    // 避免一个长会话产生几十个停留点；tooltip 保留应用名、时间范围与时长。
    const range = formatSessionTimeRange(subSegment.startedAtUtc, subSegment.endedAtUtc, locale);
    const blockSeconds = Math.round(
      (new Date(subSegment.endedAtUtc).getTime() - new Date(subSegment.startedAtUtc).getTime()) / 1000,
    );
    const className = session.isOpen
      ? 'timeline-track__segment timeline-track__segment--session timeline-track__segment--open'
      : 'timeline-track__segment timeline-track__segment--session';
    return (
      <li
        className={className}
        style={style}
        title={`${session.appName} 活跃，${range}，时长 ${formatDuration(blockSeconds, locale)}`}
        aria-hidden="true"
      />
    );
  }

  const range = formatSessionTimeRange(session.startedAtUtc, session.endedAtUtc, locale);
  const label = `${session.appName}，${range}，时长 ${formatDuration(session.totalSeconds, locale)}${session.isOpen ? '，进行中' : ''}`;
  const className = session.isOpen
    ? 'timeline-track__segment timeline-track__segment--session timeline-track__segment--open'
    : 'timeline-track__segment timeline-track__segment--session';
  return (
    <li
      className={className}
      style={style}
      tabIndex={0}
      title={label}
      aria-label={label}
    />
  );
}
