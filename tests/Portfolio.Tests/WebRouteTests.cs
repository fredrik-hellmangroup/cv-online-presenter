using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Portfolio.Tests;

[Collection(WebHostCollection.Name)]
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
    public async Task SearchReturnsMatchingSectionWithAnchorAndSnippet()
    {
        var response = await client.GetAsync("/api/search?q=Fredrik");
        var results = System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        Assert.Contains(results.EnumerateArray(), item =>
            item.GetProperty("path").GetString()!.StartsWith("/cv#", StringComparison.Ordinal)
            && item.GetProperty("description").GetString()!.Contains("Fredrik", StringComparison.OrdinalIgnoreCase));
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
    public async Task NameAppearsOnceInTitleAndNotInHeaderOrFooterText()
    {
        foreach (var path in new[] { "/", "/cv" })
        {
            var html = System.Net.WebUtility.HtmlDecode(await client.GetStringAsync(path));
            var title = System.Text.RegularExpressions.Regex.Match(html, "<title>(.*?)</title>").Groups[1].Value;
            Assert.Single(System.Text.RegularExpressions.Regex.Matches(title, "Hallerös"));
            var header = System.Text.RegularExpressions.Regex.Match(html, "<header class=\"site-header\">.*?</header>", System.Text.RegularExpressions.RegexOptions.Singleline).Value;
            Assert.Contains(">FH</a>", header);
            Assert.Contains("aria-label=\"Fredrik Hallerös – startsida\"", header);
            var footer = System.Text.RegularExpressions.Regex.Match(html, "<footer>.*?</footer>", System.Text.RegularExpressions.RegexOptions.Singleline).Value;
            Assert.DoesNotContain("Hallerös", footer);
        }
    }

    [Fact]
    public async Task StartPageIsMinimal()
    {
        var html = await client.GetStringAsync("/");
        Assert.Contains("<main id=\"main\" class=\"home\"", html);
        Assert.DoesNotContain("cv-figures", html);
    }

    [Fact]
    public async Task LegacyProfilePageRedirectsToCv()
    {
        var noRedirect = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var response = await noRedirect.GetAsync("/profile");
        Assert.Equal(HttpStatusCode.MovedPermanently, response.StatusCode);
        Assert.Equal("/cv", response.Headers.Location?.OriginalString);
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/cv")]
    public async Task H1CarriesNameAndRole(string path)
    {
        var html = await client.GetStringAsync(path);
        Assert.Contains("class=\"h1-name\"", html);
        Assert.Contains("class=\"h1-tagline\"", html);
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
        Assert.Contains("class=\"cv-hero\"", html);
        Assert.Contains("data-count=", html);
        Assert.Contains("git log --graph --oneline", html);
        Assert.Contains("class=\"assignment\"", html);
        Assert.Contains("class=\"skill-group\"", html);
        Assert.Single(System.Text.RegularExpressions.Regex.Matches(html, "<h1[ >]"));
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/cv")]
    public async Task EveryPageCarriesTheConstellationData(string path)
    {
        var html = await client.GetStringAsync(path);
        Assert.Contains("id=\"constellation-data\"", html);
        Assert.Contains("data-json=\"{&quot;groups&quot;", html);
    }
}
