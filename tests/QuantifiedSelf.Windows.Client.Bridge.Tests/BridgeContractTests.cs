using System.Text.Json;
using QuantifiedSelf.Windows.Bridge.ContractGen;
using QuantifiedSelf.Windows.Client.Bridge.Generated;

namespace QuantifiedSelf.Windows.Client.Bridge.Tests;

[Trait("Category", "Fast")]
public sealed class BridgeContractTests
{
    private static readonly string[] UiAssemblyNames =
    [
        "PresentationCore",
        "PresentationFramework",
        "WindowsBase",
        "System.Windows.Forms",
        "LiveChartsCore",
        "LiveChartsCore.SkiaSharpView.WPF",
        "SkiaSharp"
    ];

    [Fact]
    public void BridgeAssembly_ReferencesNoDesktopUiFrameworks()
    {
        var references = typeof(BridgeHost).Assembly
            .GetReferencedAssemblies()
            .Select(name => name.Name)
            .Where(name => name is not null)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var uiAssemblyName in UiAssemblyNames)
        {
            Assert.DoesNotContain(uiAssemblyName, references);
        }
    }

    [Fact]
    public void GeneratedArtifacts_MatchCanonicalSchema()
    {
        var drift = ContractGenerator.FindDrift(FindRepositoryRoot());

        Assert.Empty(drift);
    }

    [Fact]
    public void Schema_ContainsStageFiveAMethodsAndStableErrors()
    {
        var schemaPath = Path.Combine(
            FindRepositoryRoot(),
            "contracts",
            "wuji-bridge",
            "v1",
            "bridge.schema.json");
        using var document = JsonDocument.Parse(File.ReadAllText(schemaPath));
        var root = document.RootElement;

        Assert.Equal("1.0", root.GetProperty("x-wuji-api-version").GetString());
        Assert.Equal(
            [
                "bridge.hello",
                "client.initialize",
                "agent.getStatus",
                "agent.start",
                "agent.pause",
                "agent.resume",
                "agent.stop",
                "activity.getOverview",
                "activity.getDailyStats",
                "activity.getWeeklyTrend",
                "activity.getTimeline",
                "activity.getHeatmap",
                "settings.get",
                "settings.update",
                "bridge.shutdown"
            ],
            root.GetProperty("x-wuji-methods")
                .EnumerateArray()
                .Select(value => value.GetString())
                .ToArray());
        Assert.Contains(
            "request_timeout",
            root.GetProperty("x-wuji-error-codes")
                .EnumerateArray()
                .Select(value => value.GetString()));
        Assert.Contains(
            "initialization_required",
            root.GetProperty("x-wuji-error-codes")
                .EnumerateArray()
                .Select(value => value.GetString()));
        Assert.Contains(
            "validation_failed",
            root.GetProperty("x-wuji-error-codes")
                .EnumerateArray()
                .Select(value => value.GetString()));
    }

    [Fact]
    public void AgentContracts_ExposeOnlyApprovedSafeFields()
    {
        Assert.Equal(
            ["ActualState", "IsHealthy", "IsRunning", "IsStale", "LastHeartbeatUtc", "LastSampleUtc"],
            typeof(AgentStatus).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.Equal(
            ["Accepted", "ActualState", "Completed", "ErrorCode", "Message", "UsedFallback"],
            typeof(CommandResult).GetProperties().Select(property => property.Name).Order().ToArray());

        var generatedSource = File.ReadAllText(Path.Combine(
            FindRepositoryRoot(),
            "src",
            "QuantifiedSelf.Windows.Client.Bridge",
            "Generated",
            "BridgeContracts.g.cs"));
        string[] forbiddenFields =
        [
            "MachineName",
            "UserName",
            "ProcessId",
            "FullPipeName",
            "ExecutablePath",
            "DatabasePath",
            "DataRoot"
        ];

        foreach (var forbiddenField in forbiddenFields)
        {
            Assert.DoesNotContain(forbiddenField, generatedSource, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void ActivityOverviewContracts_ExposeOnlyApprovedDashboardFields()
    {
        Assert.Equal(
            ["ActiveDurationSeconds", "DateUtc", "IdleDurationSeconds", "SessionCount", "TotalDurationSeconds", "UnknownDurationSeconds"],
            typeof(ActivityOverviewSummary).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.Equal(
            ["ActiveDurationSeconds", "DisplayName", "IdleDurationSeconds", "LastUsedAtUtc", "SessionCount", "TotalDurationSeconds", "UnknownDurationSeconds"],
            typeof(ActivityOverviewApp).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.Equal(
            ["ActiveDurationSeconds", "DisplayName", "EndedAtUtc", "IdleDurationSeconds", "StartedAtUtc", "TotalDurationSeconds", "UnknownDurationSeconds"],
            typeof(ActivityOverviewSession).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.Equal(
            ["RecentSessions", "Summary", "TopApps"],
            typeof(ActivityOverviewResult).GetProperties().Select(property => property.Name).Order().ToArray());

        var activityContractSource = string.Join(
            Environment.NewLine,
            typeof(ActivityOverviewSummary).GetProperties().Select(property => property.Name)
                .Concat(typeof(ActivityOverviewApp).GetProperties().Select(property => property.Name))
                .Concat(typeof(ActivityOverviewSession).GetProperties().Select(property => property.Name)));
        string[] forbiddenFields =
        [
            "WindowTitle",
            "ProcessName",
            "DatabasePath",
            "DataRoot",
            "ExecutablePath",
            "Exception",
            "StackTrace"
        ];

        foreach (var forbiddenField in forbiddenFields)
        {
            Assert.DoesNotContain(forbiddenField, activityContractSource, StringComparison.OrdinalIgnoreCase);
        }

        var schemaPath = Path.Combine(
            FindRepositoryRoot(),
            "contracts",
            "wuji-bridge",
            "v1",
            "bridge.schema.json");
        using var schema = JsonDocument.Parse(File.ReadAllText(schemaPath));
        var definitions = schema.RootElement.GetProperty("$defs");
        Assert.Equal(
            128,
            definitions.GetProperty("ActivityOverviewApp")
                .GetProperty("properties")
                .GetProperty("displayName")
                .GetProperty("maxLength")
                .GetInt32());
        Assert.Equal(
            0,
            definitions.GetProperty("ActivityOverviewSummary")
                .GetProperty("properties")
                .GetProperty("totalDurationSeconds")
                .GetProperty("minimum")
                .GetInt32());
        Assert.Equal(
            "date-time",
            definitions.GetProperty("ActivityOverviewSession")
                .GetProperty("properties")
                .GetProperty("startedAtUtc")
                .GetProperty("format")
                .GetString());
    }

    [Fact]
    public void ActivityAnalysisContracts_ExposeOnlyApprovedSafeFields()
    {
        Assert.Equal(
            ["Date"],
            typeof(ActivityDateParams).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.Equal(
            ["ActiveSeconds", "Date", "Hours", "IdleSeconds", "IsToday", "SampleCount", "SessionCount", "TotalSeconds", "UnknownSeconds"],
            typeof(ActivityDailyStatsResult).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.Equal(
            ["ActiveSeconds", "Hour", "IdleSeconds", "UnknownSeconds"],
            typeof(ActivityHourlyBucket).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.Equal(
            ["ActiveSeconds", "ContextSwitchCount", "Date", "FocusSeconds", "IsToday", "SessionCount", "TopAppName"],
            typeof(ActivityTrendDay).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.Equal(
            ["AverageActiveSeconds", "ComparisonToAverageText", "ComparisonToYesterdayText", "Days", "WeekToDateText"],
            typeof(ActivityWeeklyTrendResult).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.Equal(
            ["ActiveSeconds", "AppName", "CloseReason", "EndedAtUtc", "IdleSeconds", "IsOpen", "StartedAtUtc", "SubSegments", "TotalSeconds", "UnknownSeconds"],
            typeof(ActivityTimelineSession).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.Equal(
            ["EndedAtUtc", "IsActive", "StartedAtUtc"],
            typeof(ActivityTimelineSubSegment).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.Equal(
            ["DurationSeconds", "EndedAtUtc", "StartedAtUtc"],
            typeof(ActivityTimelineGap).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.Equal(
            ["Date", "Gaps", "IsToday", "Sessions"],
            typeof(ActivityTimelineResult).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.Equal(
            ["ActiveRatioPercent", "ActiveSamples", "Date", "Hour", "IdleSamples", "IntensityLevel", "UnknownSamples"],
            typeof(ActivityHeatmapCell).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.Equal(
            ["Cells", "Today"],
            typeof(ActivityHeatmapResult).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.Equal(
            ["Open", "Other", "Paused", "ProcessChanged", "Stopped"],
            Enum.GetNames<ActivityTimelineCloseReason>().Order().ToArray());

        var memberNames = CollectContractMemberNames(
            typeof(ActivityDateParams),
            typeof(ActivityDailyStatsResult),
            typeof(ActivityHourlyBucket),
            typeof(ActivityTrendDay),
            typeof(ActivityWeeklyTrendResult),
            typeof(ActivityTimelineSession),
            typeof(ActivityTimelineGap),
            typeof(ActivityTimelineResult),
            typeof(ActivityHeatmapCell),
            typeof(ActivityHeatmapResult));
        var joinedMemberNames = string.Join(Environment.NewLine, memberNames);
        string[] forbiddenSubstrings =
        [
            "ProcessName", "WindowTitle", "ExecutablePath", "Path", "Title",
            "Database", "Exception", "StackTrace", "MachineName", "UserName"
        ];
        foreach (var forbidden in forbiddenSubstrings)
        {
            Assert.DoesNotContain(forbidden, joinedMemberNames, StringComparison.OrdinalIgnoreCase);
        }

        // "Id" is only forbidden as a full member name; Idle* names contain the letters legitimately.
        Assert.DoesNotContain(memberNames, name => string.Equals(name, "Id", StringComparison.OrdinalIgnoreCase));

        var schemaPath = Path.Combine(
            FindRepositoryRoot(),
            "contracts",
            "wuji-bridge",
            "v1",
            "bridge.schema.json");
        using var schema = JsonDocument.Parse(File.ReadAllText(schemaPath));
        var definitions = schema.RootElement.GetProperty("$defs");
        Assert.Equal(
            ["open", "process_changed", "paused", "stopped", "other"],
            definitions.GetProperty("ActivityTimelineCloseReason")
                .GetProperty("enum")
                .EnumerateArray()
                .Select(value => value.GetString())
                .ToArray());
        Assert.Equal(
            128,
            definitions.GetProperty("ActivityTimelineSession")
                .GetProperty("properties")
                .GetProperty("appName")
                .GetProperty("maxLength")
                .GetInt32());
        Assert.Equal(
            23,
            definitions.GetProperty("ActivityHourlyBucket")
                .GetProperty("properties")
                .GetProperty("hour")
                .GetProperty("maximum")
                .GetInt32());
        Assert.Equal(
            100,
            definitions.GetProperty("ActivityHeatmapCell")
                .GetProperty("properties")
                .GetProperty("activeRatioPercent")
                .GetProperty("maximum")
                .GetInt32());
        Assert.Equal(
            4,
            definitions.GetProperty("ActivityHeatmapCell")
                .GetProperty("properties")
                .GetProperty("intensityLevel")
                .GetProperty("maximum")
                .GetInt32());
        Assert.Equal(
            "date-time",
            definitions.GetProperty("ActivityTimelineSession")
                .GetProperty("properties")
                .GetProperty("startedAtUtc")
                .GetProperty("format")
                .GetString());
        Assert.Equal(
            "date",
            definitions.GetProperty("ActivityDateParams")
                .GetProperty("required")
                .EnumerateArray()
                .Select(value => value.GetString())
                .Single());
    }

    private static HashSet<string> CollectContractMemberNames(params Type[] rootTypes)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        var visited = new HashSet<Type>();
        var queue = new Queue<Type>(rootTypes);
        while (queue.Count > 0)
        {
            var type = queue.Dequeue();
            if (!visited.Add(type) || type.Namespace != typeof(ActivityDailyStatsResult).Namespace)
            {
                continue;
            }

            foreach (var property in type.GetProperties())
            {
                names.Add(property.Name);
                var propertyType = property.PropertyType;
                if (propertyType.IsGenericType)
                {
                    foreach (var argument in propertyType.GetGenericArguments())
                    {
                        queue.Enqueue(argument);
                    }
                }
                else
                {
                    queue.Enqueue(propertyType);
                }
            }
        }

        return names;
    }

    [Fact]
    public void SettingsContracts_ExposeOnlyTheApprovedSafeAllowlist()
    {
        Assert.Equal(
            ["AutoStartAgentWhenAppStarts", "RefreshIntervalSeconds", "Theme"],
            typeof(SettingsAppSettings).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.Equal(
            [
                "EnableAgentEventJournal", "EnableJsonlJournal", "EnableSessionMerge",
                "HeartbeatIntervalSeconds", "IdleThresholdSeconds", "MaskWindowTitles",
                "RetentionDays", "SamplingIntervalSeconds", "StaleThresholdSeconds"
            ],
            typeof(SettingsAgentOptions).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.Equal(
            ["AgentOptions", "AppSettings"],
            typeof(SettingsSnapshot).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.Equal(
            ["Defaults", "Settings"],
            typeof(SettingsGetResult).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.Equal(
            ["Field", "Message"],
            typeof(SettingsFieldError).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.Contains(
            "FieldErrors",
            typeof(BridgeErrorData).GetProperties().Select(property => property.Name));

        var settingsContractSource = string.Join(
            Environment.NewLine,
            typeof(SettingsAppSettings).GetProperties().Select(property => property.Name)
                .Concat(typeof(SettingsAgentOptions).GetProperties().Select(property => property.Name)));
        string[] forbiddenFields =
        [
            "StartAppOnWindowsLogin", "LastSelectedPage", "MinimizeToTray", "CloseToTray",
            "UseMockCapture", "IdleSummaryIntervalMinutes", "ExcludedProcesses", "ExcludedTitlePatterns",
            "DataRoot", "DatabasePath", "AgentExecutablePath", "PipeName", "Mutex", "Registry"
        ];
        foreach (var forbiddenField in forbiddenFields)
        {
            Assert.DoesNotContain(forbiddenField, settingsContractSource, StringComparison.OrdinalIgnoreCase);
        }

        var schemaPath = Path.Combine(
            FindRepositoryRoot(), "contracts", "wuji-bridge", "v1", "bridge.schema.json");
        using var schema = JsonDocument.Parse(File.ReadAllText(schemaPath));
        var definitions = schema.RootElement.GetProperty("$defs");
        Assert.Equal(5, definitions.GetProperty("SettingsAppSettings").GetProperty("properties")
            .GetProperty("refreshIntervalSeconds").GetProperty("minimum").GetInt32());
        Assert.Equal(300, definitions.GetProperty("SettingsAppSettings").GetProperty("properties")
            .GetProperty("refreshIntervalSeconds").GetProperty("maximum").GetInt32());
        Assert.Equal(3650, definitions.GetProperty("SettingsAgentOptions").GetProperty("properties")
            .GetProperty("retentionDays").GetProperty("maximum").GetInt32());
    }

    [Fact]
    public void SettingsHandlers_UseOnlyTypedWujiClientSettingsUseCases()
    {
        var repositoryRoot = FindRepositoryRoot();
        var host = File.ReadAllText(Path.Combine(
            repositoryRoot, "src", "QuantifiedSelf.Windows.Client.Bridge", "BridgeHost.cs"));
        var mapper = File.ReadAllText(Path.Combine(
            repositoryRoot, "src", "QuantifiedSelf.Windows.Client.Bridge", "BridgeSettingsMapper.cs"));

        Assert.Contains("var settingsClient = _client.Settings", host, StringComparison.Ordinal);
        Assert.Contains("settingsClient.GetClientSettingsAsync", host, StringComparison.Ordinal);
        Assert.Contains("settingsClient.GetDefaultClientSettings", host, StringComparison.Ordinal);
        Assert.Contains("_client.Settings.UpdateClientSettingsAsync", host, StringComparison.Ordinal);
        Assert.DoesNotContain("ReadAppSettingsAsync", host, StringComparison.Ordinal);
        Assert.DoesNotContain("ReadAgentOptionsAsync", host, StringComparison.Ordinal);
        Assert.DoesNotContain("SaveAppSettingsAsync", host, StringComparison.Ordinal);
        Assert.DoesNotContain("SaveAgentOptionsAsync", host, StringComparison.Ordinal);
        Assert.DoesNotContain("Infrastructure", host, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Sqlite", host, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Registry", host, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("StartAppOnWindowsLogin", mapper, StringComparison.Ordinal);
        Assert.DoesNotContain("ExcludedTitlePatterns", mapper, StringComparison.Ordinal);
    }

    [Fact]
    public void ActivityOverviewHandler_UsesOnlyWujiClientOverviewAndExplicitSafeMapper()
    {
        var repositoryRoot = FindRepositoryRoot();
        var host = File.ReadAllText(Path.Combine(
            repositoryRoot,
            "src",
            "QuantifiedSelf.Windows.Client.Bridge",
            "BridgeHost.cs"));
        var mapper = File.ReadAllText(Path.Combine(
            repositoryRoot,
            "src",
            "QuantifiedSelf.Windows.Client.Bridge",
            "BridgeActivityMapper.cs"));

        Assert.Contains("_client.Activity.Overview", host, StringComparison.Ordinal);
        Assert.Contains("_client.Activity.DailyStats", host, StringComparison.Ordinal);
        Assert.Contains("_client.Activity.WeeklyTrend", host, StringComparison.Ordinal);
        Assert.Contains("_client.Activity.Timeline", host, StringComparison.Ordinal);
        Assert.Contains("_client.Activity.Heatmap", host, StringComparison.Ordinal);
        Assert.DoesNotContain("_client.Activity.Apps", host, StringComparison.Ordinal);
        Assert.DoesNotContain("_client.Activity.Sessions", host, StringComparison.Ordinal);
        Assert.DoesNotContain("_client.Activity.Samples", host, StringComparison.Ordinal);
        Assert.DoesNotContain("_client.Activity.Insights", host, StringComparison.Ordinal);
        Assert.DoesNotContain("Sqlite", host, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Infrastructure", host, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("WindowTitle", mapper, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Database", mapper, StringComparison.OrdinalIgnoreCase);
        // The timeline app name may fall back to the raw process name, but only as
        // input to display-name sanitization; it must never be assigned directly.
        Assert.DoesNotContain("ProcessName;", mapper, StringComparison.Ordinal);
    }

    [Fact]
    public void GeneratedArtifacts_ContainNoMachineSpecificAbsolutePaths()
    {
        var repositoryRoot = FindRepositoryRoot();
        foreach (var artifact in ContractGenerator.Generate(repositoryRoot))
        {
            Assert.DoesNotContain(repositoryRoot, artifact.Content, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("C:\\Users\\", artifact.Content, StringComparison.OrdinalIgnoreCase);
        }
    }

    private static string FindRepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "QuantifiedSelf.Windows.sln")))
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        throw new DirectoryNotFoundException("Unable to locate repository root.");
    }
}
