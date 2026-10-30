using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Text.Json;

namespace Portfolio.Web;

public sealed record ReleaseIdentity(string BuildId, string AppRevision, string ContentRevision)
{
    public static ReleaseIdentity Load(string contentRoot)
    {
        var path = Path.Combine(contentRoot, "wwwroot", "build-metadata.json");
        if (!File.Exists(path)) return new("local", "unknown", "unknown");
        using var metadata = JsonDocument.Parse(File.ReadAllText(path));
        var root = metadata.RootElement;
        return new(
            Read(root, "buildId"),
            Read(root, "appRevision"),
            Read(root, "contentRevision"));

        static string Read(JsonElement root, string key) =>
            root.TryGetProperty(key, out var value) ? value.GetString() ?? "unknown" : "unknown";
    }
}

public static class PortfolioTelemetry
{
    public const string InstrumentationName = "Portfolio.Web";
    public static readonly ActivitySource ActivitySource = new(InstrumentationName);
    public static readonly Meter Meter = new(InstrumentationName);
    public static readonly Counter<long> Requests = Meter.CreateCounter<long>("portfolio.http.requests");
    public static readonly Histogram<double> Duration = Meter.CreateHistogram<double>("portfolio.http.duration", "ms");
}
