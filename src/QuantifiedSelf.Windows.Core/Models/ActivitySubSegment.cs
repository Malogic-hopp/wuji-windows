namespace QuantifiedSelf.Windows.Core.Models;

/// <summary>
/// A contiguous time block within a timeline session, classified as active or idle.
/// Used to split a single session into alternating active/idle sub-segments on the
/// 24-hour track so that long idle periods are visually distinguishable from active use.
/// </summary>
public sealed class ActivitySubSegment
{
    public DateTime StartedAtUtc { get; init; }

    public DateTime EndedAtUtc { get; init; }

    /// <summary>
    /// true = the user was actively interacting (Active samples);
    /// false = idle or unknown (Idle/Unknown samples).
    /// </summary>
    public bool IsActive { get; init; }
}
