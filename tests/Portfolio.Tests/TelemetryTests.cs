using System.Diagnostics;
using System.Diagnostics.Metrics;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Portfolio.Web;

namespace Portfolio.Tests;

[Collection(WebHostCollection.Name)]
public sealed class TelemetryTests
{
    [Fact]
    public async Task SearchTelemetryUsesRouteTemplateWithoutQueryOrVisitorData()
    {
        var activities = new List<Activity>();
        var measurements = new List<KeyValuePair<string, object?>>();
        using var activityListener = new ActivityListener
        {
            ShouldListenTo = source => source.Name == PortfolioTelemetry.InstrumentationName,
            Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllData,
            ActivityStopped = activities.Add
        };
        ActivitySource.AddActivityListener(activityListener);
        using var meterListener = new MeterListener();
        meterListener.InstrumentPublished = (instrument, listener) =>
        {
            if (instrument.Meter.Name == PortfolioTelemetry.InstrumentationName)
                listener.EnableMeasurementEvents(instrument);
        };
        meterListener.SetMeasurementEventCallback<long>((instrument, _, tags, _) =>
        {
            if (instrument.Name == "portfolio.http.requests")
                measurements.AddRange(tags.ToArray());
        });
        meterListener.Start();

        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();
        var response = await client.GetAsync("/api/search?q=private-query-marker");

        Assert.True(response.IsSuccessStatusCode);
        var activity = Assert.Single(activities, item => item.DisplayName == "http.request");
        Assert.Equal("/api/search", activity.GetTagItem("http.route"));
        var releaseIdentity = factory.Services.GetRequiredService<ReleaseIdentity>();
        Assert.Equal(releaseIdentity.BuildId, activity.GetTagItem("service.version"));
        Assert.Equal(releaseIdentity.AppRevision, activity.GetTagItem("app.revision"));
        Assert.Equal(releaseIdentity.ContentRevision, activity.GetTagItem("content.revision"));
        Assert.Contains(measurements, item => item.Key == "http.route" && Equals(item.Value, "/api/search"));
        Assert.DoesNotContain("private-query-marker", string.Join(' ', activity.TagObjects.Select(item => item.ToString())));
        Assert.DoesNotContain("private-query-marker", string.Join(' ', measurements.Select(item => item.ToString())));
    }

    [Fact]
    public void ReleaseIdentityLoadsBuildAndContentRevisions()
    {
        var root = Path.Combine(Path.GetTempPath(), "portfolio-release-" + Guid.NewGuid().ToString("N"));
        var webRoot = Path.Combine(root, "wwwroot");
        Directory.CreateDirectory(webRoot);
        try
        {
            File.WriteAllText(Path.Combine(webRoot, "build-metadata.json"),
                "{\"buildId\":\"build-123\",\"appRevision\":\"app-456\",\"contentRevision\":\"content-789\"}");

            var identity = ReleaseIdentity.Load(root);

            Assert.Equal("build-123", identity.BuildId);
            Assert.Equal("app-456", identity.AppRevision);
            Assert.Equal("content-789", identity.ContentRevision);
        }
        finally
        {
            Directory.Delete(root, true);
        }
    }
}
