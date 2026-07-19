using System.Text.Json;
using System.Text.Json.Serialization;
using QuantifiedSelf.Windows.Client.Bridge.Generated;

namespace QuantifiedSelf.Windows.Client.Bridge;

internal static class BridgeProtocol
{
    public const string JsonRpcVersion = "2.0";
    public const string ApiVersion = "1.0";

    public const string HelloMethod = "bridge.hello";
    public const string InitializeMethod = "client.initialize";
    public const string AgentGetStatusMethod = "agent.getStatus";
    public const string AgentStartMethod = "agent.start";
    public const string AgentPauseMethod = "agent.pause";
    public const string AgentResumeMethod = "agent.resume";
    public const string AgentStopMethod = "agent.stop";
    public const string ActivityGetOverviewMethod = "activity.getOverview";
    public const string ActivityGetDailyStatsMethod = "activity.getDailyStats";
    public const string ActivityGetWeeklyTrendMethod = "activity.getWeeklyTrend";
    public const string ActivityGetTimelineMethod = "activity.getTimeline";
    public const string ActivityGetHeatmapMethod = "activity.getHeatmap";
    public const string SettingsGetMethod = "settings.get";
    public const string SettingsUpdateMethod = "settings.update";
    public const string ShutdownMethod = "bridge.shutdown";

    public static readonly IReadOnlyList<string> Capabilities =
    [
        HelloMethod,
        InitializeMethod,
        AgentGetStatusMethod,
        AgentStartMethod,
        AgentPauseMethod,
        AgentResumeMethod,
        AgentStopMethod,
        ActivityGetOverviewMethod,
        ActivityGetDailyStatsMethod,
        ActivityGetWeeklyTrendMethod,
        ActivityGetTimelineMethod,
        ActivityGetHeatmapMethod,
        SettingsGetMethod,
        SettingsUpdateMethod,
        ShutdownMethod
    ];

    public static bool IsAgentMethod(string method) => method is
        AgentGetStatusMethod or AgentStartMethod or AgentPauseMethod or AgentResumeMethod or AgentStopMethod;

    public static bool IsActivityMethod(string method) => method is
        ActivityGetOverviewMethod or ActivityGetDailyStatsMethod or ActivityGetWeeklyTrendMethod
        or ActivityGetTimelineMethod or ActivityGetHeatmapMethod;

    public static bool RequiresInitialization(string method) =>
        IsAgentMethod(method) || IsActivityMethod(method) || method is SettingsGetMethod or SettingsUpdateMethod;

    public static bool IsSideEffectMethod(string method) => method is
        AgentStartMethod or AgentPauseMethod or AgentResumeMethod or AgentStopMethod or SettingsUpdateMethod;

    public static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters =
        {
            new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower)
        }
    };

    public static readonly JsonSerializerOptions ParameterSerializerOptions = new(SerializerOptions)
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };

    public static bool IsSupportedApiVersion(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        var separator = value.IndexOf('.');
        var major = separator < 0 ? value : value[..separator];
        return string.Equals(major, "1", StringComparison.Ordinal);
    }

    public static BridgeResponseEnvelope Success<T>(string id, T result)
    {
        return new BridgeResponseEnvelope
        {
            Jsonrpc = JsonRpcVersion,
            Id = id,
            Result = JsonSerializer.SerializeToElement(result, SerializerOptions)
        };
    }

    public static BridgeResponseEnvelope Failure(
        string id,
        string correlationId,
        string code,
        string message,
        BridgeErrorKind kind,
        bool retryable,
        IReadOnlyList<SettingsFieldError>? fieldErrors = null)
    {
        return new BridgeResponseEnvelope
        {
            Jsonrpc = JsonRpcVersion,
            Id = id,
            Error = new BridgeError
            {
                Code = code,
                Message = message,
                Data = new BridgeErrorData
                {
                    Kind = kind,
                    Retryable = retryable,
                    CorrelationId = correlationId,
                    FieldErrors = fieldErrors
                }
            }
        };
    }
}
