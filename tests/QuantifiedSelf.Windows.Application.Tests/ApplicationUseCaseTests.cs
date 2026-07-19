using QuantifiedSelf.Windows.ApplicationLayer.Analytics;
using QuantifiedSelf.Windows.Core.Models;

namespace QuantifiedSelf.Windows.Application.Tests;

[Trait("Category", "Fast")]
public sealed class ApplicationUseCaseTests
{
    [Fact]
    public void FocusMetricsCalculator_ComputesFocusWithoutDesktopRuntime()
    {
        var start = new DateTime(2026, 7, 16, 1, 0, 0, DateTimeKind.Utc);
        var samples = Enumerable.Range(0, 13)
            .Select(minute => new ForegroundSample
            {
                SampleTimeUtc = start.AddMinutes(minute),
                ProcessName = "Code",
                WindowTitle = "Program.cs",
                ActivityState = "Active"
            })
            .ToArray();

        var result = FocusMetricsCalculator.Compute(samples);

        Assert.Equal(1, result.FocusSessionCount);
        Assert.NotNull(result.LongestFocusSession);
        Assert.Equal(TimeSpan.FromMinutes(12), result.LongestFocusSession!.Duration);
    }

    [Fact]
    public void HourActivityHeatmapCalculator_EmptyInputReturnsCompleteMatrix()
    {
        var result = HourActivityHeatmapCalculator.Compute([], new DateOnly(2026, 7, 16));

        Assert.Equal(168, result.Count);
        Assert.All(result, point => Assert.Equal(0, point.ActiveSamples));
        Assert.Equal(0, result[0].Hour);
        Assert.Equal(23, result[^1].Hour);
    }

    [Fact]
    public void HourActivityHeatmapCalculator_BucketsIntensityLevelsWithSharedThresholds()
    {
        var today = new DateOnly(2026, 7, 16);
        var samples = new List<ForegroundSample>();
        AddActiveSamples(samples, today, hour: 0, count: 4); // busiest hour: intensity 1.00 → level 4
        AddActiveSamples(samples, today, hour: 1, count: 1); // intensity 0.25 → level 1
        AddActiveSamples(samples, today, hour: 2, count: 2); // intensity 0.50 → level 2
        AddActiveSamples(samples, today, hour: 3, count: 3); // intensity 0.75 → level 3

        var points = HourActivityHeatmapCalculator.Compute(samples, today);
        var dateStr = today.ToString("yyyy-MM-dd");

        Assert.Equal(4, points.Single(p => p.Date == dateStr && p.Hour == 0).IntensityLevel);
        Assert.Equal(1, points.Single(p => p.Date == dateStr && p.Hour == 1).IntensityLevel);
        Assert.Equal(2, points.Single(p => p.Date == dateStr && p.Hour == 2).IntensityLevel);
        Assert.Equal(3, points.Single(p => p.Date == dateStr && p.Hour == 3).IntensityLevel);
        // No samples: intensity 0 → level 0.
        Assert.Equal(0, points.Single(p => p.Date == dateStr && p.Hour == 4).IntensityLevel);
    }

    private static void AddActiveSamples(
        List<ForegroundSample> samples,
        DateOnly date,
        int hour,
        int count)
    {
        for (var i = 0; i < count; i++)
        {
            var localTime = date.ToDateTime(new TimeOnly(hour, i * 10), DateTimeKind.Local);
            samples.Add(new ForegroundSample
            {
                SampleTimeUtc = localTime.ToUniversalTime(),
                ActivityState = "Active"
            });
        }
    }

    [Fact]
    public void InsightSuggestionEngine_InsufficientDataReturnsNoSuggestion()
    {
        var result = InsightSuggestionEngine.Generate(
            new DailyActivitySummary
            {
                TotalActiveDurationSeconds = 599,
                SessionCount = 0
            },
            trend: null);

        Assert.Empty(result);
    }
}
