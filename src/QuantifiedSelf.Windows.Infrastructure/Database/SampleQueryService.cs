using Microsoft.Data.Sqlite;
using QuantifiedSelf.Windows.Core.Models;

namespace QuantifiedSelf.Windows.Infrastructure.Database;

public sealed class SampleQueryService
{
    private readonly string _databasePath;

    public SampleQueryService(string databasePath)
    {
        _databasePath = databasePath;
    }

    public async Task<IReadOnlyList<ForegroundSample>> GetRecentSamplesAsync(
        int limit = 200,
        CancellationToken cancellationToken = default)
    {
        if (!File.Exists(_databasePath))
        {
            return Array.Empty<ForegroundSample>();
        }

        limit = DataViewQueryHelpers.NormalizeLimit(limit);

        await using var connection = await SqliteConnectionFactory.OpenReadOnlyAsync(_databasePath, cancellationToken);
        if (!await DataViewQueryHelpers.TableExistsAsync(connection, "foreground_samples", cancellationToken))
        {
            return Array.Empty<ForegroundSample>();
        }

        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT
                id,
                sample_time_utc,
                process_name,
                window_title,
                executable_path,
                idle_seconds,
                activity_state
            FROM foreground_samples
            ORDER BY sample_time_utc DESC, id DESC
            LIMIT $limit;
            """;

        command.Parameters.AddWithValue("$limit", limit);

        var results = new List<ForegroundSample>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            results.Add(ReadSample(reader));
        }

        return results;
    }

    public async Task<IReadOnlyList<ForegroundSample>> GetSamplesForProcessInRangeAsync(
        DateTime startUtc,
        DateTime endUtc,
        string processName,
        int limit,
        CancellationToken cancellationToken = default)
    {
        if (!File.Exists(_databasePath))
        {
            return Array.Empty<ForegroundSample>();
        }

        ArgumentNullException.ThrowIfNull(processName);
        limit = DataViewQueryHelpers.NormalizeLimit(limit);

        await using var connection = await SqliteConnectionFactory.OpenReadOnlyAsync(_databasePath, cancellationToken);
        if (!await DataViewQueryHelpers.TableExistsAsync(connection, "foreground_samples", cancellationToken))
        {
            return Array.Empty<ForegroundSample>();
        }

        await using var command = connection.CreateCommand();
        // Minimal read: callers (timeline sub-segment splitting) only need the sample
        // time and activity state — window titles and executable paths never leave SQLite.
        command.CommandText =
            """
            SELECT
                sample_time_utc,
                activity_state
            FROM foreground_samples
            WHERE sample_time_utc >= $start_utc
              AND sample_time_utc < $end_utc
              AND process_name = $process_name
            ORDER BY sample_time_utc ASC
            LIMIT $limit;
            """;

        command.Parameters.AddWithValue("$start_utc", DataViewQueryHelpers.ToDbDateTime(startUtc));
        command.Parameters.AddWithValue("$end_utc", DataViewQueryHelpers.ToDbDateTime(endUtc));
        command.Parameters.AddWithValue("$process_name", processName);
        command.Parameters.AddWithValue("$limit", limit);

        var results = new List<ForegroundSample>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            results.Add(new ForegroundSample
            {
                SampleTimeUtc = DataViewQueryHelpers.ParseDbDateTime(reader.GetString(0)),
                ProcessName = processName,
                ActivityState = reader.GetString(1)
            });
        }

        return results;
    }

    private static ForegroundSample ReadSample(SqliteDataReader reader)
    {
        var processName = reader.GetString(2);
        return new ForegroundSample
        {
            Id = reader.GetInt64(0),
            SampleTimeUtc = DataViewQueryHelpers.ParseDbDateTime(reader.GetString(1)),
            ProcessName = processName,
            DisplayName = DataViewQueryHelpers.ResolveDisplayName(processName),
            WindowTitle = reader.IsDBNull(3) ? null : reader.GetString(3),
            ExecutablePath = reader.IsDBNull(4) ? null : reader.GetString(4),
            IdleSeconds = reader.GetInt32(5),
            ActivityState = reader.GetString(6)
        };
    }
}
