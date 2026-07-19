import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ActivityTimelineResult, ActivityTimelineSession } from '../../bridge/contracts';
import { TimelineView } from './TimelineView';

function localIso(year: number, month: number, day: number, hour: number, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

function session(overrides: Partial<ActivityTimelineSession>): ActivityTimelineSession {
  return {
    startedAtUtc: localIso(2026, 7, 19, 9, 0),
    endedAtUtc: localIso(2026, 7, 19, 10, 30),
    isOpen: false,
    appName: 'Visual Studio Code',
    totalSeconds: 5_400,
    activeSeconds: 4_800,
    idleSeconds: 600,
    unknownSeconds: 0,
    closeReason: 'paused',
    subSegments: [],
    ...overrides,
  };
}

const timeline: ActivityTimelineResult = {
  date: '2026-07-19',
  isToday: false,
  sessions: [
    session({}),
    session({
      startedAtUtc: localIso(2026, 7, 19, 14, 0),
      endedAtUtc: localIso(2026, 7, 19, 15, 0),
      isOpen: true,
      appName: 'Microsoft Edge',
      totalSeconds: 3_600,
      activeSeconds: 3_000,
      idleSeconds: 600,
      closeReason: 'open',
    }),
  ],
  gaps: [{
    startedAtUtc: localIso(2026, 7, 19, 10, 30),
    endedAtUtc: localIso(2026, 7, 19, 14, 0),
    durationSeconds: 12_600,
  }],
};

function renderView(overrides: Partial<Parameters<typeof TimelineView>[0]> = {}) {
  const props: Parameters<typeof TimelineView>[0] = {
    state: { kind: 'ready', timeline, updatedAt: Date.now() },
    refreshing: false,
    dateParam: '2026-07-19',
    todayParam: '2026-07-20',
    onSelectDate: vi.fn(),
    onRefresh: vi.fn(),
    locale: 'zh-CN',
    ...overrides,
  };
  render(<TimelineView {...props} />);
  return props;
}

describe('TimelineView 状态', () => {
  it('Loading 使用可读的忙碌状态', () => {
    renderView({ state: { kind: 'loading' } });

    const heading = screen.getByRole('heading', { name: '正在读取时间线' });
    expect(heading.closest('section')).toHaveAttribute('role', 'status');
    expect(heading.closest('section')).toHaveAttribute('aria-busy', 'true');
  });

  it('Empty 说明无记录并提供重试入口', () => {
    const onRefresh = vi.fn();
    renderView({ state: { kind: 'empty', updatedAt: Date.now() }, onRefresh });

    expect(screen.getByRole('heading', { name: '这一天还没有活动记录' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再检查一次' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('Error 使用 alert、显示安全消息并支持重试', () => {
    const onRefresh = vi.fn();
    renderView({ state: { kind: 'error', message: '无法连接本地服务，请稍后重试。' }, onRefresh });

    expect(screen.getByRole('alert')).toHaveTextContent('无法连接本地服务');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});

describe('TimelineView 时间线与会话列表', () => {
  it('轨道按本地时间定位会话与间隔片段，会话可聚焦并带中文标签', () => {
    const { container } = render(
      <TimelineView
        state={{ kind: 'ready', timeline, updatedAt: Date.now() }}
        refreshing={false}
        dateParam="2026-07-19"
        todayParam="2026-07-20"
        onSelectDate={vi.fn()}
        onRefresh={vi.fn()}
        locale="zh-CN"
      />,
    );

    const sessionSegments = container.querySelectorAll<HTMLElement>('.timeline-track__segment--session');
    expect(sessionSegments).toHaveLength(2);
    expect(sessionSegments[0].style.left).toBe('37.5%');
    expect(sessionSegments[0].style.width).toBe('6.25%');
    expect(sessionSegments[1]).toHaveClass('timeline-track__segment--open');

    const gapSegments = container.querySelectorAll('.timeline-track__segment--gap');
    expect(gapSegments).toHaveLength(1);

    const first = sessionSegments[0];
    expect(first).toHaveAttribute('tabindex', '0');
    expect(first.getAttribute('aria-label')).toContain('Visual Studio Code');
    expect(first.getAttribute('aria-label')).toContain('时长 1小时30分钟');
    expect(sessionSegments[1].getAttribute('aria-label')).toContain('进行中');
    first.focus();
    expect(first).toHaveFocus();
  });

  it('列表展示时间范围、时长、应用名、进行中徽章与克制的结束原因', () => {
    renderView();

    expect(screen.getAllByText('Visual Studio Code').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Microsoft Edge').length).toBeGreaterThan(0);
    expect(screen.getByText('09:00 – 10:30')).toBeInTheDocument();
    expect(screen.getByText('时长 1小时30分钟')).toBeInTheDocument();
    expect(screen.getByText('进行中')).toBeInTheDocument();
    expect(screen.getByText('已暂停')).toBeInTheDocument();
    expect(screen.getByText('暂停与空闲间隔')).toBeInTheDocument();
  });

  it('会话带子段时轨道按 active/idle 拆分渲染，子段不进 Tab 序且 tooltip 含时长', () => {
    const splitTimeline: ActivityTimelineResult = {
      ...timeline,
      sessions: [
        session({
          subSegments: [
            {
              startedAtUtc: localIso(2026, 7, 19, 9, 0),
              endedAtUtc: localIso(2026, 7, 19, 9, 30),
              isActive: true,
            },
            {
              startedAtUtc: localIso(2026, 7, 19, 9, 30),
              endedAtUtc: localIso(2026, 7, 19, 10, 0),
              isActive: false,
            },
            {
              startedAtUtc: localIso(2026, 7, 19, 10, 0),
              endedAtUtc: localIso(2026, 7, 19, 10, 30),
              isActive: true,
            },
          ],
        }),
      ],
      gaps: [],
    };
    const { container } = render(
      <TimelineView
        state={{ kind: 'ready', timeline: splitTimeline, updatedAt: Date.now() }}
        refreshing={false}
        dateParam="2026-07-19"
        todayParam="2026-07-20"
        onSelectDate={vi.fn()}
        onRefresh={vi.fn()}
        locale="zh-CN"
      />,
    );

    const sessionSegments = container.querySelectorAll<HTMLElement>('.timeline-track__segment--session');
    expect(sessionSegments).toHaveLength(2);
    // 子段仅作视觉呈现：不进 Tab 序、对读屏隐藏，完整信息在下方会话列表。
    for (const segment of sessionSegments) {
      expect(segment).not.toHaveAttribute('tabindex');
      expect(segment).toHaveAttribute('aria-hidden', 'true');
      expect(segment.title).toContain('活跃');
      expect(segment.title).toContain('时长 30分钟');
    }

    const idleSegments = container.querySelectorAll<HTMLElement>('.timeline-track__segment--gap');
    expect(idleSegments).toHaveLength(1);
    expect(idleSegments[0]).toHaveAttribute('aria-hidden', 'true');
    expect(idleSegments[0].title).toContain('Visual Studio Code 空闲');
    expect(idleSegments[0].title).toContain('时长 30分钟');
  });

  it('提供 hour 参数时渲染高亮带与定位说明', () => {    const { container, unmount } = render(
      <TimelineView
        state={{ kind: 'ready', timeline, updatedAt: Date.now() }}
        refreshing={false}
        dateParam="2026-07-19"
        todayParam="2026-07-20"
        highlightHour={14}
        onSelectDate={vi.fn()}
        onRefresh={vi.fn()}
        locale="zh-CN"
      />,
    );

    expect(screen.getByText('定位到 14时')).toBeInTheDocument();
    const highlight = container.querySelector<HTMLElement>('.timeline-track__highlight');
    expect(highlight?.style.left).toBe('58.333%');
    unmount();

    renderView();
    expect(screen.queryByText(/定位到/)).not.toBeInTheDocument();
  });
});

describe('TimelineView 日期切换', () => {
  it('前一天与后一天按本地自然日步进', () => {
    const onSelectDate = vi.fn();
    renderView({ onSelectDate });

    fireEvent.click(screen.getByRole('button', { name: '前一天' }));
    expect(onSelectDate).toHaveBeenCalledWith('2026-07-18');

    fireEvent.click(screen.getByRole('button', { name: '后一天' }));
    expect(onSelectDate).toHaveBeenCalledWith('2026-07-20');
  });

  it('查看历史日期时提供回到今天', () => {
    const onSelectDate = vi.fn();
    renderView({ onSelectDate });

    fireEvent.click(screen.getByRole('button', { name: '回到今天' }));
    expect(onSelectDate).toHaveBeenCalledWith(undefined);
  });

  it('查看今天时后一天禁用且隐藏回到今天', () => {
    renderView({ dateParam: '2026-07-19', todayParam: '2026-07-19' });

    expect(screen.getByRole('button', { name: '后一天' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '回到今天' })).not.toBeInTheDocument();
    expect(screen.getByText(/· 今天/)).toBeInTheDocument();
  });
});
