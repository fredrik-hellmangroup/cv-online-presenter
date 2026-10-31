using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Portfolio.Tests;

public sealed class WebRouteTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient client;
    private readonly WebApplicationFactory<Program> factory;

    public WebRouteTests(WebApplicationFactory<Program> factory)
    {
        this.factory = factory;
        client = factory.CreateClient();
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/profile")]
    [InlineData("/services")]
    [InlineData("/contact")]
    [InlineData("/cv")]
    public async Task PublishedPagesRenderWithoutClientJavascript(string path)
    {
        var response = await client.GetAsync(path);
        var html = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, html);
        Assert.Contains("<main", html);
        Assert.Contains("<h1", html);
    }

    [Fact]
    public async Task UnknownProjectReturns404()
    {
        var response = await client.GetAsync("/projects/nonexistent");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task HealthEndpointReturnsOk()
    {
        var response = await client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task SearchReturnsPublishedContentButNotDrafts()
    {
        var response = await client.GetAsync("/api/search?q=Fredrik");
        var json = await response.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("/cv", json);
        Assert.DoesNotContain("demo-profile", json);
    }

    [Fact]
    public async Task LegacySearchPageRedirectsToCv()
    {
        var noRedirect = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var response = await noRedirect.GetAsync("/search?q=Fredrik");
        Assert.Equal(HttpStatusCode.MovedPermanently, response.StatusCode);
        Assert.Equal("/cv", response.Headers.Location?.OriginalString);
    }

    [Fact]
    public async Task CvPageHasHeadingAnchorsAndHiddenEasterEgg()
    {
        var html = await client.GetStringAsync("/cv");
        Assert.Matches("<h2 id=\"[a-z0-9-]+\"", html);
        Assert.Contains("id=\"cv-toc\"", html);
        Assert.Contains("id=\"cv-search\"", html);
        Assert.Contains("id=\"easter-egg\" class=\"easter-egg\" role=\"status\" hidden", html);
        Assert.DoesNotContain("easter-egg-toggle", html);
        Assert.DoesNotContain("href=\"/search\"", html);
    }
}
