using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using QuantifiedSelf.Windows.ApplicationLayer.Contracts.Activity;
using QuantifiedSelf.Windows.Client;
using QuantifiedSelf.Windows.Client.Startup;
using QuantifiedSelf.Windows.Core.Models;

return await ActivityParityProgram.RunAsync(args);

internal static class ActivityParityProgram
{
    private const string ApiVersion = "1.0";
    private const string ChannelName = "dev";

    public static async Task<int> RunAsync(string[] args)
    {
        var options = Options.Parse(args);
        if (options is null)
        {
            Console.Error.WriteLine("Usage: activity-parity --bridge <path> [--report <path>]");
            return 2;
        }

        var reportPath = options.ReportPath ?? CreateDefaultReportPath();
        var checks = new List<ParityCheck>();
        try
        {
            var launchOptions = StartupLaunchOptions.Parse(["--channel", ChannelName]);
            await using var client = WujiClientFactory.Create(
                WujiClientOptions.FromLaunchOptions(launchOptions));
            await client.InitializeAsync();

            var status = await client.Agent.Status.GetStatusAsync();
            if (status.IsRunning)
            {
                Console.Error.WriteLine("[BLOCKED] dev Agent 正在运行。请先显式停止 Agent，再重试 parity。 ");
                return 3;
            }

            var today = DateOnly.FromDateTime(DateTime.Now);
            var todayText = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

            var readStartUtc = DateTime.UtcNow;
            var wpfDaily = await client.Activity.DailyStats.GetSummaryForDateAsync(today);
            var wpfTrend = await client.Activity.WeeklyTrend.GetWeeklyTrendAsync();
            var wpfTimeline = await client.Activity.Timeline.GetTimelineAsync(today);
            var wpfHeatmap = await client.Activity.Heatmap.GetHeatmapAsync();

            await using var bridge = await BridgeSession.StartAsync(options.BridgePath);
            var initialization = await bridge.RequestAsync("client.initialize");
            var bridgeChannel = initialization.GetProperty("channelName").GetString();
            var isDefaultChannel = initialization.GetProperty("isDefaultChannel").GetBoolean();
            Add(checks, "dev channel 固定", bridgeChannel == ChannelName && !isDefaultChannel, "channel=dev, non-default");

            var daily = await bridge.RequestAsync("activity.getDailyStats", new { date = todayText });
            var trend = await bridge.RequestAsync("activity.getWeeklyTrend");
            var timeline = await bridge.RequestAsync("activity.getTimeline", new { date = todayText });
            var heatmap = await bridge.RequestAsync("activity.getHeatmap");
            var readEndUtc = DateTime.UtcNow;

            // Open sessions are clipped to "now" on both paths; the sequential WPF/Bridge
            // reads can therefore drift by the elapsed wall time. Mirror DashboardParity's
            // exact comparison everywhere else and tolerate only that measured drift.
            var hasOpenTodaySegment = wpfTimeline.Segments.Any(segment => segment.IsOpen);
            var driftToleranceSeconds = hasOpenTodaySegment
                ? (long)Math.Ceiling((readEndUtc - readStartUtc).TotalSeconds) + 2
                : 0;
            Add(checks, "浮动原点容差标定", true,
                hasOpenTodaySegment
                    ? $"存在未关闭会话，now 派生时长容差=±{driftToleranceSeconds}s"
                    : "无未关闭会话，全部数值精确比对");

            CompareDailyStats(checks, wpfDaily, daily, today, todayText, driftToleranceSeconds);
            CompareWeeklyTrend(checks, wpfTrend, trend, today, driftToleranceSeconds);
            CompareTimeline(checks, wpfTimeline, timeline, today, todayText, driftToleranceSeconds);
            CompareHeatmap(checks, wpfHeatmap, heatmap, today, todayText);
            CheckPrivacy(checks, "activity.getDailyStats", daily);
            CheckPrivacy(checks, "activity.getWeeklyTrend", trend);
            CheckPrivacy(checks, "activity.getTimeline", timeline);
            CheckPrivacy(checks, "activity.getHeatmap", heatmap);

            await bridge.ShutdownAsync();
            await WriteReportAsync(reportPath, checks, wpfDaily, daily, wpfTimeline, timeline, heatmap);

            foreach (var check in checks)
            {
                Console.WriteLine($"[{(check.Passed ? "PASS" : "FAIL")}] {check.Name}: {check.Detail}");
            }

            Console.WriteLine($"报告已写入：{reportPath}");
            return checks.All(check => check.Passed) ? 0 : 1;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"[FAIL] parity probe 未完成（{exception.GetType().Name}）。");
            return 1;
        }
    }

    private static void CompareDailyStats(
        ICollection<ParityCheck> checks,
        DailyActivitySummary wpf,
        JsonElement tauri,
        DateOnly today,
        string todayText,
        long toleranceSeconds)
    {
        var dateMatches = string.Equals(tauri.GetProperty("date").GetString(), todayText, StringComparison.Ordinal)
            && tauri.GetProperty("isToday").GetBoolean()
            && DateOnly.FromDateTime(wpf.Date) == today;
        Add(checks, "今日统计日期与标记", dateMatches, $"localDate={todayText}, isToday=true");

        var tauriTotal = tauri.GetProperty("totalSeconds").GetInt64();
        var tauriActive = tauri.GetProperty("activeSeconds").GetInt64();
        var tauriIdle = tauri.GetProperty("idleSeconds").GetInt64();
        var tauriUnknown = tauri.GetProperty("unknownSeconds").GetInt64();
        var wpfUnknown = Math.Max(0, wpf.TotalDurationSeconds - wpf.TotalActiveDurationSeconds - wpf.TotalIdleDurationSeconds);
        var totalsMatch = NearlyEqual(wpf.TotalDurationSeconds, tauriTotal, toleranceSeconds)
            && NearlyEqual(wpf.TotalActiveDurationSeconds, tauriActive, toleranceSeconds)
            && NearlyEqual(wpf.TotalIdleDurationSeconds, tauriIdle, toleranceSeconds)
            && NearlyEqual(wpfUnknown, tauriUnknown, toleranceSeconds);
        Add(checks, "今日统计总时长", totalsMatch,
            $"total={tauriTotal}s, active={tauriActive}s, idle={tauriIdle}s, unknown={tauriUnknown}s, 容差=±{toleranceSeconds}s");

        var tauriSessions = tauri.GetProperty("sessionCount").GetInt64();
        var tauriSamples = tauri.GetProperty("sampleCount").GetInt64();
        Add(checks, "今日会话与样本计数",
            wpf.SessionCount == tauriSessions && wpf.SampleCount == tauriSamples,
            $"sessions={tauriSessions}, samples={tauriSamples}");

        var wpfHours = wpf.HourlyActivity.ToDictionary(bucket => bucket.Hour);
        var hours = tauri.GetProperty("hours").EnumerateArray().ToArray();
        var hoursMatch = hours.Length == 24;
        for (var hour = 0; hoursMatch && hour < 24; hour++)
        {
            var bucket = hours[hour];
            var wpfBucket = wpfHours[hour];
            hoursMatch = bucket.GetProperty("hour").GetInt32() == hour
                && RoundSeconds(wpfBucket.ActiveSeconds) == bucket.GetProperty("activeSeconds").GetInt64()
                && RoundSeconds(wpfBucket.IdleSeconds) == bucket.GetProperty("idleSeconds").GetInt64()
                && RoundSeconds(wpfBucket.UnknownSeconds) == bucket.GetProperty("unknownSeconds").GetInt64();
        }

        Add(checks, "今日 24 小时分桶", hoursMatch, $"buckets={hours.Length}, 样本派生数值精确比对");
    }

    private static void CompareWeeklyTrend(
        ICollection<ParityCheck> checks,
        WeeklyTrendResult wpf,
        JsonElement tauri,
        DateOnly today,
        long toleranceSeconds)
    {
        var days = tauri.GetProperty("days").EnumerateArray().ToArray();
        var daysMatch = wpf.Days.Count == 7 && days.Length == 7;
        for (var index = 0; daysMatch && index < 7; index++)
        {
            var expectedDate = today.AddDays(index - 6);
            var expectedText = expectedDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            var left = wpf.Days[index];
            var right = days[index];
            var isToday = index == 6;
            daysMatch = DateOnly.FromDateTime(left.Date) == expectedDate
                && string.Equals(right.GetProperty("date").GetString(), expectedText, StringComparison.Ordinal)
                && right.GetProperty("isToday").GetBoolean() == isToday
                && NearlyEqual(left.ActiveSeconds, right.GetProperty("activeSeconds").GetInt64(),
                    isToday ? toleranceSeconds : 0)
                && left.SessionCount == right.GetProperty("sessionCount").GetInt64()
                && NearlyEqual(left.FocusSeconds, right.GetProperty("focusSeconds").GetInt64(),
                    isToday ? toleranceSeconds : 0)
                && left.ContextSwitchCount == right.GetProperty("contextSwitchCount").GetInt64()
                && string.Equals(
                    ToSafeTopAppName(left.TopAppName),
                    right.GetProperty("topAppName").GetString(),
                    StringComparison.Ordinal);
        }

        Add(checks, "近 7 日趋势逐日数值", daysMatch, $"days={days.Length}, 日期升序且末日为今天");

        var wpfAverage = RoundSeconds(wpf.AverageActiveSeconds);
        var tauriAverage = tauri.GetProperty("averageActiveSeconds").GetInt64();
        Add(checks, "趋势平均有效时长", NearlyEqual(wpfAverage, tauriAverage, toleranceSeconds),
            $"WPF={wpfAverage}s, Tauri={tauriAverage}s, 容差=±{toleranceSeconds}s");

        var textsMatch = string.Equals(
                wpf.ActiveComparisonText, tauri.GetProperty("comparisonToAverageText").GetString(), StringComparison.Ordinal)
            && string.Equals(
                wpf.YesterdayActiveComparisonText, tauri.GetProperty("comparisonToYesterdayText").GetString(), StringComparison.Ordinal)
            && string.Equals(
                wpf.WeekActiveComparisonText, tauri.GetProperty("weekToDateText").GetString(), StringComparison.Ordinal);
        Add(checks, "趋势三段中文比较文案", textsMatch, "3 段文案逐字比对");
    }

    private static void CompareTimeline(
        ICollection<ParityCheck> checks,
        TimelineResult wpf,
        JsonElement tauri,
        DateOnly today,
        string todayText,
        long toleranceSeconds)
    {
        var dateMatches = wpf.Date == today
            && wpf.IsToday
            && string.Equals(tauri.GetProperty("date").GetString(), todayText, StringComparison.Ordinal)
            && tauri.GetProperty("isToday").GetBoolean();
        Add(checks, "今日时间线日期与标记", dateMatches, $"localDate={todayText}, isToday=true");

        var rawSessionCount = tauri.GetProperty("rawSessionCount").GetInt64();
        Add(checks, "今日时间线合并前段数", wpf.RawSegmentCount == rawSessionCount,
            $"WPF={wpf.RawSegmentCount}, Tauri={rawSessionCount}, 精确比对");

        var sessions = tauri.GetProperty("sessions").EnumerateArray().ToArray();
        var sessionsMatch = wpf.Segments.Count == sessions.Length;
        for (var index = 0; sessionsMatch && index < wpf.Segments.Count; index++)
        {
            var left = wpf.Segments[index];
            var right = sessions[index];
            var tolerance = left.IsOpen ? toleranceSeconds : 0;
            var rightEnd = right.TryGetProperty("endedAtUtc", out var endedAt)
                ? ParseUtc(endedAt.GetString()!)
                : (DateTime?)null;
            sessionsMatch = string.Equals(
                    ToSafeAppName(left.DisplayName, left.ProcessName),
                    right.GetProperty("appName").GetString(),
                    StringComparison.Ordinal)
                && left.StartedAtUtc.ToUniversalTime() == ParseUtc(right.GetProperty("startedAtUtc").GetString()!)
                && NearlyEqual(left.EndedAtUtc?.ToUniversalTime(), rightEnd, tolerance)
                && left.IsOpen == right.GetProperty("isOpen").GetBoolean()
                && NearlyEqual(left.TotalSeconds, right.GetProperty("totalSeconds").GetInt64(), tolerance)
                && NearlyEqual(left.ActiveSeconds, right.GetProperty("activeSeconds").GetInt64(), tolerance)
                && NearlyEqual(left.IdleSeconds, right.GetProperty("idleSeconds").GetInt64(), tolerance)
                && NearlyEqual(left.UnknownSeconds, right.GetProperty("unknownSeconds").GetInt64(), tolerance)
                && string.Equals(
                    ToCloseReason(left.CloseReason),
                    right.GetProperty("closeReason").GetString(),
                    StringComparison.Ordinal);
        }

        Add(checks, "今日时间线会话逐段一致", sessionsMatch,
            $"sessions={sessions.Length}, 未关闭段容差=±{toleranceSeconds}s");

        var gaps = tauri.GetProperty("gaps").EnumerateArray().ToArray();
        var gapsMatch = wpf.Gaps.Count == gaps.Length;
        // Gaps skip zero-length intervals, so gap indexes do not align with segment
        // indexes. A gap starts at the effective end of the latest segment that does
        // not start after it; only an open preceding segment lets that origin float.
        var orderedSegments = wpf.Segments.OrderBy(segment => segment.StartedAtUtc).ToArray();
        for (var index = 0; gapsMatch && index < wpf.Gaps.Count; index++)
        {
            var left = wpf.Gaps[index];
            var right = gaps[index];
            var preceding = orderedSegments.LastOrDefault(segment =>
                segment.StartedAtUtc.ToUniversalTime() <= left.StartedAtUtc.ToUniversalTime());
            var tolerance = preceding?.IsOpen == true ? toleranceSeconds : 0;
            var rightStart = ParseUtc(right.GetProperty("startedAtUtc").GetString()!);
            gapsMatch = NearlyEqual(left.StartedAtUtc.ToUniversalTime(), rightStart, tolerance)
                && left.EndedAtUtc.ToUniversalTime() == ParseUtc(right.GetProperty("endedAtUtc").GetString()!)
                && NearlyEqual(left.DurationSeconds, right.GetProperty("durationSeconds").GetInt64(), tolerance);
        }

        Add(checks, "今日时间线空档逐段一致", gapsMatch, $"gaps={gaps.Length}");

        var subSegmentsMatch = wpf.Segments.Count == sessions.Length;
        var subSegmentCount = 0;
        for (var index = 0; subSegmentsMatch && index < wpf.Segments.Count; index++)
        {
            var left = wpf.Segments[index];
            var rightSubSegments = sessions[index].GetProperty("subSegments").EnumerateArray().ToArray();
            subSegmentCount += rightSubSegments.Length;
            // Sub-segment boundaries derive from sample times (static), but the last
            // block of an open session ends at "now" — same drift as the session end.
            var tolerance = left.IsOpen ? toleranceSeconds : 0;
            subSegmentsMatch = left.SubSegments.Count == rightSubSegments.Length;
            for (var sub = 0; subSegmentsMatch && sub < left.SubSegments.Count; sub++)
            {
                var leftSub = left.SubSegments[sub];
                var rightSub = rightSubSegments[sub];
                subSegmentsMatch = NearlyEqual(
                        leftSub.StartedAtUtc.ToUniversalTime(),
                        ParseUtc(rightSub.GetProperty("startedAtUtc").GetString()!),
                        tolerance)
                    && NearlyEqual(
                        leftSub.EndedAtUtc.ToUniversalTime(),
                        ParseUtc(rightSub.GetProperty("endedAtUtc").GetString()!),
                        tolerance)
                    && leftSub.IsActive == rightSub.GetProperty("isActive").GetBoolean();
            }
        }

        Add(checks, "今日时间线子段逐段一致", subSegmentsMatch,
            $"subSegments={subSegmentCount}, 未关闭段容差=±{toleranceSeconds}s");
    }

    private static void CompareHeatmap(
        ICollection<ParityCheck> checks,
        HourActivityHeatmapResult wpf,
        JsonElement tauri,
        DateOnly today,
        string todayText)
    {
        var todayMatches = wpf.Today == today
            && string.Equals(tauri.GetProperty("today").GetString(), todayText, StringComparison.Ordinal);
        Add(checks, "热力图今日标记", todayMatches, $"today={todayText}");

        var cells = tauri.GetProperty("cells").EnumerateArray().ToArray();
        var cellsMatch = wpf.Points.Count == 168 && cells.Length == 168;
        for (var index = 0; cellsMatch && index < 168; index++)
        {
            var left = wpf.Points[index];
            var right = cells[index];
            var expectedDate = today.AddDays(index / 24 - 6).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            var expectedRatioPercent = Math.Clamp(
                (int)Math.Round(left.ActiveRatio * 100, MidpointRounding.AwayFromZero),
                0,
                100);
            cellsMatch = string.Equals(left.Date, expectedDate, StringComparison.Ordinal)
                && string.Equals(right.GetProperty("date").GetString(), expectedDate, StringComparison.Ordinal)
                && left.Hour == index % 24
                && right.GetProperty("hour").GetInt32() == index % 24
                && left.ActiveSamples == right.GetProperty("activeSamples").GetInt64()
                && left.IdleSamples == right.GetProperty("idleSamples").GetInt64()
                && left.UnknownSamples == right.GetProperty("unknownSamples").GetInt64()
                && left.IntensityLevel == right.GetProperty("intensityLevel").GetInt32()
                && expectedRatioPercent == right.GetProperty("activeRatioPercent").GetInt32();
        }

        Add(checks, "热力图 168 单元格", cellsMatch, $"cells={cells.Length}, 日期升序×小时升序精确比对");
    }

    private static void CheckPrivacy(ICollection<ParityCheck> checks, string method, JsonElement response)
    {
        // closeReason is an approved safe enum on the timeline contract; every other
        // identity/path member stays forbidden, same as DashboardParity.
        string[] forbiddenProperties =
        [
            "id", "processName", "windowTitle", "executablePath", "databasePath",
            "dataRoot", "pipeName", "exception", "stackTrace"
        ];
        var propertyNames = EnumeratePropertyNames(response).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var safeProperties = forbiddenProperties.All(property => !propertyNames.Contains(property));
        var safeStrings = EnumerateStrings(response).All(value =>
            !value.Contains(@":\", StringComparison.Ordinal)
            && !value.Contains(@"\\", StringComparison.Ordinal)
            && !value.Contains("/Users/", StringComparison.OrdinalIgnoreCase)
            && !value.Contains("/home/", StringComparison.OrdinalIgnoreCase));
        Add(checks, $"隐私字段 allowlist（{method}）", safeProperties && safeStrings,
            "无 id/process/window/path/database/exception 字段或路径形态字符串");
    }

    private static IEnumerable<string> EnumeratePropertyNames(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                yield return property.Name;
                foreach (var nested in EnumeratePropertyNames(property.Value)) yield return nested;
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray())
            {
                foreach (var nested in EnumeratePropertyNames(item)) yield return nested;
            }
        }
    }

    private static IEnumerable<string> EnumerateStrings(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.String)
        {
            yield return element.GetString() ?? string.Empty;
        }
        else if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                foreach (var nested in EnumerateStrings(property.Value)) yield return nested;
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray())
            {
                foreach (var nested in EnumerateStrings(item)) yield return nested;
            }
        }
    }

    private static async Task WriteReportAsync(
        string reportPath,
        IReadOnlyList<ParityCheck> checks,
        DailyActivitySummary wpfDaily,
        JsonElement daily,
        TimelineResult wpfTimeline,
        JsonElement timeline,
        JsonElement heatmap)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(reportPath)!);
        var builder = new StringBuilder()
            .AppendLine("# Tauri Activity dev parity")
            .AppendLine()
            .AppendLine($"- 执行时间：{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss zzz}")
            .AppendLine("- channel：dev（非默认通道）")
            .AppendLine("- 数据条件：dev Agent 已停止，WPF 与 Tauri 顺序读取同一数据库")
            .AppendLine()
            .AppendLine("## 数据摘要")
            .AppendLine()
            .AppendLine("| 指标 | WPF | Tauri |")
            .AppendLine("|---|---:|---:|")
            .AppendLine($"| 今日总时长（秒） | {wpfDaily.TotalDurationSeconds} | {daily.GetProperty("totalSeconds").GetInt64()} |")
            .AppendLine($"| 今日有效时长（秒） | {wpfDaily.TotalActiveDurationSeconds} | {daily.GetProperty("activeSeconds").GetInt64()} |")
            .AppendLine($"| 今日会话数 | {wpfDaily.SessionCount} | {daily.GetProperty("sessionCount").GetInt64()} |")
            .AppendLine($"| 今日样本数 | {wpfDaily.SampleCount} | {daily.GetProperty("sampleCount").GetInt64()} |")
            .AppendLine($"| 时间线会话段数 | {wpfTimeline.Segments.Count} | {timeline.GetProperty("sessions").GetArrayLength()} |")
            .AppendLine($"| 时间线空档数 | {wpfTimeline.Gaps.Count} | {timeline.GetProperty("gaps").GetArrayLength()} |")
            .AppendLine($"| 热力图单元格数 | 168 | {heatmap.GetProperty("cells").GetArrayLength()} |")
            .AppendLine()
            .AppendLine("## 验收项")
            .AppendLine()
            .AppendLine("| 验收项 | 结果 | 说明 |")
            .AppendLine("|---|---|---|");

        foreach (var check in checks)
        {
            builder.AppendLine($"| {check.Name} | {(check.Passed ? "PASS" : "FAIL")} | {check.Detail} |");
        }

        await File.WriteAllTextAsync(reportPath, builder.ToString(), new UTF8Encoding(false));
    }

    private static DateTime ParseUtc(string value) =>
        DateTime.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind).ToUniversalTime();

    private static long RoundSeconds(double value) =>
        Math.Max(0, (long)Math.Round(value, MidpointRounding.AwayFromZero));

    private static bool NearlyEqual(long left, long right, long toleranceSeconds) =>
        Math.Abs(left - right) <= toleranceSeconds;

    private static bool NearlyEqual(DateTime? left, DateTime? right, long toleranceSeconds)
    {
        if (left is null || right is null)
        {
            return left is null && right is null;
        }

        return Math.Abs((left.Value - right.Value).TotalSeconds) <= toleranceSeconds;
    }

    // Mirrors BridgeActivityMapper.ToSafeAppName/ToSafeDisplayName so the expected
    // value is derived through the same sanitization rules, not reimplemented loosely.
    private static string ToSafeAppName(string? displayName, string? processName) =>
        string.IsNullOrWhiteSpace(displayName)
            ? ToSafeDisplayName(processName)
            : ToSafeDisplayName(displayName);

    private static string ToSafeTopAppName(string? value) =>
        string.IsNullOrWhiteSpace(value) ? string.Empty : ToSafeDisplayName(value);

    private static string ToSafeDisplayName(string? value)
    {
        const int maxDisplayNameLength = 128;
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

        return displayName.Length <= maxDisplayNameLength
            ? displayName
            : displayName[..maxDisplayNameLength];
    }

    // Mirrors BridgeActivityMapper.ToCloseReason.
    private static string ToCloseReason(string? value)
    {
        if (string.Equals(value, "Open", StringComparison.OrdinalIgnoreCase))
        {
            return "open";
        }

        if (string.Equals(value, "ProcessChanged", StringComparison.OrdinalIgnoreCase))
        {
            return "process_changed";
        }

        if (string.Equals(value, "Paused", StringComparison.OrdinalIgnoreCase))
        {
            return "paused";
        }

        if (string.Equals(value, "Stopped", StringComparison.OrdinalIgnoreCase))
        {
            return "stopped";
        }

        return "other";
    }

    private static void Add(ICollection<ParityCheck> checks, string name, bool passed, string detail) =>
        checks.Add(new ParityCheck(name, passed, detail));

    private static string CreateDefaultReportPath() => Path.Combine(
        Path.GetTempPath(),
        "WUJI.Smoke",
        $"activity-parity-{DateTime.Now:yyyyMMdd-HHmmss}.md");

    private sealed record ParityCheck(string Name, bool Passed, string Detail);

    private sealed record Options(string BridgePath, string? ReportPath)
    {
        public static Options? Parse(IReadOnlyList<string> args)
        {
            string? bridge = null;
            string? report = null;
            for (var index = 0; index < args.Count; index++)
            {
                switch (args[index])
                {
                    case "--bridge" when index + 1 < args.Count:
                        bridge = Path.GetFullPath(args[++index]);
                        break;
                    case "--report" when index + 1 < args.Count:
                        report = Path.GetFullPath(args[++index]);
                        break;
                }
            }

            return bridge is not null && File.Exists(bridge) ? new Options(bridge, report) : null;
        }
    }
}

internal sealed class BridgeSession : IAsyncDisposable
{
    private readonly Process _process;
    private readonly StreamWriter _input;
    private readonly StreamReader _output;
    private bool _shutdown;

    private BridgeSession(Process process)
    {
        _process = process;
        _input = process.StandardInput;
        _output = process.StandardOutput;
        _ = DrainDiagnosticsAsync(process.StandardError);
    }

    public static async Task<BridgeSession> StartAsync(string path)
    {
        var startInfo = new ProcessStartInfo(path)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        startInfo.ArgumentList.Add("--channel");
        startInfo.ArgumentList.Add("dev");
        var process = Process.Start(startInfo) ?? throw new InvalidOperationException("Bridge did not start.");
        var session = new BridgeSession(process);
        var hello = await session.RequestAsync("bridge.hello");
        string[] requiredCapabilities =
        [
            "activity.getDailyStats",
            "activity.getWeeklyTrend",
            "activity.getTimeline",
            "activity.getHeatmap"
        ];
        var capabilities = hello.GetProperty("capabilities").EnumerateArray()
            .Select(item => item.GetString())
            .ToHashSet(StringComparer.Ordinal);
        if (!requiredCapabilities.All(capabilities.Contains))
        {
            await session.DisposeAsync();
            throw new InvalidOperationException("Bridge capability mismatch.");
        }

        return session;
    }

    public Task<JsonElement> RequestAsync(string method) => RequestAsync(method, null);

    public async Task<JsonElement> RequestAsync(string method, object? parameters)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var id = Guid.NewGuid().ToString("N");
        var request = JsonSerializer.Serialize(new
        {
            jsonrpc = "2.0",
            id,
            method,
            @params = parameters ?? new { },
            meta = new { apiVersion = "1.0", correlationId = id }
        });
        await _input.WriteLineAsync(request.AsMemory(), timeout.Token);
        await _input.FlushAsync(timeout.Token);
        var line = await _output.ReadLineAsync(timeout.Token)
            ?? throw new EndOfStreamException("Bridge response ended.");
        using var document = JsonDocument.Parse(line);
        var root = document.RootElement;
        if (root.GetProperty("id").GetString() != id)
        {
            throw new InvalidOperationException("Bridge response id mismatch.");
        }

        if (root.TryGetProperty("error", out var error))
        {
            var code = error.TryGetProperty("code", out var codeValue)
                ? codeValue.GetString()
                : "unknown";
            throw new InvalidOperationException($"Bridge returned {code}.");
        }

        return root.GetProperty("result").Clone();
    }

    public async Task ShutdownAsync()
    {
        if (_shutdown) return;
        _shutdown = true;
        _ = await RequestAsync("bridge.shutdown");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await _process.WaitForExitAsync(timeout.Token);
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            if (!_shutdown && !_process.HasExited) await ShutdownAsync();
        }
        catch
        {
            if (!_process.HasExited) _process.Kill(entireProcessTree: true);
        }
        finally
        {
            _input.Dispose();
            _output.Dispose();
            _process.Dispose();
        }
    }

    private static async Task DrainDiagnosticsAsync(StreamReader error)
    {
        while (await error.ReadLineAsync() is not null)
        {
            // Bridge stderr contains diagnostics only. The parity report intentionally omits it.
        }
    }
}
