import { fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ActivityHeatmapCell, ActivityHeatmapResult } from '../../bridge/contracts';
import { HeatmapView } from './HeatmapView';

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

function buildHeatmap(): ActivityHeatmapResult {
  const cells = dates.flatMap((date) =>
    Array.from({ length: 24 }, (_, hour) => {
      if (date === '2026-07-19' && hour === 14) {
        return cell(date, hour, { activeSamples: 120, idleSamples: 30, activeRatioPercent: 62, intensityLevel: 3 });
      }
      if (date === '2026-07-18' && hour === 9) {
        return cell(date, hour, { activeSamples: 40, activeRatioPercent: 25, intensityLevel: 1 });
      }
      return cell(date, hour);
    }));
  return { today: '2026-07-19', cells };
}

function renderView(overrides: Partial<Parameters<typeof HeatmapView>[0]> = {}) {
  const props: Parameters<typeof HeatmapView>[0] = {
    state: { kind: 'ready', heatmap: buildHeatmap(), updatedAt: Date.now() },
    refreshing: false,
    currentHour: 14,
    onRefresh: vi.fn(),
    locale: 'zh-CN',
    ...overrides,
  };
  const router = createMemoryRouter([
    { path: '/activity/heatmap', element: <HeatmapView {...props} /> },
    { path: '/activity/timeline', element: <h1>时间线页面</h1> },
  ], { initialEntries: ['/activity/heatmap'] });
  const utils = render(<RouterProvider router={router} />);
  return { props, router, ...utils };
}

function getTabbableCell(): HTMLElement {
  const tabbable = screen.getAllByRole('gridcell').find((el) => el.getAttribute('tabindex') === '0');
  if (!tabbable) throw new Error('没有找到可聚焦的格子');
  return tabbable;
}

function findCell(labelPart: string): HTMLElement {
  const found = screen.getAllByRole('gridcell')
    .find((el) => el.getAttribute('aria-label')?.includes(labelPart) ?? false);
  if (!found) throw new Error(`没有找到格子：${labelPart}`);
  return found;
}

describe('HeatmapView 状态', () => {
  it('Loading 使用可读的忙碌状态', () => {
    renderView({ state: { kind: 'loading' } });
    const heading = screen.getByRole('heading', { name: '正在读取 7 天热力图' });
    expect(heading.closest('section')).toHaveAttribute('role', 'status');
    expect(heading.closest('section')).toHaveAttribute('aria-busy', 'true');
  });

  it('Empty 说明无活跃采样并提供重试入口', () => {
    const onRefresh = vi.fn();
    renderView({ state: { kind: 'empty', updatedAt: Date.now() }, onRefresh });
    expect(screen.getByRole('heading', { name: '最近 7 天还没有活跃采样' })).toBeInTheDocument();
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

describe('HeatmapView 网格结构', () => {
  it('渲染 24 行 × 7 列、时段标签与今天标签', () => {
    renderView();

    const grid = screen.getByRole('grid', { name: '最近 7 天每小时活跃热力图' });
    expect(within(grid).getAllByRole('row')).toHaveLength(24);
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(168);
    // Time labels shown in the sidebar
    expect(screen.getByText('凌晨')).toBeInTheDocument();
    expect(screen.getByText('上午')).toBeInTheDocument();
    expect(screen.getByText('下午')).toBeInTheDocument();
    expect(screen.getByText('晚上')).toBeInTheDocument();
    // Column header shows 今天 for today's date
    expect(screen.getByText('今天')).toBeInTheDocument();
  });

  it('格子使用服务端强度等级类名与中文标签', () => {
    renderView();

    const active = findCell('7月19日 14时');
    expect(active).toHaveClass('heatmap-grid__cell', 'heatmap-level--3');
    expect(active.getAttribute('aria-label')).toBe('7月19日 14时，活跃占比 62%，活跃采样 120 条，活跃程度 高');

    const quiet = findCell('7月15日 9时');
    expect(quiet).toHaveClass('heatmap-level--0');
    expect(quiet.getAttribute('aria-label')).toBe('7月15日 9时，无采样记录');
  });

  it('roving tabindex：今天当前小时可聚焦并带 aria-current', () => {
    renderView();

    const tabbable = getTabbableCell();
    expect(tabbable.getAttribute('aria-label')).toContain('7月19日 14时');
    expect(tabbable).toHaveAttribute('aria-current', 'date');
    expect(tabbable).toHaveClass('heatmap-grid__cell--now');
    expect(screen.getAllByRole('gridcell').filter((el) => el.getAttribute('tabindex') === '0')).toHaveLength(1);
  });
});

describe('HeatmapView 键盘与跳转', () => {
  it('方向键移动：↑↓ 改小时，←→ 改日期', () => {
    renderView();

    const start = getTabbableCell();
    fireEvent.keyDown(start, { key: 'ArrowUp' });
    let active = document.activeElement;
    expect(active?.getAttribute('aria-label')).toContain('7月19日 13时');
    expect(active).toHaveAttribute('tabindex', '0');
    expect(start).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(active as HTMLElement, { key: 'ArrowLeft' });
    active = document.activeElement;
    expect(active?.getAttribute('aria-label')).toContain('7月18日 13时');

    fireEvent.keyDown(active as HTMLElement, { key: 'Home' });
    active = document.activeElement;
    expect(active?.getAttribute('aria-label')).toContain('7月13日 13时');

    fireEvent.keyDown(active as HTMLElement, { key: 'End' });
    active = document.activeElement;
    expect(active?.getAttribute('aria-label')).toContain('7月19日 13时');

    fireEvent.keyDown(active as HTMLElement, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    active = document.activeElement;
    expect(active?.getAttribute('aria-label')).toContain('7月19日 15时');
  });

  it('Enter 跳转到时间线', () => {
    const { router } = renderView();
    fireEvent.keyDown(getTabbableCell(), { key: 'Enter' });
    expect(router.state.location.pathname).toBe('/activity/timeline');
    expect(router.state.location.search).toBe('?date=2026-07-19&hour=14');
  });

  it('空格跳转到时间线', () => {
    const { router } = renderView();
    fireEvent.keyDown(getTabbableCell(), { key: ' ' });
    expect(router.state.location.pathname).toBe('/activity/timeline');
    expect(router.state.location.search).toBe('?date=2026-07-19&hour=14');
  });

  it('鼠标点击跳转到时间线', () => {
    const { router } = renderView();
    fireEvent.click(findCell('7月15日 9时'));
    expect(router.state.location.pathname).toBe('/activity/timeline');
    expect(router.state.location.search).toBe('?date=2026-07-15&hour=9');
  });

  it('边缘格子的 tooltip 带防溢出修饰类', () => {
    renderView();

    // 最后一列（今天）：右对齐
    const rightmost = findCell('7月19日 14时');
    expect(rightmost.querySelector('[role="tooltip"]'))
      .toHaveClass('heatmap-grid__tooltip--align-end');

    // 第一行 + 第一列：向下弹出 + 左对齐
    const topLeft = findCell('7月13日 0时');
    expect(topLeft.querySelector('[role="tooltip"]'))
      .toHaveClass('heatmap-grid__tooltip--below', 'heatmap-grid__tooltip--align-start');
  });
});
