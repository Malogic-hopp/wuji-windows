using QuantifiedSelf.Windows.ApplicationLayer.Abstractions.Data;
using QuantifiedSelf.Windows.ApplicationLayer.Activity;
using QuantifiedSelf.Windows.ApplicationLayer.Contracts.Activity;
using QuantifiedSelf.Windows.Core.Models;

namespace QuantifiedSelf.Windows.Application.Tests;

[Trait("Category", "Fast")]
public sealed class TimelineDataServiceTests
{
    private static readonly DateOnly Today = new(2026, 7, 15);

    [Fact]
    public async Task GetTimelineAsync_SortsSegmentsAscendingAndResolvesDisplayNames()
    {
        var nowLocal = Local(Today, 12, 0);
        var later = Session(Local(Today, 9, 0), Local(Today, 10, 0),
            processName: "Code", displayName: "", closeReason: "ProcessChanged");
        var earlier = Session(Local(Today, 8, 0), Local(Today, 8, 30),
            processName: "msedge", displayName: "Edge", closeReason: "Paused");
        // The port returns newest first; the service must sort ascending.
        var service = CreateService([later, earlier], nowLocal);

        var result = await service.GetTimelineAsync(Today);

        Assert.Equal(2, result.Segments.Count);
        Assert.Equal("msedge", result.Segments[0].ProcessName);
        Assert.Equal("Code", result.Segments[1].ProcessName);
        Assert.True(result.Segments[0].StartedAtUtc < result.Segments[1].StartedAtUtc);
        // Empty DisplayName falls back to the resolver; non-empty is kept as-is.
        Assert.Equal("Code", result.Segments[1].DisplayName);
        Assert.Equal("Edge", result.Segments[0].DisplayName);
        Assert.Equal("Paused", result.Segments[0].CloseReason);
        Assert.False(result.Segments[0].IsOpen);
        Assert.Equal(1800, result.Segments[0].TotalSeconds);
        // The 30-minute hole between the two sessions is a real gap.
        var gap = Assert.Single(result.Gaps);
        Assert.Equal(Local(Today, 8, 30).ToUniversalTime(), gap.StartedAtUtc);
        Assert.Equal(Local(Today, 9, 0).ToUniversalTime(), gap.EndedAtUtc);
        Assert.Equal(1800, gap.DurationSeconds);
    }

    [Fact]
    public async Task GetTimelineAsync_ClipsCrossMidnightSessionAndScalesDurations()
    {
        var nowLocal = Local(Today, 12, 0);
        var dayStartUtc = Local(Today, 0, 0).ToUniversalTime();
        var inDayEndLocal = Local(Today, 1, 0);
        // 2-hour session from yesterday 23:00 to today 01:00; only 1 hour falls in-day.
        var session = new AppSession
        {
            StartedAtUtc = Local(Today.AddDays(-1), 23, 0).ToUniversalTime(),
            EndedAtUtc = inDayEndLocal.ToUniversalTime(),
            ProcessName = "Code",
            DisplayName = "Code",
            TotalDurationSeconds = 7200,
            ActiveDurationSeconds = 3600,
            IdleDurationSeconds = 2400,
            UnknownDurationSeconds = 1200,
            CloseReason = "Stopped"
        };
        var service = CreateService([session], nowLocal);

        var result = await service.GetTimelineAsync(Today);

        var segment = Assert.Single(result.Segments);
        Assert.Equal(dayStartUtc, segment.StartedAtUtc);
        Assert.Equal(inDayEndLocal.ToUniversalTime(), segment.EndedAtUtc);
        Assert.Equal(3600, segment.TotalSeconds);
        Assert.Equal(1800, segment.ActiveSeconds);
        Assert.Equal(1200, segment.IdleSeconds);
        Assert.Equal(600, segment.UnknownSeconds);
        Assert.Equal("Stopped", segment.CloseReason);
        Assert.Empty(result.Gaps);
    }

    [Fact]
    public async Task GetTimelineAsync_OpenSessionToday_UsesTimeProviderNowAsEffectiveEnd()
    {
        var nowLocal = Local(Today, 12, 0);
        var session = new AppSession
        {
            StartedAtUtc = Local(Today, 10, 0).ToUniversalTime(),
            EndedAtUtc = null,
            ProcessName = "Code",
            DisplayName = "Code",
            TotalDurationSeconds = 3600,
            ActiveDurationSeconds = 3600,
            CloseReason = "Open"
        };
        var service = CreateService([session], nowLocal);

        var result = await service.GetTimelineAsync(Today);

        var segment = Assert.Single(result.Segments);
        Assert.True(segment.IsOpen);
        Assert.Equal(nowLocal.ToUniversalTime(), segment.EndedAtUtc);
        Assert.Equal(3600, segment.TotalSeconds);
        Assert.Empty(result.Gaps);
    }

    [Fact]
    public async Task GetTimelineAsync_OpenSessionOnPastDate_ClipsToDayEnd()
    {
        var nowLocal = Local(Today, 12, 0);
        var pastDate = Today.AddDays(-1);
        var dayEndUtc = Local(Today, 0, 0).ToUniversalTime();
        var session = new AppSession
        {
            StartedAtUtc = Local(pastDate, 22, 0).ToUniversalTime(),
            EndedAtUtc = null,
            ProcessName = "Code",
            DisplayName = "Code",
            TotalDurationSeconds = 7200,
            ActiveDurationSeconds = 7200,
            CloseReason = "Open"
        };
        var service = CreateService([session], nowLocal);

        var result = await service.GetTimelineAsync(pastDate);

        Assert.False(result.IsToday);
        var segment = Assert.Single(result.Segments);
        Assert.True(segment.IsOpen);
        Assert.Equal(dayEndUtc, segment.EndedAtUtc);
        Assert.Equal(7200, segment.TotalSeconds);
    }

    [Fact]
    public async Task GetTimelineAsync_EmitsGapsOnlyBetweenSeparatedSegments()
    {
        var nowLocal = Local(Today, 12, 0);
        var firstEnd = Local(Today, 10, 0);
        var secondStart = Local(Today, 10, 30);
        var sessions = new[]
        {
            Session(Local(Today, 9, 0), firstEnd),
            Session(secondStart, Local(Today, 11, 0)),
            // Back-to-back with the previous one: must not produce a gap.
            Session(Local(Today, 11, 0), Local(Today, 11, 45))
        };
        var service = CreateService(sessions, nowLocal);

        var result = await service.GetTimelineAsync(Today);

        Assert.Equal(3, result.Segments.Count);
        var gap = Assert.Single(result.Gaps);
        Assert.Equal(firstEnd.ToUniversalTime(), gap.StartedAtUtc);
        Assert.Equal(secondStart.ToUniversalTime(), gap.EndedAtUtc);
        Assert.Equal(1800, gap.DurationSeconds);
    }

    [Fact]
    public async Task GetTimelineAsync_EmptyDay_ReturnsEmptyResultWithDateAndIsToday()
    {
        var nowLocal = Local(Today, 12, 0);
        var service = CreateService([], nowLocal);

        var result = await service.GetTimelineAsync(Today);

        Assert.Equal(Today, result.Date);
        Assert.True(result.IsToday);
        Assert.Empty(result.Segments);
        Assert.Empty(result.Gaps);
    }

    [Fact]
    public async Task GetTimelineAsync_PureActiveSession_SingleActiveSubSegmentWithoutSampleQuery()
    {
        var nowLocal = Local(Today, 12, 0);
        var session = Session(Local(Today, 9, 0), Local(Today, 10, 0));
        var samples = new FakeSampleQueryPort();
        var service = CreateService([session], nowLocal, samples);

        var result = await service.GetTimelineAsync(Today);

        var segment = Assert.Single(result.Segments);
        var sub = Assert.Single(segment.SubSegments);
        Assert.True(sub.IsActive);
        Assert.Equal(segment.StartedAtUtc, sub.StartedAtUtc);
        Assert.Equal(segment.EndedAtUtc, sub.EndedAtUtc);
        // No idle/unknown time → the sample table is never queried.
        Assert.Equal(0, samples.InvocationCount);
    }

    [Fact]
    public async Task GetTimelineAsync_MixedSession_SplitsIntoTilingSubSegmentsAtSampleMidpoints()
    {
        var nowLocal = Local(Today, 12, 0);
        var session = new AppSession
        {
            StartedAtUtc = Local(Today, 10, 0).ToUniversalTime(),
            EndedAtUtc = Local(Today, 11, 0).ToUniversalTime(),
            ProcessName = "Weixin",
            DisplayName = "微信",
            TotalDurationSeconds = 3600,
            ActiveDurationSeconds = 1200,
            IdleDurationSeconds = 2400,
            CloseReason = "ProcessChanged"
        };
        var samples = new FakeSampleQueryPort(
        [
            Sample(Local(Today, 10, 0), "Active"),
            Sample(Local(Today, 10, 10), "Active"),
            Sample(Local(Today, 10, 20), "Idle"),
            Sample(Local(Today, 10, 40), "Idle"),
            Sample(Local(Today, 10, 50), "Active")
        ]);
        var service = CreateService([session], nowLocal, samples);

        var result = await service.GetTimelineAsync(Today);

        var segment = Assert.Single(result.Segments);
        Assert.Equal(3, segment.SubSegments.Count);
        // Transition midpoints: A→I between 10:10/10:20 → 10:15; I→A between 10:40/10:50 → 10:45.
        Assert.Equal(Local(Today, 10, 0).ToUniversalTime(), segment.SubSegments[0].StartedAtUtc);
        Assert.Equal(Local(Today, 10, 15).ToUniversalTime(), segment.SubSegments[0].EndedAtUtc);
        Assert.True(segment.SubSegments[0].IsActive);
        Assert.Equal(Local(Today, 10, 15).ToUniversalTime(), segment.SubSegments[1].StartedAtUtc);
        Assert.Equal(Local(Today, 10, 45).ToUniversalTime(), segment.SubSegments[1].EndedAtUtc);
        Assert.False(segment.SubSegments[1].IsActive);
        Assert.Equal(Local(Today, 10, 45).ToUniversalTime(), segment.SubSegments[2].StartedAtUtc);
        Assert.Equal(Local(Today, 11, 0).ToUniversalTime(), segment.SubSegments[2].EndedAtUtc);
        Assert.True(segment.SubSegments[2].IsActive);
        // Sub-segments tile the session exactly: first start, shared boundaries, last end.
        Assert.Equal(segment.StartedAtUtc, segment.SubSegments[0].StartedAtUtc);
        Assert.Equal(segment.EndedAtUtc, segment.SubSegments[2].EndedAtUtc);
        Assert.Equal(1, samples.InvocationCount);
        Assert.Equal("Weixin", samples.LastProcessName);
    }

    [Fact]
    public async Task GetTimelineAsync_AllIdleAndUnknownSamples_SingleInactiveSubSegment()
    {
        var nowLocal = Local(Today, 12, 0);
        var session = new AppSession
        {
            StartedAtUtc = Local(Today, 9, 0).ToUniversalTime(),
            EndedAtUtc = Local(Today, 10, 0).ToUniversalTime(),
            ProcessName = "Weixin",
            DisplayName = "微信",
            TotalDurationSeconds = 3600,
            ActiveDurationSeconds = 0,
            IdleDurationSeconds = 3000,
            UnknownDurationSeconds = 600,
            CloseReason = "ProcessChanged"
        };
        var samples = new FakeSampleQueryPort(
        [
            Sample(Local(Today, 9, 0), "Idle"),
            Sample(Local(Today, 9, 30), "Unknown")
        ]);
        var service = CreateService([session], nowLocal, samples);

        var result = await service.GetTimelineAsync(Today);

        var sub = Assert.Single(result.Segments[0].SubSegments);
        Assert.False(sub.IsActive);
        Assert.Equal(Local(Today, 9, 0).ToUniversalTime(), sub.StartedAtUtc);
        Assert.Equal(Local(Today, 10, 0).ToUniversalTime(), sub.EndedAtUtc);
    }

    [Fact]
    public async Task GetTimelineAsync_NoSamplesForIdleSession_DegradesToSingleActiveSubSegment()
    {
        var nowLocal = Local(Today, 12, 0);
        var session = new AppSession
        {
            StartedAtUtc = Local(Today, 9, 0).ToUniversalTime(),
            EndedAtUtc = Local(Today, 10, 0).ToUniversalTime(),
            ProcessName = "Code",
            DisplayName = "Code",
            TotalDurationSeconds = 3600,
            ActiveDurationSeconds = 1800,
            IdleDurationSeconds = 1800,
            CloseReason = "ProcessChanged"
        };
        var service = CreateService([session], nowLocal);

        var result = await service.GetTimelineAsync(Today);

        var sub = Assert.Single(result.Segments[0].SubSegments);
        Assert.True(sub.IsActive);
        Assert.Equal(Local(Today, 9, 0).ToUniversalTime(), sub.StartedAtUtc);
        Assert.Equal(Local(Today, 10, 0).ToUniversalTime(), sub.EndedAtUtc);
    }

    [Fact]
    public async Task GetTimelineAsync_SampleQueryLimitCoversWholeSessionDuration()
    {
        var nowLocal = Local(Today, 23, 0);
        // 6-hour session at default 3s sampling ≈ 7,200 samples; the old flat 15,000
        // cap would truncate a >12.5h session — the limit must scale with duration.
        var session = new AppSession
        {
            StartedAtUtc = Local(Today, 10, 0).ToUniversalTime(),
            EndedAtUtc = Local(Today, 16, 0).ToUniversalTime(),
            ProcessName = "Code",
            DisplayName = "Code",
            TotalDurationSeconds = 21600,
            ActiveDurationSeconds = 10800,
            IdleDurationSeconds = 10800,
            CloseReason = "ProcessChanged"
        };
        var samples = new FakeSampleQueryPort([Sample(Local(Today, 10, 0), "Idle")]);
        var service = CreateService([session], nowLocal, samples);

        await service.GetTimelineAsync(Today);

        Assert.True(samples.LastLimit >= 21600);
    }

    private static TimelineDataService CreateService(
        IReadOnlyList<AppSession> sessions,
        DateTime nowLocal,
        FakeSampleQueryPort? samples = null)
    {
        return new TimelineDataService(
            new FakeSessionQueryPort(sessions),
            samples ?? new FakeSampleQueryPort(),
            new FixedTimeProvider(new DateTimeOffset(nowLocal.ToUniversalTime())));
    }

    private static ForegroundSample Sample(DateTime timeLocal, string activityState) =>
        new()
        {
            SampleTimeUtc = timeLocal.ToUniversalTime(),
            ProcessName = "Code",
            ActivityState = activityState
        };


    private static DateTime Local(DateOnly date, int hour, int minute) =>
        date.ToDateTime(new TimeOnly(hour, minute), DateTimeKind.Local);

    private static AppSession Session(
        DateTime startLocal,
        DateTime endLocal,
        string processName = "Code",
        string displayName = "Code",
        string closeReason = "ProcessChanged")
    {
        var spanSeconds = (int)(endLocal - startLocal).TotalSeconds;
        return new AppSession
        {
            StartedAtUtc = startLocal.ToUniversalTime(),
            EndedAtUtc = endLocal.ToUniversalTime(),
            ProcessName = processName,
            DisplayName = displayName,
            TotalDurationSeconds = spanSeconds,
            ActiveDurationSeconds = spanSeconds,
            CloseReason = closeReason
        };
    }

    private sealed class FixedTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => utcNow;
    }

    private sealed class FakeSampleQueryPort(IReadOnlyList<ForegroundSample>? samples = null) : ISampleQueryPort
    {
        public int InvocationCount { get; private set; }

        public int LastLimit { get; private set; }

        public string? LastProcessName { get; private set; }

        public Task<IReadOnlyList<ForegroundSample>> GetRecentSamplesAsync(
            int limit,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<ForegroundSample>> GetSamplesForProcessInRangeAsync(
            DateTime startUtc,
            DateTime endUtc,
            string processName,
            int limit,
            CancellationToken cancellationToken = default)
        {
            InvocationCount++;
            LastLimit = limit;
            LastProcessName = processName;
            return Task.FromResult(samples ?? (IReadOnlyList<ForegroundSample>)Array.Empty<ForegroundSample>());
        }
    }

    private sealed class FakeSessionQueryPort(IReadOnlyList<AppSession> sessions) : ISessionQueryPort
    {
        public Task<IReadOnlyList<AppSession>> GetRecentSessionsAsync(
            int limit,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<AppSession>> GetSessionsForLocalDayAsync(
            DateOnly localDate,
            int limit,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<AppSession>> GetSessionsOverlappingRangeAsync(
            DateTime startUtc,
            DateTime endUtc,
            int limit,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(sessions);
    }
}
