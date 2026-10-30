using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Portfolio.Tests;

public sealed class WebRouteTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient client;

    public WebRouteTests(WebApplicationFactory<Program> factory) => client = factory.CreateClient();

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
        var page = await client.GetStringAsync("/search?q=Fredrik");
        Assert.Contains("Sök i CV:t", page);
        Assert.Contains("/cv", page);
    }
}
