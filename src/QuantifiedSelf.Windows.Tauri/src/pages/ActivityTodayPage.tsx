import { useQuery } from '@tanstack/react-query';
import { bridgeClient, toCommandError } from '../bridge/client';
import {
  activityDailyStatsQueryKey,
  initializeQueryKey,
} from '../bridge/queryInvalidation';
import { ActivityTodayView } from '../features/activity/ActivityTodayView';
import { formatLocalDateParam } from '../features/activity/activityFormatting';
import {
  isDailyStatsEmpty,
  type ActivityTodayViewState,
} from '../features/activity/activityModel';
import { getOverviewRefreshInterval } from '../features/dashboard/dashboardModel';
import { useDocumentVisibility } from '../features/dashboard/useDocumentVisibility';

export default function ActivityTodayPage() {
  const visible = useDocumentVisibility();
  const initialize = useQuery({
    queryKey: initializeQueryKey,
    queryFn: bridgeClient.initialize,
  });
  const today = formatLocalDateParam(new Date());
  const stats = useQuery({
    queryKey: activityDailyStatsQueryKey(today),
    queryFn: () => bridgeClient.getActivityDailyStats(formatLocalDateParam(new Date())),
    enabled: initialize.isSuccess,
    refetchInterval: getOverviewRefreshInterval(visible),
    refetchIntervalInBackground: true,
  });

  const error = initialize.error ?? stats.error;
  let state: ActivityTodayViewState;
  if (error) {
    state = { kind: 'error', message: toCommandError(error).message };
  } else if (initialize.isPending || stats.isPending || stats.data === undefined) {
    state = { kind: 'loading' };
  } else if (isDailyStatsEmpty(stats.data)) {
    state = { kind: 'empty', updatedAt: stats.dataUpdatedAt };
  } else {
    state = { kind: 'ready', stats: stats.data, updatedAt: stats.dataUpdatedAt };
  }

  const refresh = async () => {
    if (!initialize.isSuccess) {
      const initialization = await initialize.refetch();
      if (initialization.isError) return;
    }
    await stats.refetch();
  };

  return (
    <ActivityTodayView
      state={state}
      refreshing={initialize.isFetching || stats.isFetching}
      currentHour={new Date().getHours()}
      onRefresh={() => { void refresh(); }}
    />
  );
}
