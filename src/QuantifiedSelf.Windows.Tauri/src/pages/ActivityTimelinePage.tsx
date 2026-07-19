import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { bridgeClient, toCommandError } from '../bridge/client';
import {
  activityTimelineQueryKey,
  initializeQueryKey,
} from '../bridge/queryInvalidation';
import { TimelineView } from '../features/activity/TimelineView';
import { formatLocalDateParam } from '../features/activity/activityFormatting';
import {
  isTimelineEmpty,
  parseTimelineDateParam,
  parseTimelineHourParam,
  type ActivityTimelineViewState,
} from '../features/activity/timelineModel';
import { getOverviewRefreshInterval } from '../features/dashboard/dashboardModel';
import { useDocumentVisibility } from '../features/dashboard/useDocumentVisibility';

export default function ActivityTimelinePage() {
  const visible = useDocumentVisibility();
  const [searchParams, setSearchParams] = useSearchParams();
  const todayParam = formatLocalDateParam(new Date());
  const dateParam = parseTimelineDateParam(searchParams.get('date')) ?? todayParam;
  const highlightHour = parseTimelineHourParam(searchParams.get('hour'));
  const isToday = dateParam === todayParam;

  const initialize = useQuery({
    queryKey: initializeQueryKey,
    queryFn: bridgeClient.initialize,
  });
  const timeline = useQuery({
    queryKey: activityTimelineQueryKey(dateParam),
    queryFn: () => bridgeClient.getActivityTimeline(dateParam),
    enabled: initialize.isSuccess,
    refetchInterval: isToday ? getOverviewRefreshInterval(visible) : false,
    refetchIntervalInBackground: true,
  });

  const error = initialize.error ?? timeline.error;
  let state: ActivityTimelineViewState;
  if (error) {
    state = { kind: 'error', message: toCommandError(error).message };
  } else if (initialize.isPending || timeline.isPending || timeline.data === undefined) {
    state = { kind: 'loading' };
  } else if (isTimelineEmpty(timeline.data)) {
    state = { kind: 'empty', updatedAt: timeline.dataUpdatedAt };
  } else {
    state = { kind: 'ready', timeline: timeline.data, updatedAt: timeline.dataUpdatedAt };
  }

  const refresh = async () => {
    if (!initialize.isSuccess) {
      const initialization = await initialize.refetch();
      if (initialization.isError) return;
    }
    await timeline.refetch();
  };

  const selectDate = (nextDateParam: string | undefined) => {
    setSearchParams(nextDateParam === undefined ? {} : { date: nextDateParam });
  };

  return (
    <TimelineView
      state={state}
      refreshing={initialize.isFetching || timeline.isFetching}
      dateParam={dateParam}
      todayParam={todayParam}
      highlightHour={highlightHour}
      onSelectDate={selectDate}
      onRefresh={() => { void refresh(); }}
    />
  );
}
