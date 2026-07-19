using QuantifiedSelf.Windows.ApplicationLayer.Abstractions.Data;
using QuantifiedSelf.Windows.ApplicationLayer.Contracts.Activity;
using QuantifiedSelf.Windows.Core.Display;
using QuantifiedSelf.Windows.Core.Models;

namespace QuantifiedSelf.Windows.ApplicationLayer.Activity;

/// <summary>
/// Read-only service that builds the timeline for one local day from app_sessions.
/// Sessions are clipped to the local-day bounds with durations scaled proportionally
/// (same rounding as DailyStatsService), sorted ascending by start, and the gaps
/// between consecutive segments are precomputed — callers never derive day
/// boundaries, effective ends, or pause intervals themselves.
/// </summary>
public sealed class TimelineDataService : ITimelineDataService
{
    private const int MaxSessionsPerDay = 1000;

    private readonly ISessionQueryPort _sessionQueryPort;
    private readonly TimeProvider _timeProvider;

    public TimelineDataService(
        ISessionQueryPort sessionQueryPort,
        TimeProvider? timeProvider = null)
    {
        _sessionQueryPort = sessionQueryPort ?? throw new ArgumentNullException(nameof(sessionQueryPort));
        _timeProvider = timeProvider ?? TimeProvider.System;
    }

    /// <summary>
    /// Returns the clipped, ascending-sorted timeline for the given local date.
    /// Throws on query failure — the caller decides whether to preserve old data.
    /// </summary>
    public async Task<TimelineResult> GetTimelineAsync(
        DateOnly localDate,
        CancellationToken cancellationToken = default)
    {
        var today = DateOnly.FromDateTime(_timeProvider.GetLocalNow().DateTime);
        var nowUtc = _timeProvider.GetUtcNow().UtcDateTime;
        var (rangeStartUtc, rangeEndUtc) = DailyStatsService.GetLocalDayRangeUtc(localDate);

        // For past dates, treat end-of-day as "now" so open sessions
        // are clipped to the day boundary rather than stretched to present.
        var effectiveNow = localDate < today ? rangeEndUtc : nowUtc;

        var sessions = await _sessionQueryPort.GetSessionsOverlappingRangeAsync(
            rangeStartUtc, rangeEndUtc, MaxSessionsPerDay, cancellationToken);

        var segments = new List<TimelineSegment>(sessions.Count);
        foreach (var session in sessions)
        {
            var sessionStart = session.StartedAtUtc.ToUniversalTime();
            var sessionEnd = (session.EndedAtUtc ?? effectiveNow).ToUniversalTime();
            var overlapStart = sessionStart > rangeStartUtc ? sessionStart : rangeStartUtc;
            var overlapEnd = sessionEnd < rangeEndUtc ? sessionEnd : rangeEndUtc;
            if (overlapEnd > effectiveNow)
            {
                overlapEnd = effectiveNow;
            }

            if (overlapEnd <= overlapStart)
            {
                continue;
            }

            var (total, active, idle, unknown) = ScaleSessionDurations(
                session, rangeStartUtc, rangeEndUtc, effectiveNow);

            segments.Add(new TimelineSegment
            {
                StartedAtUtc = overlapStart,
                EndedAtUtc = overlapEnd,
                IsOpen = session.EndedAtUtc is null,
                ProcessName = session.ProcessName,
                DisplayName = string.IsNullOrWhiteSpace(session.DisplayName)
                    ? ProductDisplayNameResolver.Resolve(session.ProcessName)
                    : session.DisplayName,
                TotalSeconds = total,
                ActiveSeconds = active,
                IdleSeconds = idle,
                UnknownSeconds = unknown,
                CloseReason = session.CloseReason
            });
        }

        segments = segments.OrderBy(segment => segment.StartedAtUtc).ToList();

        var gaps = new List<TimelineGap>();
        for (var i = 1; i < segments.Count; i++)
        {
            var previousEnd = segments[i - 1].EndedAtUtc ?? segments[i - 1].StartedAtUtc;
            var gapDuration = segments[i].StartedAtUtc - previousEnd;
            if (gapDuration <= TimeSpan.Zero)
            {
                continue;
            }

            gaps.Add(new TimelineGap
            {
                StartedAtUtc = previousEnd,
                EndedAtUtc = segments[i].StartedAtUtc,
                DurationSeconds = (long)Math.Round(gapDuration.TotalSeconds, MidpointRounding.AwayFromZero)
            });
        }

        return new TimelineResult
        {
            Date = localDate,
            IsToday = localDate == today,
            Segments = segments,
            Gaps = gaps
        };
    }

    // Same overlap-fraction scaling and rounding as DailyStatsService.ScaleSessionDurations,
    // extended to the unknown-state duration.
    private static (long Total, long Active, long Idle, long Unknown) ScaleSessionDurations(
        AppSession session,
        DateTime rangeStartUtc,
        DateTime rangeEndUtc,
        DateTime nowUtc)
    {
        var sessionStart = session.StartedAtUtc.ToUniversalTime();
        var sessionEnd = (session.EndedAtUtc ?? nowUtc).ToUniversalTime();
        var overlapStart = sessionStart > rangeStartUtc ? sessionStart : rangeStartUtc;
        var overlapEnd = sessionEnd < rangeEndUtc ? sessionEnd : rangeEndUtc;
        var overlapSeconds = Math.Max(0, (overlapEnd - overlapStart).TotalSeconds);
        var sessionSpanSeconds = Math.Max(1.0, (sessionEnd - sessionStart).TotalSeconds);
        var scale = overlapSeconds / sessionSpanSeconds;

        return (
            Total: (long)Math.Round(session.TotalDurationSeconds * scale, MidpointRounding.AwayFromZero),
            Active: (long)Math.Round(session.ActiveDurationSeconds * scale, MidpointRounding.AwayFromZero),
            Idle: (long)Math.Round(session.IdleDurationSeconds * scale, MidpointRounding.AwayFromZero),
            Unknown: (long)Math.Round(session.UnknownDurationSeconds * scale, MidpointRounding.AwayFromZero));
    }
}
