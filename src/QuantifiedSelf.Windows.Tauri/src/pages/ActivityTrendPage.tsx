import { useQuery } from '@tanstack/react-query';
import { bridgeClient, toCommandError } from '../bridge/client';
import {
  activityWeeklyTrendQueryKey,
  initializeQueryKey,
} from '../bridge/queryInvalidation';
import { ActivityTrendView } from '../features/activity/ActivityTrendView';
import {
  isWeeklyTrendEmpty,
  type ActivityTrendViewState,
} from '../features/activity/activityModel';
import { getOverviewRefreshInterval } from '../features/dashboard/dashboardModel';
import { useDocumentVisibility } from '../features/dashboard/useDocumentVisibility';

export default function ActivityTrendPage() {
  const visible = useDocumentVisibility();
  const initialize = useQuery({
    queryKey: initializeQueryKey,
    queryFn: bridgeClient.initialize,
  });
  const trend = useQuery({
    queryKey: activityWeeklyTrendQueryKey,
    queryFn: bridgeClient.getActivityWeeklyTrend,
    enabled: initialize.isSuccess,
    refetchInterval: getOverviewRefreshInterval(visible),
    refetchIntervalInBackground: true,
  });

  const error = initialize.error ?? trend.error;
  let state: ActivityTrendViewState;
  if (error) {
    state = { kind: 'error', message: toCommandError(error).message };
  } else if (initialize.isPending || trend.isPending || trend.data === undefined) {
    state = { kind: 'loading' };
  } else if (isWeeklyTrendEmpty(trend.data)) {
    state = { kind: 'empty', updatedAt: trend.dataUpdatedAt };
  } else {
    state = { kind: 'ready', trend: trend.data, updatedAt: trend.dataUpdatedAt };
  }

  const refresh = async () => {
    if (!initialize.isSuccess) {
      const initialization = await initialize.refetch();
      if (initialization.isError) return;
    }
    await trend.refetch();
  };

  return (
    <ActivityTrendView
      state={state}
      refreshing={initialize.isFetching || trend.isFetching}
      onRefresh={() => { void refresh(); }}
    />
  );
}
