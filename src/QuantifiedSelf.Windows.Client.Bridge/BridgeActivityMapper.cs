using System.Globalization;
using QuantifiedSelf.Windows.ApplicationLayer.Contracts.Activity;
using QuantifiedSelf.Windows.Client.Bridge.Generated;
using QuantifiedSelf.Windows.Core.Models;

namespace QuantifiedSelf.Windows.Client.Bridge;

internal static class BridgeActivityMapper
{
    private const int MaxDisplayNameLength = 128;

    public static ActivityOverviewResult ToOverview(
        DashboardSummary summary,
        IReadOnlyList<AppUsageSummary> topApps,
        IReadOnlyList<AppSession> recentSessions)
    {
        ArgumentNullException.ThrowIfNull(summary);
        ArgumentNullException.ThrowIfNull(topApps);
        ArgumentNullException.ThrowIfNull(recentSessions);

        return new ActivityOverviewResult
        {
            Summary = new ActivityOverviewSummary
            {
                DateUtc = FormatUtc(summary.DateUtc),
                TotalDurationSeconds = NonNegative(summary.TotalDurationSeconds),
                ActiveDurationSeconds = NonNegative(summary.ActiveDurationSeconds),
                IdleDurationSeconds = NonNegative(summary.IdleDurationSeconds),
                UnknownDurationSeconds = NonNegative(summary.UnknownDurationSeconds),
                SessionCount = NonNegative(summary.SessionCount)
            },
            TopApps = topApps.Select(ToApp).ToArray(),
            RecentSessions = recentSessions.Select(ToSession).ToArray()
        };
    }

    private static ActivityOverviewApp ToApp(AppUsageSummary source)
    {
        return new ActivityOverviewApp
        {
            DisplayName = ToSafeDisplayName(source.DisplayName),
            TotalDurationSeconds = NonNegative(source.TotalDurationSeconds),
            ActiveDurationSeconds = NonNegative(source.ActiveDurationSeconds),
            IdleDurationSeconds = NonNegative(source.IdleDurationSeconds),
            UnknownDurationSeconds = NonNegative(source.UnknownDurationSeconds),
            SessionCount = NonNegative(source.SessionCount),
            LastUsedAtUtc = FormatUtc(source.LastUsedAtUtc)
        };
    }

    private static ActivityOverviewSession ToSession(AppSession source)
    {
        return new ActivityOverviewSession
        {
            DisplayName = ToSafeDisplayName(source.DisplayName),
            StartedAtUtc = FormatUtc(source.StartedAtUtc),
            EndedAtUtc = FormatUtc(source.EndedAtUtc),
            TotalDurationSeconds = NonNegative(source.TotalDurationSeconds),
            ActiveDurationSeconds = NonNegative(source.ActiveDurationSeconds),
            IdleDurationSeconds = NonNegative(source.IdleDurationSeconds),
            UnknownDurationSeconds = NonNegative(source.UnknownDurationSeconds)
        };
    }

    public static ActivityDailyStatsResult ToDailyStats(
        DailyActivitySummary summary,
        DateOnly localDate,
        DateOnly todayLocal)
    {
        ArgumentNullException.ThrowIfNull(summary);

        return new ActivityDailyStatsResult
        {
            Date = FormatLocalDate(localDate),
            IsToday = localDate == todayLocal,
            TotalSeconds = NonNegative(summary.TotalDurationSeconds),
            ActiveSeconds = NonNegative(summary.TotalActiveDurationSeconds),
            IdleSeconds = NonNegative(summary.TotalIdleDurationSeconds),
            // DailyActivitySummary documents Total as Active + Idle + Unknown; the
            // unknown remainder is derived from that invariant, never recomputed.
            UnknownSeconds = NonNegative(
                summary.TotalDurationSeconds
                - summary.TotalActiveDurationSeconds
                - summary.TotalIdleDurationSeconds),
            SessionCount = NonNegative(summary.SessionCount),
            SampleCount = NonNegative(summary.SampleCount),
            Hours = ToHourlyBuckets(summary.HourlyActivity)
        };
    }

    public static ActivityWeeklyTrendResult ToWeeklyTrend(WeeklyTrendResult trend, DateOnly todayLocal)
    {
        ArgumentNullException.ThrowIfNull(trend);

        return new ActivityWeeklyTrendResult
        {
            Days = trend.Days.Select(day => ToTrendDay(day, todayLocal)).ToArray(),
            AverageActiveSeconds = RoundNonNegative(trend.AverageActiveSeconds),
            ComparisonToAverageText = trend.ActiveComparisonText ?? string.Empty,
            ComparisonToYesterdayText = trend.YesterdayActiveComparisonText ?? string.Empty,
            WeekToDateText = trend.WeekActiveComparisonText ?? string.Empty
        };
    }

    public static ActivityTimelineResult ToTimeline(TimelineResult timeline)
    {
        ArgumentNullException.ThrowIfNull(timeline);

        return new ActivityTimelineResult
        {
            Date = FormatLocalDate(timeline.Date),
            IsToday = timeline.IsToday,
            Sessions = timeline.Segments.Select(ToTimelineSession).ToArray(),
            Gaps = timeline.Gaps.Select(ToTimelineGap).ToArray()
        };
    }

    public static ActivityHeatmapResult ToHeatmap(HourActivityHeatmapResult heatmap)
    {
        ArgumentNullException.ThrowIfNull(heatmap);

        return new ActivityHeatmapResult
        {
            Today = FormatLocalDate(heatmap.Today),
            Cells = heatmap.Points.Select(ToHeatmapCell).ToArray()
        };
    }

    private static ActivityHourlyBucket[] ToHourlyBuckets(IReadOnlyList<HourlyActivity> hourlyActivity)
    {
        var byHour = new Dictionary<int, HourlyActivity>();
        foreach (var bucket in hourlyActivity)
        {
            byHour[bucket.Hour] = bucket;
        }

        return Enumerable.Range(0, 24)
            .Select(hour => byHour.TryGetValue(hour, out var bucket)
                ? new ActivityHourlyBucket
                {
                    Hour = hour,
                    ActiveSeconds = RoundNonNegative(bucket.ActiveSeconds),
                    IdleSeconds = RoundNonNegative(bucket.IdleSeconds),
                    UnknownSeconds = RoundNonNegative(bucket.UnknownSeconds)
                }
                : new ActivityHourlyBucket
                {
                    Hour = hour,
                    ActiveSeconds = 0,
                    IdleSeconds = 0,
                    UnknownSeconds = 0
                })
            .ToArray();
    }

    private static ActivityTrendDay ToTrendDay(DailyTrendPoint day, DateOnly todayLocal)
    {
        var localDate = DateOnly.FromDateTime(day.Date);
        return new ActivityTrendDay
        {
            Date = FormatLocalDate(localDate),
            IsToday = localDate == todayLocal,
            ActiveSeconds = NonNegative(day.ActiveSeconds),
            FocusSeconds = NonNegative(day.FocusSeconds),
            ContextSwitchCount = NonNegative(day.ContextSwitchCount),
            SessionCount = NonNegative(day.SessionCount),
            TopAppName = ToSafeTopAppName(day.TopAppName)
        };
    }

    private static ActivityTimelineSession ToTimelineSession(TimelineSegment segment)
    {
        return new ActivityTimelineSession
        {
            StartedAtUtc = FormatUtc(segment.StartedAtUtc),
            EndedAtUtc = FormatUtc(segment.EndedAtUtc),
            IsOpen = segment.IsOpen,
            AppName = ToSafeAppName(segment.DisplayName, segment.ProcessName),
            TotalSeconds = NonNegative(segment.TotalSeconds),
            ActiveSeconds = NonNegative(segment.ActiveSeconds),
            IdleSeconds = NonNegative(segment.IdleSeconds),
            UnknownSeconds = NonNegative(segment.UnknownSeconds),
            CloseReason = ToCloseReason(segment.CloseReason)
        };
    }

    private static ActivityTimelineGap ToTimelineGap(TimelineGap gap)
    {
        return new ActivityTimelineGap
        {
            StartedAtUtc = FormatUtc(gap.StartedAtUtc),
            EndedAtUtc = FormatUtc(gap.EndedAtUtc),
            DurationSeconds = NonNegative(gap.DurationSeconds)
        };
    }

    private static ActivityHeatmapCell ToHeatmapCell(DailyHourActivityPoint point)
    {
        return new ActivityHeatmapCell
        {
            Date = point.Date,
            Hour = point.Hour,
            ActiveSamples = NonNegative(point.ActiveSamples),
            IdleSamples = NonNegative(point.IdleSamples),
            UnknownSamples = NonNegative(point.UnknownSamples),
            ActiveRatioPercent = Math.Clamp(
                (int)Math.Round(point.ActiveRatio * 100, MidpointRounding.AwayFromZero),
                0,
                100),
            IntensityLevel = point.IntensityLevel
        };
    }

    private static ActivityTimelineCloseReason ToCloseReason(string? value)
    {
        if (string.Equals(value, "Open", StringComparison.OrdinalIgnoreCase))
        {
            return ActivityTimelineCloseReason.Open;
        }

        if (string.Equals(value, "ProcessChanged", StringComparison.OrdinalIgnoreCase))
        {
            return ActivityTimelineCloseReason.ProcessChanged;
        }

        if (string.Equals(value, "Paused", StringComparison.OrdinalIgnoreCase))
        {
            return ActivityTimelineCloseReason.Paused;
        }

        if (string.Equals(value, "Stopped", StringComparison.OrdinalIgnoreCase))
        {
            return ActivityTimelineCloseReason.Stopped;
        }

        return ActivityTimelineCloseReason.Other;
    }

    private static string ToSafeAppName(string? displayName, string? processName) =>
        string.IsNullOrWhiteSpace(displayName)
            ? ToSafeDisplayName(processName)
            : ToSafeDisplayName(displayName);

    private static string ToSafeTopAppName(string? value) =>
        string.IsNullOrWhiteSpace(value) ? string.Empty : ToSafeDisplayName(value);

    private static string ToSafeDisplayName(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "未知应用";
        }

        var withoutControlCharacters = new string(
            value.Trim().Where(character => !char.IsControl(character)).ToArray());
        var normalized = withoutControlCharacters.Replace('\\', '/');
        var finalSeparator = normalized.LastIndexOf('/');
        var displayName = finalSeparator >= 0 ? normalized[(finalSeparator + 1)..] : normalized;
        if (string.IsNullOrWhiteSpace(displayName))
        {
            return "未知应用";
        }

        return displayName.Length <= MaxDisplayNameLength
            ? displayName
            : displayName[..MaxDisplayNameLength];
    }

    private static string FormatUtc(DateTime value) =>
        value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    private static string? FormatUtc(DateTime? value) =>
        value is null ? null : FormatUtc(value.Value);

    private static string FormatLocalDate(DateOnly value) =>
        value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static int NonNegative(int value) => Math.Max(0, value);

    private static long NonNegative(long value) => Math.Max(0, value);

    private static long RoundNonNegative(double value) =>
        NonNegative((long)Math.Round(value, MidpointRounding.AwayFromZero));
}
