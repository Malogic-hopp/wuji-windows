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
///
/// Sessions with idle time are further split into alternating active/idle sub-segments
/// using per-sample activity state from foreground_samples, so the 24-hour track
/// visually distinguishes active use from idle periods within a session.
///
/// Adjacent same-app fragments from rapid switching are merged into a single block
/// for display only; raw database sessions stay untouched.
/// </summary>
public sealed class TimelineDataService : ITimelineDataService
{
    private const int MaxSessionsPerDay = 1000;
    private const int MinSampleQueryLimit = 15_000;
    private const int MaxSampleQueryLimit = 500_000;

    // Display-oriented merge of adjacent same-app fragments from rapid switching;
    // raw sessions stay untouched — merging only shapes this query result.
    private const int MergeWindowSeconds = 120;

    private readonly ISessionQueryPort _sessionQueryPort;
    private readonly ISampleQueryPort _sampleQueryPort;
    private readonly TimeProvider _timeProvider;

    public TimelineDataService(
        ISessionQueryPort sessionQueryPort,
        ISampleQueryPort sampleQueryPort,
        TimeProvider? timeProvider = null)
    {
        _sessionQueryPort = sessionQueryPort ?? throw new ArgumentNullException(nameof(sessionQueryPort));
        _sampleQueryPort = sampleQueryPort ?? throw new ArgumentNullException(nameof(sampleQueryPort));
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

            var subSegments = await BuildSubSegmentsAsync(
                overlapStart, overlapEnd, idle, unknown, session.ProcessName, cancellationToken);

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
                CloseReason = session.CloseReason,
                SubSegments = subSegments
            });
        }

        segments = segments.OrderBy(segment => segment.StartedAtUtc).ToList();

        var rawSegmentCount = segments.Count;
        segments = MergeAdjacentFragments(segments);

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
            Gaps = gaps,
            RawSegmentCount = rawSegmentCount
        };
    }

    /// <summary>
    /// Merges adjacent same-app fragments separated by at most
    /// <see cref="MergeWindowSeconds"/> into one display block, so rapid app
    /// switching does not paint hundreds of tiny slivers on the track. The input
    /// must be sorted ascending by start; gap computation runs on the merged list,
    /// so merged-away micro-gaps never surface as <see cref="TimelineGap"/> entries.
    /// </summary>
    private static List<TimelineSegment> MergeAdjacentFragments(List<TimelineSegment> segments)
    {
        if (segments.Count < 2)
        {
            return segments;
        }

        var merged = new List<TimelineSegment>(segments.Count);
        var current = segments[0];
        for (var index = 1; index < segments.Count; index++)
        {
            var next = segments[index];
            // Never merge INTO an open segment — defensively, since an open
            // segment can only ever be the last one on the day.
            if (!current.IsOpen
                && string.Equals(current.ProcessName, next.ProcessName, StringComparison.Ordinal)
                && next.StartedAtUtc - (current.EndedAtUtc ?? current.StartedAtUtc)
                    <= TimeSpan.FromSeconds(MergeWindowSeconds))
            {
                current = MergePair(current, next);
            }
            else
            {
                merged.Add(current);
                current = next;
            }
        }

        merged.Add(current);
        return merged;
    }

    // TimelineSegment is init-only, so merging produces a new instance: the span
    // covers the first fragment's start through the last fragment's effective end,
    // durations are summed, and open state / close reason come from the last one.
    private static TimelineSegment MergePair(TimelineSegment first, TimelineSegment second)
    {
        return new TimelineSegment
        {
            StartedAtUtc = first.StartedAtUtc,
            EndedAtUtc = second.EndedAtUtc,
            IsOpen = second.IsOpen,
            ProcessName = first.ProcessName,
            DisplayName = string.IsNullOrWhiteSpace(second.DisplayName)
                ? first.DisplayName
                : second.DisplayName,
            TotalSeconds = first.TotalSeconds + second.TotalSeconds,
            ActiveSeconds = first.ActiveSeconds + second.ActiveSeconds,
            IdleSeconds = first.IdleSeconds + second.IdleSeconds,
            UnknownSeconds = first.UnknownSeconds + second.UnknownSeconds,
            CloseReason = second.CloseReason,
            SubSegments = TileSubSegments(first, second)
        };
    }

    // Concatenates both fragments' sub-segments; a positive hole between the
    // fragments becomes an inactive block, so sub-segments always tile the merged
    // segment exactly (boundaries shared, no gaps, no overlaps).
    private static IReadOnlyList<ActivitySubSegment> TileSubSegments(
        TimelineSegment first,
        TimelineSegment second)
    {
        var firstEnd = first.EndedAtUtc ?? first.StartedAtUtc;
        var hole = second.StartedAtUtc - firstEnd;
        if (hole <= TimeSpan.Zero)
        {
            return [.. first.SubSegments, .. second.SubSegments];
        }

        var subSegments = new List<ActivitySubSegment>(
            first.SubSegments.Count + second.SubSegments.Count + 1);
        subSegments.AddRange(first.SubSegments);
        subSegments.Add(new ActivitySubSegment
        {
            StartedAtUtc = firstEnd,
            EndedAtUtc = second.StartedAtUtc,
            IsActive = false
        });
        subSegments.AddRange(second.SubSegments);
        return subSegments;
    }

    private async Task<IReadOnlyList<ActivitySubSegment>> BuildSubSegmentsAsync(
        DateTime segmentStart,
        DateTime segmentEnd,
        long idleSeconds,
        long unknownSeconds,
        string processName,
        CancellationToken cancellationToken)
    {
        // Sessions with no idle/unknown time are entirely active — skip the query.
        if (idleSeconds <= 0 && unknownSeconds <= 0)
        {
            return [SingleActiveSubSegment(segmentStart, segmentEnd)];
        }

        IReadOnlyList<ForegroundSample> samples;
        try
        {
            samples = await _sampleQueryPort.GetSamplesForProcessInRangeAsync(
                segmentStart,
                segmentEnd,
                processName,
                ComputeSampleQueryLimit(segmentStart, segmentEnd),
                cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch
        {
            // If sample query fails, degrade to a single active segment.
            return [SingleActiveSubSegment(segmentStart, segmentEnd)];
        }

        if (samples.Count == 0)
        {
            return [SingleActiveSubSegment(segmentStart, segmentEnd)];
        }

        return GroupSamplesIntoSubSegments(samples, segmentStart, segmentEnd);
    }

    private static ActivitySubSegment SingleActiveSubSegment(DateTime segmentStart, DateTime segmentEnd) =>
        new()
        {
            StartedAtUtc = segmentStart,
            EndedAtUtc = segmentEnd,
            IsActive = true
        };

    // Samples are written at most once per second (default every 3s), so a duration-sized
    // limit keeps even a day-long session from being truncated mid-timeline; the cap only
    // guards pathological inputs. If truncation ever occurs, the last block still extends
    // to segmentEnd, so the track stays fully tiled (colored by the last observed state).
    private static int ComputeSampleQueryLimit(DateTime segmentStart, DateTime segmentEnd)
    {
        var durationSeconds = (long)Math.Max(0, (segmentEnd - segmentStart).TotalSeconds);
        return (int)Math.Clamp(durationSeconds + 600, MinSampleQueryLimit, MaxSampleQueryLimit);
    }

    /// <summary>
    /// Groups time-ordered samples into contiguous sub-segments of alternating
    /// active/idle state. Consecutive samples with the same effective activity
    /// state are merged; a state transition splits the block at the midpoint
    /// between the last sample of the previous state and the first sample of the
    /// next state, so sub-segments tile the session with no gaps or overlaps.
    /// </summary>
    private static IReadOnlyList<ActivitySubSegment> GroupSamplesIntoSubSegments(
        IReadOnlyList<ForegroundSample> samples,
        DateTime segmentStart,
        DateTime segmentEnd)
    {
        var subSegments = new List<ActivitySubSegment>();
        DateTime blockStart = segmentStart;
        DateTime previousSampleTime = segmentStart;
        bool? currentIsActive = null;

        foreach (var sample in samples)
        {
            var isActive = IsActiveState(sample.ActivityState);
            if (currentIsActive == null)
            {
                currentIsActive = isActive;
            }
            else if (currentIsActive.Value != isActive)
            {
                // State transition: split at the midpoint between the two samples so
                // consecutive blocks share their boundary exactly.
                var boundary = previousSampleTime + TimeSpan.FromTicks(
                    (sample.SampleTimeUtc - previousSampleTime).Ticks / 2);
                subSegments.Add(new ActivitySubSegment
                {
                    StartedAtUtc = blockStart,
                    EndedAtUtc = boundary,
                    IsActive = currentIsActive.Value
                });
                blockStart = boundary;
                currentIsActive = isActive;
            }

            previousSampleTime = sample.SampleTimeUtc;
        }

        // Close the last block.
        if (currentIsActive != null)
        {
            subSegments.Add(new ActivitySubSegment
            {
                StartedAtUtc = blockStart,
                EndedAtUtc = segmentEnd,
                IsActive = currentIsActive.Value
            });
        }

        // If we couldn't determine any state (shouldn't happen), create a single active segment.
        if (subSegments.Count == 0)
        {
            subSegments.Add(SingleActiveSubSegment(segmentStart, segmentEnd));
        }

        return subSegments;
    }

    private static bool IsActiveState(string activityState) =>
        string.Equals(activityState, "Active", StringComparison.OrdinalIgnoreCase);

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
