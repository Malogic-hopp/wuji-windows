using QuantifiedSelf.Windows.ApplicationLayer.Activity;
using QuantifiedSelf.Windows.ApplicationLayer.Contracts.Activity;
using QuantifiedSelf.Windows.Core.Models;

namespace QuantifiedSelf.Windows.Client.Bridge.Tests;

internal sealed class FakeBridgeActivityClient : IActivityClient, IOverviewDataService,
    IDailyStatsService, IWeeklyTrendService, IHourActivityHeatmapService, ITimelineDataService
{
    public DashboardSummary Summary { get; set; } = new();

    public IReadOnlyList<AppUsageSummary> TopApps { get; set; } = [];

    public IReadOnlyList<AppSession> RecentSessions { get; set; } = [];

    public DailyActivitySummary DailyStats { get; set; } = new();

    public WeeklyTrendResult WeeklyTrend { get; set; } = new();

    public HourActivityHeatmapResult Heatmap { get; set; } = new();

    public TimelineResult Timeline { get; set; } = new() { RawSegmentCount = 3 };

    public Func<CancellationToken, Task<DashboardSummary>>? SummaryHandler { get; set; }

    public Func<CancellationToken, Task<IReadOnlyList<AppUsageSummary>>>? TopAppsHandler { get; set; }

    public Func<CancellationToken, Task<IReadOnlyList<AppSession>>>? RecentSessionsHandler { get; set; }

    public Func<DateOnly, CancellationToken, Task<DailyActivitySummary>>? DailyStatsHandler { get; set; }

    public Func<CancellationToken, Task<WeeklyTrendResult>>? WeeklyTrendHandler { get; set; }

    public Func<CancellationToken, Task<HourActivityHeatmapResult>>? HeatmapHandler { get; set; }

    public Func<DateOnly, CancellationToken, Task<TimelineResult>>? TimelineHandler { get; set; }

    public int SummaryCount { get; private set; }

    public int TopAppsCount { get; private set; }

    public int RecentSessionsCount { get; private set; }

    public int DailyStatsCount { get; private set; }

    public int WeeklyTrendCount { get; private set; }

    public int HeatmapCount { get; private set; }

    public int TimelineCount { get; private set; }

    public DateOnly? LastDailyStatsDate { get; private set; }

    public DateOnly? LastTimelineDate { get; private set; }

    IOverviewDataService IActivityClient.Overview => this;

    IDailyStatsService IActivityClient.DailyStats => this;

    IWeeklyTrendService IActivityClient.WeeklyTrend => this;

    IHourActivityHeatmapService IActivityClient.Heatmap => this;

    ITimelineDataService IActivityClient.Timeline => this;

    public ISamplesDataService Samples => throw new InvalidOperationException("Bridge must not use this Activity service.");

    public ISessionsDataService Sessions => throw new InvalidOperationException("Bridge must not use this Activity service.");

    public IAppsDataService Apps => throw new InvalidOperationException("Bridge must not use this Activity service.");

    public IFocusInterruptionInsightService Insights => throw new InvalidOperationException("Bridge must not use this Activity service.");

    public Task<DashboardSummary> GetDashboardSummaryAsync(CancellationToken cancellationToken = default)
    {
        SummaryCount++;
        return SummaryHandler is null
            ? Task.FromResult(Summary)
            : SummaryHandler(cancellationToken);
    }

    public Task<IReadOnlyList<AppUsageSummary>> GetTopAppsTodayAsync(
        int limit = 5,
        CancellationToken cancellationToken = default)
    {
        Assert.Equal(5, limit);
        TopAppsCount++;
        return TopAppsHandler is null
            ? Task.FromResult(TopApps)
            : TopAppsHandler(cancellationToken);
    }

    public Task<IReadOnlyList<AppSession>> GetRecentSessionsAsync(
        int limit = 5,
        CancellationToken cancellationToken = default)
    {
        Assert.Equal(5, limit);
        RecentSessionsCount++;
        return RecentSessionsHandler is null
            ? Task.FromResult(RecentSessions)
            : RecentSessionsHandler(cancellationToken);
    }

    public Task<DailyActivitySummary> GetTodaySummaryAsync(
        int topAppsLimit = 5,
        int topWindowsLimit = 10,
        CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException("Bridge must use GetSummaryForDateAsync with an explicit date.");

    public Task<DailyActivitySummary> GetSummaryForDateAsync(
        DateOnly localDate,
        int topAppsLimit = 5,
        int topWindowsLimit = 10,
        CancellationToken cancellationToken = default)
    {
        DailyStatsCount++;
        LastDailyStatsDate = localDate;
        return DailyStatsHandler is null
            ? Task.FromResult(DailyStats)
            : DailyStatsHandler(localDate, cancellationToken);
    }

    public Task<WeeklyTrendResult> GetWeeklyTrendAsync(CancellationToken cancellationToken = default)
    {
        WeeklyTrendCount++;
        return WeeklyTrendHandler is null
            ? Task.FromResult(WeeklyTrend)
            : WeeklyTrendHandler(cancellationToken);
    }

    public Task<HourActivityHeatmapResult> GetHeatmapAsync(CancellationToken cancellationToken = default)
    {
        HeatmapCount++;
        return HeatmapHandler is null
            ? Task.FromResult(Heatmap)
            : HeatmapHandler(cancellationToken);
    }

    public Task<TimelineResult> GetTimelineAsync(
        DateOnly localDate,
        CancellationToken cancellationToken = default)
    {
        TimelineCount++;
        LastTimelineDate = localDate;
        return TimelineHandler is null
            ? Task.FromResult(Timeline)
            : TimelineHandler(localDate, cancellationToken);
    }
}
