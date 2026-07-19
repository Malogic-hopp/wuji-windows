import type { QueryClient } from '@tanstack/react-query';

export const initializeQueryKey = ['app', 'initialize'] as const;
export const agentStatusQueryKey = ['agent', 'status'] as const;
export const activityQueryKey = ['activity'] as const;
export const activityOverviewQueryKey = ['activity', 'overview'] as const;
export const activityDailyStatsQueryKey = (date: string) => ['activity', 'daily-stats', date] as const;
export const activityWeeklyTrendQueryKey = ['activity', 'weekly-trend'] as const;
export const activityTimelineQueryKey = (date: string) => ['activity', 'timeline', date] as const;
export const activityHeatmapQueryKey = ['activity', 'heatmap'] as const;
export const settingsQueryKey = ['settings', 'current'] as const;

export async function refreshQueriesAfterBridgeReady(queryClient: QueryClient) {
  await Promise.all([
    queryClient.resetQueries({ queryKey: initializeQueryKey }),
    queryClient.resetQueries({ queryKey: agentStatusQueryKey }),
    queryClient.invalidateQueries({ queryKey: activityQueryKey }),
    queryClient.invalidateQueries({ queryKey: settingsQueryKey }),
  ]);
}

export async function refreshQueriesAfterSettingsSaved(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: settingsQueryKey }),
    queryClient.invalidateQueries({ queryKey: agentStatusQueryKey }),
    queryClient.invalidateQueries({ queryKey: activityQueryKey }),
  ]);
}

export async function refreshQueriesAfterAgentCommand(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: agentStatusQueryKey }),
    queryClient.invalidateQueries({ queryKey: activityQueryKey }),
  ]);
}
