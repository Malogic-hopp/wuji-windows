import { useQuery } from '@tanstack/react-query';
import { bridgeClient, toCommandError } from '../bridge/client';
import {
  activityHeatmapQueryKey,
  initializeQueryKey,
} from '../bridge/queryInvalidation';
import { HeatmapView } from '../features/activity/HeatmapView';
import {
  isHeatmapEmpty,
  type ActivityHeatmapViewState,
} from '../features/activity/heatmapModel';
import { getOverviewRefreshInterval } from '../features/dashboard/dashboardModel';
import { useDocumentVisibility } from '../features/dashboard/useDocumentVisibility';

export default function ActivityHeatmapPage() {
  const visible = useDocumentVisibility();
  const initialize = useQuery({
    queryKey: initializeQueryKey,
    queryFn: bridgeClient.initialize,
  });
  const heatmap = useQuery({
    queryKey: activityHeatmapQueryKey,
    queryFn: bridgeClient.getActivityHeatmap,
    enabled: initialize.isSuccess,
    refetchInterval: getOverviewRefreshInterval(visible),
    refetchIntervalInBackground: true,
  });

  const error = initialize.error ?? heatmap.error;
  let state: ActivityHeatmapViewState;
  if (error) {
    state = { kind: 'error', message: toCommandError(error).message };
  } else if (initialize.isPending || heatmap.isPending || heatmap.data === undefined) {
    state = { kind: 'loading' };
  } else if (isHeatmapEmpty(heatmap.data)) {
    state = { kind: 'empty', updatedAt: heatmap.dataUpdatedAt };
  } else {
    state = { kind: 'ready', heatmap: heatmap.data, updatedAt: heatmap.dataUpdatedAt };
  }

  const refresh = async () => {
    if (!initialize.isSuccess) {
      const initialization = await initialize.refetch();
      if (initialization.isError) return;
    }
    await heatmap.refetch();
  };

  return (
    <HeatmapView
      state={state}
      refreshing={initialize.isFetching || heatmap.isFetching}
      currentHour={new Date().getHours()}
      onRefresh={() => { void refresh(); }}
    />
  );
}
