import { lazy, Suspense } from 'react';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import { AppLayout } from './AppLayout';

const DashboardPage = lazy(() => import('../pages/DashboardPage'));
const ActivityTodayPage = lazy(() => import('../pages/ActivityTodayPage'));
const ActivityTrendPage = lazy(() => import('../pages/ActivityTrendPage'));
const ActivityTimelinePage = lazy(() => import('../pages/ActivityTimelinePage'));
const ActivityHeatmapPage = lazy(() => import('../pages/ActivityHeatmapPage'));
const SettingsPage = lazy(() => import('../pages/SettingsPage'));

const loading = <div className="route-loading" role="status">正在载入页面…</div>;

const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Suspense fallback={loading}><DashboardPage /></Suspense> },
      { path: 'activity/today', element: <Suspense fallback={loading}><ActivityTodayPage /></Suspense> },
      { path: 'activity/trend', element: <Suspense fallback={loading}><ActivityTrendPage /></Suspense> },
      { path: 'activity/timeline', element: <Suspense fallback={loading}><ActivityTimelinePage /></Suspense> },
      { path: 'activity/heatmap', element: <Suspense fallback={loading}><ActivityHeatmapPage /></Suspense> },
      { path: 'settings', element: <Suspense fallback={loading}><SettingsPage /></Suspense> },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
