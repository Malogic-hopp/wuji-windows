import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ActivityDailyStatsResult, ActivityHourlyBucket } from '../../bridge/contracts';
import { ActivityTodayView } from './ActivityTodayView';

function hourlyBucket(hour: number, activeSeconds: number): ActivityHourlyBucket {
  return { hour, activeSeconds, idleSeconds: 0, unknownSeconds: 0 };
}

function dailyStats(overrides: Partial<ActivityDailyStatsResult>): ActivityDailyStatsResult {
  return {
    date: '2026-07-19',
    isToday: true,
    totalSeconds: 7_200,
    activeSeconds: 5_400,
    idleSeconds: 1_500,
    unknownSeconds: 300,
    sessionCount: 3,
    sampleCount: 120,
    hours: Array.from({ length: 24 }, (_, hour) => hourlyBucket(hour, hour === 14 ? 1_800 : 0)),
    ...overrides,
  };
}

function renderView(overrides: Partial<Parameters<typeof ActivityTodayView>[0]> = {}) {
  const props: Parameters<typeof ActivityTodayView>[0] = {
    state: { kind: 'ready', stats: dailyStats({}), updatedAt: Date.now() },
    refreshing: false,
    currentHour: 14,
    onRefresh: vi.fn(),
    locale: 'zh-CN',
    ...overrides,
  };
  const router = createMemoryRouter([
    { path: '/activity/today', element: <ActivityTodayView {...props} /> },
    { path: '/activity/timeline', element: <h1>时间线页面</h1> },
  ], { initialEntries: ['/activity/today'] });
  const utils = render(<RouterProvider router={router} />);
  return { props, router, ...utils };
}

describe('ActivityTodayView 小时柱联动', () => {
  it('今天的柱子渲染为按钮，点击跳转到对应小时的时间线', () => {
    const { router } = renderView();

    const bar = screen.getByRole('button', { name: '14时，有效使用 30分钟，查看该小时时间线' });
    expect(bar.tagName).toBe('BUTTON');
    fireEvent.click(bar);

    expect(router.state.location.pathname).toBe('/activity/timeline');
    expect(router.state.location.search).toBe('?date=2026-07-19&hour=14');
  });

  it('保留当前小时高亮与 tooltip，并补充联动提示', () => {
    renderView();

    const bar = screen.getByRole('button', { name: '14时，有效使用 30分钟，查看该小时时间线' });
    const item = bar.closest('li');
    expect(item).toHaveAttribute('aria-current', 'true');
    expect(item).toHaveAttribute('title', '14时，有效使用 30分钟，查看该小时时间线');
    expect(item).toHaveClass('hour-chart__item--current');
  });

  it('非今天数据不渲染联动按钮', () => {
    renderView({ state: { kind: 'ready', stats: dailyStats({ isToday: false }), updatedAt: Date.now() } });

    expect(screen.queryAllByRole('button', { name: /查看该小时时间线/ })).toHaveLength(0);
    const items = screen.getByRole('list', { name: '今日 24 小时有效使用分布' }).querySelectorAll('li');
    expect(items).toHaveLength(24);
    expect(items[14]).toHaveAttribute('title', '14时，有效使用 30分钟');
  });
});
