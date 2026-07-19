import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  activityDailyStatsQueryKey,
  activityHeatmapQueryKey,
  activityOverviewQueryKey,
  activityTimelineQueryKey,
  activityWeeklyTrendQueryKey,
  agentStatusQueryKey,
  refreshQueriesAfterAgentCommand,
  refreshQueriesAfterBridgeReady,
  refreshQueriesAfterSettingsSaved,
  settingsQueryKey,
} from './queryInvalidation';

describe('refreshQueriesAfterBridgeReady', () => {
  it('Bridge ready 后自动使 Dashboard、activity 页面与 Settings 缓存失效', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(activityOverviewQueryKey, { stale: 'old bridge generation' });
    queryClient.setQueryData(activityDailyStatsQueryKey('2026-07-19'), { stale: 'old bridge generation' });
    queryClient.setQueryData(activityWeeklyTrendQueryKey, { stale: 'old bridge generation' });
    queryClient.setQueryData(activityTimelineQueryKey('2026-07-19'), { stale: 'old bridge generation' });
    queryClient.setQueryData(activityHeatmapQueryKey, { stale: 'old bridge generation' });
    queryClient.setQueryData(settingsQueryKey, { stale: 'old bridge generation' });

    await refreshQueriesAfterBridgeReady(queryClient);

    expect(queryClient.getQueryState(activityOverviewQueryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(activityDailyStatsQueryKey('2026-07-19'))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(activityWeeklyTrendQueryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(activityTimelineQueryKey('2026-07-19'))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(activityHeatmapQueryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(settingsQueryKey)?.isInvalidated).toBe(true);
  });
});

describe('refreshQueriesAfterAgentCommand', () => {
  it('Agent 命令成功后同时失效状态与 activity 查询', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(agentStatusQueryKey, { stale: 'agent' });
    queryClient.setQueryData(activityOverviewQueryKey, { stale: 'dashboard' });
    queryClient.setQueryData(activityDailyStatsQueryKey('2026-07-19'), { stale: 'today' });
    queryClient.setQueryData(activityWeeklyTrendQueryKey, { stale: 'trend' });

    await refreshQueriesAfterAgentCommand(queryClient);

    expect(queryClient.getQueryState(agentStatusQueryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(activityOverviewQueryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(activityDailyStatsQueryKey('2026-07-19'))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(activityWeeklyTrendQueryKey)?.isInvalidated).toBe(true);
  });
});

describe('refreshQueriesAfterSettingsSaved', () => {
  it('保存设置后失效 Settings、Agent 状态与 Dashboard 查询', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(settingsQueryKey, { stale: 'settings' });
    queryClient.setQueryData(['agent', 'status'], { stale: 'agent' });
    queryClient.setQueryData(activityOverviewQueryKey, { stale: 'dashboard' });

    await refreshQueriesAfterSettingsSaved(queryClient);

    expect(queryClient.getQueryState(settingsQueryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['agent', 'status'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(activityOverviewQueryKey)?.isInvalidated).toBe(true);
  });
});
