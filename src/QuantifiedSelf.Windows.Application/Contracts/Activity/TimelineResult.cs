namespace QuantifiedSelf.Windows.ApplicationLayer.Contracts.Activity;

/// <summary>
/// Framework-independent timeline for one local day. Sessions are clipped to the
/// local-day bounds, sorted ascending by start, and the gaps between consecutive
/// segments are precomputed so callers never derive day boundaries or effective
/// ends themselves.
/// </summary>
public sealed class TimelineResult
{
    public DateOnly Date { get; init; }

    public bool IsToday { get; init; }

    public IReadOnlyList<TimelineSegment> Segments { get; init; } = [];

    public IReadOnlyList<TimelineGap> Gaps { get; init; } = [];
}

/// <summary>
/// One session's in-day portion on the timeline. Intentionally carries no window
/// title, executable path, or session id. <see cref="EndedAtUtc"/> is the clipped
/// effective end (TimeProvider now for open sessions today, day end for open
/// sessions on past dates); <see cref="IsOpen"/> reports whether the underlying
/// session is still open.
/// </summary>
public sealed class TimelineSegment
{
    public DateTime StartedAtUtc { get; init; }

    public DateTime? EndedAtUtc { get; init; }

    public bool IsOpen { get; init; }

    public string ProcessName { get; init; } = string.Empty;

    public string DisplayName { get; init; } = string.Empty;

    public long TotalSeconds { get; init; }

    public long ActiveSeconds { get; init; }

    public long IdleSeconds { get; init; }

    public long UnknownSeconds { get; init; }

    public string CloseReason { get; init; } = string.Empty;

    /// <summary>
    /// Time-ordered sub-segments that partition this session into alternating
    /// active and idle blocks on the 24-hour track. A session with no idle time
    /// will have a single <see cref="ActivitySubSegment"/> with <c>IsActive=true</c>.
    /// Blocks tile the session exactly (transition boundaries sit at the midpoint
    /// between the samples of differing state), with no gaps or overlaps.
    /// </summary>
    public IReadOnlyList<QuantifiedSelf.Windows.Core.Models.ActivitySubSegment> SubSegments { get; init; } = [];
}

/// <summary>
/// An idle/untracked interval between two consecutive timeline segments
/// (agent paused, stopped, or not running). Gaps are never fabricated at
/// the start or end of the day.
/// </summary>
public sealed class TimelineGap
{
    public DateTime StartedAtUtc { get; init; }

    public DateTime EndedAtUtc { get; init; }

    public long DurationSeconds { get; init; }
}
