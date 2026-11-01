using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Portfolio.Web;

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
        Assert.Contains("noindex, nofollow", response.Headers.GetValues("X-Robots-Tag"));
    }


    [Fact]
    public async Task SitemapIsValidNamespacedXmlWithPublishedCanonicalRoutesOnly()
    {
        var response = await client.GetAsync("/sitemap.xml");
        var document = XDocument.Parse(await response.Content.ReadAsStringAsync());
        XNamespace sitemap = "http://www.sitemaps.org/schemas/sitemap/0.9";
        var siteUrl = factory.Services.GetRequiredService<SiteContent>().SiteUrl!;

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/xml", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(sitemap + "urlset", document.Root?.Name);
        var locations = document.Root!.Elements(sitemap + "url")
            .Select(url => url.Element(sitemap + "loc")?.Value)
            .Where(location => location is not null)
            .ToArray();
        Assert.Contains($"{siteUrl}/", locations);
        Assert.Contains($"{siteUrl}/cv", locations);
        Assert.Contains($"{siteUrl}/projects/demo-platform", locations);
        Assert.DoesNotContain(locations, location => location!.Contains("demo-profile", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task RobotsTxtPreservesDevelopmentNoindexPolicy()
    {
        var response = await client.GetAsync("/robots.txt");
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("Disallow: /", body);
        Assert.Contains("noindex, nofollow", response.Headers.GetValues("X-Robots-Tag"));
        var sitemap = await client.GetAsync("/sitemap.xml");
        var llms = await client.GetAsync("/llms.txt");
        Assert.Contains("noindex, nofollow", sitemap.Headers.GetValues("X-Robots-Tag"));
        Assert.Contains("noindex, nofollow", llms.Headers.GetValues("X-Robots-Tag"));
        var page = await client.GetAsync("/cv");
        Assert.Contains("noindex, nofollow", page.Headers.GetValues("X-Robots-Tag"));
    }

    [Fact]
    public async Task ProductionRobotsAndPageMetadataUseConfiguredOriginAndAllowIndexing()
    {
        using var productionFactory = factory.WithWebHostBuilder(builder => builder.UseEnvironment("Production"));
        using var productionClient = productionFactory.CreateClient();
        var siteUrl = productionFactory.Services.GetRequiredService<SiteContent>().SiteUrl!;
        using var robotsRequest = new HttpRequestMessage(HttpMethod.Get, "/robots.txt");
        robotsRequest.Headers.Host = "untrusted-request-host.example";
        var robots = await productionClient.SendAsync(robotsRequest);
        var robotsText = await robots.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, robots.StatusCode);
        Assert.Contains($"Sitemap: {siteUrl}/sitemap.xml", robotsText);
        Assert.DoesNotContain("untrusted-request-host.example", robotsText);
        Assert.False(robots.Headers.Contains("X-Robots-Tag"));
        var productionSitemap = await productionClient.GetAsync("/sitemap.xml");
        var productionLlms = await productionClient.GetAsync("/llms.txt");
        Assert.False(productionSitemap.Headers.Contains("X-Robots-Tag"));
        Assert.False(productionLlms.Headers.Contains("X-Robots-Tag"));

        using var pageRequest = new HttpRequestMessage(HttpMethod.Get, "/cv");
        pageRequest.Headers.Host = "untrusted-request-host.example";
        var page = await productionClient.SendAsync(pageRequest);
        var html = System.Net.WebUtility.HtmlDecode(await page.Content.ReadAsStringAsync());

        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        Assert.False(page.Headers.Contains("X-Robots-Tag"));
        Assert.Contains($"rel=\"canonical\" href=\"{siteUrl}/cv\"", html);
        Assert.DoesNotContain("untrusted-request-host.example", html);
        var siteContent = productionFactory.Services.GetRequiredService<SiteContent>();
        var cvMetadata = siteContent.FindByPath("/cv")!;
        var fullTitle = cvMetadata.Title.Contains(siteContent.Settings.SiteName, StringComparison.OrdinalIgnoreCase)
            ? cvMetadata.Title
            : $"{cvMetadata.Title} \u00b7 {siteContent.Settings.SiteName}";
        Assert.Contains($"name=\"description\" content=\"{cvMetadata.Description}\"", html);
        Assert.Contains("property=\"og:site_name\"", html);
        Assert.Contains("property=\"og:locale\" content=\"sv_SE\"", html);
        Assert.Contains($"property=\"og:title\" content=\"{fullTitle}\"", html);
        Assert.Contains($"property=\"og:description\" content=\"{cvMetadata.Description}\"", html);
        Assert.Contains($"property=\"og:url\" content=\"{siteUrl}/cv\"", html);
        Assert.Contains("name=\"twitter:card\" content=\"summary\"", html);
        Assert.Contains($"name=\"twitter:title\" content=\"{fullTitle}\"", html);
        Assert.Contains($"name=\"twitter:description\" content=\"{cvMetadata.Description}\"", html);
        Assert.Contains("name=\"twitter:url\"", html);

        var jsonLd = Regex.Match(html, "<script type=\"application/ld\\+json\">(.*?)</script>", RegexOptions.Singleline);
        Assert.True(jsonLd.Success, "Expected JSON-LD with approved public metadata.");
        using var structuredData = JsonDocument.Parse(jsonLd.Groups[1].Value);
        var schemas = structuredData.RootElement.EnumerateArray().ToArray();
        Assert.Contains(schemas, schema => schema.GetProperty("@type").GetString() == "WebSite");
        Assert.Contains(schemas, schema => schema.GetProperty("@type").GetString() == "WebPage"
            && schema.GetProperty("url").GetString() == $"{siteUrl}/cv"
            && schema.GetProperty("inLanguage").GetString() == "sv-SE"
            && schema.GetProperty("description").GetString() == cvMetadata.Description);
        Assert.DoesNotContain(schemas, schema => schema.GetProperty("@type").GetString() is "Person" or "Organization");
    }

    [Fact]
    public async Task CaseVariantPageUsesCanonicalRouteForMetadataAndSitemap()
    {
        using var productionFactory = factory.WithWebHostBuilder(builder => builder.UseEnvironment("Production"));
        using var noRedirectClient = productionFactory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var siteUrl = productionFactory.Services.GetRequiredService<SiteContent>().SiteUrl!;

        var caseVariant = await noRedirectClient.GetAsync("/CV");
        var caseVariantHtml = System.Net.WebUtility.HtmlDecode(await caseVariant.Content.ReadAsStringAsync());
        var canonicalPage = await noRedirectClient.GetAsync("/cv");
        var canonicalHtml = System.Net.WebUtility.HtmlDecode(await canonicalPage.Content.ReadAsStringAsync());
        var sitemapResponse = await noRedirectClient.GetAsync("/sitemap.xml");
        XNamespace sitemap = "http://www.sitemaps.org/schemas/sitemap/0.9";
        var sitemapDocument = XDocument.Parse(await sitemapResponse.Content.ReadAsStringAsync());
        var sitemapLocations = sitemapDocument.Root!.Elements(sitemap + "url")
            .Select(url => url.Element(sitemap + "loc")?.Value)
            .ToArray();
        var expectedUrl = $"{siteUrl}/cv";

        Assert.Equal(HttpStatusCode.OK, caseVariant.StatusCode);
        Assert.Null(caseVariant.Headers.Location);
        Assert.Equal(HttpStatusCode.OK, canonicalPage.StatusCode);
        Assert.Equal(HttpStatusCode.OK, sitemapResponse.StatusCode);
        Assert.Contains($"rel=\"canonical\" href=\"{expectedUrl}\"", caseVariantHtml);
        Assert.Contains($"rel=\"canonical\" href=\"{expectedUrl}\"", canonicalHtml);
        Assert.Contains($"property=\"og:url\" content=\"{expectedUrl}\"", caseVariantHtml);
        var jsonLd = Regex.Match(caseVariantHtml, "<script type=\"application/ld\\+json\">(.*?)</script>", RegexOptions.Singleline);
        Assert.True(jsonLd.Success, "Expected JSON-LD with canonical page metadata.");
        using var structuredData = JsonDocument.Parse(jsonLd.Groups[1].Value);
        Assert.Contains(structuredData.RootElement.EnumerateArray(), schema =>
            schema.GetProperty("@type").GetString() == "WebPage"
            && schema.GetProperty("url").GetString() == expectedUrl);
        Assert.Contains(sitemapLocations, location => location == expectedUrl);
    }

    [Fact]
    public async Task LlmsTextContainsOnlyPublishedPageMetadataAndConfiguredCanonicalUrls()
    {
        var response = await client.GetAsync("/llms.txt");
        var body = await response.Content.ReadAsStringAsync();
        var siteUrl = factory.Services.GetRequiredService<SiteContent>().SiteUrl!;

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("# Alex Exempel", body);
        Assert.Contains($"{siteUrl}/cv", body);
        Assert.Contains("lösningsarkitekt och senior konsult", body);
        Assert.DoesNotContain("demo-profile", body);
        Assert.DoesNotContain("Synthetic example", body);
    }

    [Fact]
    public async Task OnlyMatchingFullAppRevisionMakesStaticAssetsImmutable()
    {
        var revision = factory.Services.GetRequiredService<ReleaseIdentity>().AppRevision;
        var mismatched = await client.GetAsync("/css/site.css?v=unknown");
        var unversioned = await client.GetAsync("/css/site.css");
        var html = await client.GetStringAsync("/cv");
        var fontsCss = await client.GetStringAsync("/css/fonts.css");

        Assert.Equal("no-cache", mismatched.Headers.GetValues("Cache-Control").Single());
        Assert.Equal("no-cache", unversioned.Headers.GetValues("Cache-Control").Single());
        if (Regex.IsMatch(revision, "^[0-9a-f]{40}$"))
        {
            var versioned = await client.GetAsync($"/css/site.css?v={revision}");
            Assert.Equal("public, max-age=31536000, immutable", versioned.Headers.GetValues("Cache-Control").Single());
            Assert.Contains($"/css/site.css?v={revision}", html);
            Assert.Contains($"/js/index.js?v={revision}", html);
            Assert.Contains($"/css/fonts.css?v={revision}", html);
            Assert.Contains($"/fonts/BarlowCondensed-800.woff2?v={revision}", html);
            Assert.Contains($"/fonts/BarlowCondensed-700.woff2?v={revision}", fontsCss);
            Assert.Contains($"/fonts/BarlowCondensed-800.woff2?v={revision}", fontsCss);
        }
        else
        {
            Assert.DoesNotContain("/css/site.css?v=", html);
            Assert.DoesNotContain("/js/index.js?v=", html);
            Assert.DoesNotContain("/css/fonts.css?v=", html);
            Assert.DoesNotContain("/fonts/BarlowCondensed-800.woff2?v=", html);
            Assert.DoesNotContain("?v=", fontsCss);
        }
    }

    [Fact]
    public async Task FullRevisionCanEnableImmutableCachingForAnExactStaticAssetVersion()
    {
        const string revision = "0123456789abcdef0123456789abcdef01234567";
        using var versionedFactory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton(
                new ReleaseIdentity("test", revision, "unknown"))));
        using var versionedClient = versionedFactory.CreateClient();

        var fontsCssResponse = await versionedClient.GetAsync($"/css/fonts.css?v={revision}");
        var fontsCss = await fontsCssResponse.Content.ReadAsStringAsync();
        var mismatchedFontsCss = await versionedClient.GetAsync("/css/fonts.css?v=0123456789abcdef0123456789abcdef01234568");
        var unversionedFontsCss = await versionedClient.GetAsync("/css/fonts.css");
        var matching = await versionedClient.GetAsync($"/css/site.css?v={revision}");
        var font700 = await versionedClient.GetAsync($"/fonts/BarlowCondensed-700.woff2?v={revision}");
        var font800 = await versionedClient.GetAsync($"/fonts/BarlowCondensed-800.woff2?v={revision}");
        var mismatched = await versionedClient.GetAsync("/css/site.css?v=0123456789abcdef0123456789abcdef01234568");
        var html = await versionedClient.GetAsync($"/cv?v={revision}");
        var htmlBody = await html.Content.ReadAsStringAsync();
        var sitemap = await versionedClient.GetAsync($"/sitemap.xml?v={revision}");
        var robots = await versionedClient.GetAsync($"/robots.txt?v={revision}");
        var llms = await versionedClient.GetAsync($"/llms.txt?v={revision}");

        Assert.Contains($"/fonts/BarlowCondensed-700.woff2?v={revision}", fontsCss);
        Assert.Contains($"/fonts/BarlowCondensed-800.woff2?v={revision}", fontsCss);
        Assert.Contains($"/fonts/BarlowCondensed-800.woff2?v={revision}", htmlBody);
        Assert.Contains($"/css/fonts.css?v={revision}", htmlBody);
        Assert.Equal("public, max-age=31536000, immutable", fontsCssResponse.Headers.GetValues("Cache-Control").Single());
        Assert.Equal("no-cache", mismatchedFontsCss.Headers.GetValues("Cache-Control").Single());
        Assert.Equal("no-cache", unversionedFontsCss.Headers.GetValues("Cache-Control").Single());
        Assert.Equal("public, max-age=31536000, immutable", matching.Headers.GetValues("Cache-Control").Single());
        Assert.Equal("public, max-age=31536000, immutable", font700.Headers.GetValues("Cache-Control").Single());
        Assert.Equal("public, max-age=31536000, immutable", font800.Headers.GetValues("Cache-Control").Single());
        Assert.Equal("no-cache", mismatched.Headers.GetValues("Cache-Control").Single());
        Assert.Equal("no-cache", html.Headers.GetValues("Cache-Control").Single());
        Assert.Equal("no-cache", sitemap.Headers.GetValues("Cache-Control").Single());
        Assert.Equal("no-cache", robots.Headers.GetValues("Cache-Control").Single());
        Assert.Equal("no-cache", llms.Headers.GetValues("Cache-Control").Single());
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
        var response = await client.GetAsync("/api/search?q=Alex");
        var json = await response.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("/cv", json);
        Assert.DoesNotContain("demo-profile", json);
    }

    [Fact]
    public async Task SearchReturnsMatchingSectionWithAnchorAndSnippet()
    {
        var response = await client.GetAsync("/api/search?q=Alex");
        var results = System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        Assert.Contains(results.EnumerateArray(), item =>
            item.GetProperty("path").GetString()!.StartsWith("/cv#", StringComparison.Ordinal)
            && item.GetProperty("description").GetString()!.Contains("Alex", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task LegacySearchPageRedirectsToCv()
    {
        var noRedirect = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var response = await noRedirect.GetAsync("        /search?q=Alex");
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
            Assert.Single(System.Text.RegularExpressions.Regex.Matches(title, "Alex Exempel"));
            var header = System.Text.RegularExpressions.Regex.Match(html, "<header class=\"site-header\">.*?</header>", System.Text.RegularExpressions.RegexOptions.Singleline).Value;
            Assert.Contains(">AE</a>", header);
            Assert.Contains("aria-label=\"Alex Exempel – startsida\"", header);
            var footer = System.Text.RegularExpressions.Regex.Match(html, "<footer>.*?</footer>", System.Text.RegularExpressions.RegexOptions.Singleline).Value;
            Assert.DoesNotContain("Alex Exempel", footer);
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
