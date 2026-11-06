using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Portfolio.Content;
using Portfolio.Web;

namespace Portfolio.Tests;

[Collection(WebHostCollection.Name)]
public sealed class WebRouteTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient client;
    private readonly WebApplicationFactory<Program> factory;
    private const string TestActivationToken = "issue-58-test-token-only-not-a-secret-value";

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

    [Theory]
    [InlineData("/services")]
    [InlineData("/Services")]
    public async Task ServicesRendersCvSkillsExplorerAfterMarkdownAndKeepsItOffHomePage(string path)
    {
        var response = await client.GetAsync(path);
        var html = await response.Content.ReadAsStringAsync();
        var cv = factory.Services.GetRequiredService<SiteContent>().Cv;

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotNull(cv);
        Assert.NotEmpty(cv.SkillGroups);
        var explorerIndex = html.IndexOf("id=\"service-technologies-heading\"", StringComparison.Ordinal);
        var ctaIndex = html.IndexOf("service-cv-cta", StringComparison.Ordinal);
        Assert.True(explorerIndex >= 0, "The services page should render the technology explorer.");
        Assert.True(ctaIndex > explorerIndex, "The CV CTA should follow the technology explorer.");
        Assert.Contains("Teknik i uppdragen", html);
        Assert.Contains("for=\"technology-filter\"", html);
        Assert.Contains("data-tech-filter", html);
        Assert.Contains("data-tech-count", html);
        Assert.Contains("data-pin-status", html);
        Assert.Contains("data-tech-empty", html);
        Assert.Contains("data-skill=\"", html);
        Assert.Contains("aria-pressed=\"false\"", html);
        Assert.Equal(cv.SkillGroups.Sum(group => group.Skills.Count), Regex.Matches(html, "data-tech-item").Count);
        var decoded = System.Net.WebUtility.HtmlDecode(html);
        foreach (var group in cv.SkillGroups)
            Assert.Contains($"aria-label=\"{group.Name}\" data-keywords=\"{string.Join("|", group.Skills)}\"", decoded);

        var home = await client.GetStringAsync("/");
        Assert.DoesNotContain("data-tech-filter", home);
    }

    [Fact]
    public async Task ServicesStartsWithATwoColumnHeroAndAPanelOfItsSections()
    {
        var html = await client.GetStringAsync("/services");
        var hero = Regex.Match(html, "<section class=\"page-hero\">.*?</aside>", RegexOptions.Singleline).Value;

        Assert.NotEmpty(hero);
        Assert.Contains("class=\"page-hero-kicker\"", hero);
        Assert.Contains("<h1", hero);
        Assert.Contains("href=\"#service-technologies-heading\"", hero);
        Assert.Contains("href=\"/cv\"", hero);
        Assert.Contains("<aside class=\"page-hero-panel\"", hero);
        Assert.Contains("data-hero-tabs", hero);
        Assert.Equal(["Bygga", "Leverera", "Domän", "Teknik"],
            Regex.Matches(hero, "<h2 class=\"hero-tab-heading\" data-hero-tab-label>(.*?)</h2>").Select(match => WebUtility.HtmlDecode(match.Groups[1].Value)));
        Assert.Equal(4, Regex.Matches(hero, "<strong>").Count);
        Assert.Contains("href=\"#service-technologies-heading\">Filtrera och utforska", hero);
        Assert.Single(Regex.Matches(html, "<h1[ >]"));
        Assert.True(html.IndexOf("service-technologies-heading\">", StringComparison.Ordinal) > html.IndexOf("page-hero", StringComparison.Ordinal));
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
        Assert.Contains($"{siteUrl}/cv", body);
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
    public async Task HealthEndpointPreservesTheExistingPublicResponse()
    {
        var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("{\"status\":\"ok\"}", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ActiveContentRouteReturnsBundledSnapshotWithNullReleaseId()
    {
        var releasesRoot = Path.Combine(Path.GetTempPath(), "portfolio-active-content-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(releasesRoot);
        try
        {
            using var activeFactory = CreateReleaseFactory(releasesRoot);
            using var httpsClient = CreateHttpsClient(activeFactory);
            using var request = new HttpRequestMessage(HttpMethod.Get, "/internal/content/active");
            request.Headers.Add("X-Content-Activation-Token", TestActivationToken);

            var response = await httpsClient.SendAsync(request);
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var properties = body.RootElement.EnumerateObject().ToArray();

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal(2, properties.Length);
            Assert.Contains(properties, property => property.Name == "contentReleaseId");
            Assert.Contains(properties, property => property.Name == "contentVersion");
            Assert.Null(body.RootElement.GetProperty("contentReleaseId").GetString());
            Assert.Equal(activeFactory.Services.GetRequiredService<SiteContent>().Version,
                body.RootElement.GetProperty("contentVersion").GetString());
        }
        finally
        {
            Directory.Delete(releasesRoot, recursive: true);
        }
    }

    [Fact]
    public async Task ActiveContentRouteReportsNullReleaseIdAfterInvalidPointerFallsBackToBundledContent()
    {
        var releasesRoot = Path.Combine(Path.GetTempPath(), "portfolio-active-fallback-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(releasesRoot);
        File.WriteAllText(Path.Combine(releasesRoot, ContentReleaseCatalog.ActiveReleaseFileName), "../invalid");
        try
        {
            using var activeFactory = CreateReleaseFactory(releasesRoot);
            using var httpsClient = CreateHttpsClient(activeFactory);
            using var request = AuthorizedGet("/internal/content/active");

            var response = await httpsClient.SendAsync(request);
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Null(body.RootElement.GetProperty("contentReleaseId").GetString());
            Assert.Equal(activeFactory.Services.GetRequiredService<SiteContent>().Version,
                body.RootElement.GetProperty("contentVersion").GetString());
        }
        finally
        {
            Directory.Delete(releasesRoot, recursive: true);
        }
    }

    [Fact]
    public async Task ActiveContentRouteReturnsTheStartupPrivateReleaseAndItsSnapshotVersion()
    {
        var releasesRoot = Path.Combine(Path.GetTempPath(), "portfolio-active-private-" + Guid.NewGuid().ToString("N"));
        const string releaseId = "startup-private-release";
        CreateRelease(releasesRoot, releaseId, "Private startup content");
        File.WriteAllText(Path.Combine(releasesRoot, ContentReleaseCatalog.ActiveReleaseFileName), releaseId);
        try
        {
            using var activeFactory = CreateReleaseFactory(releasesRoot);
            using var httpsClient = CreateHttpsClient(activeFactory);
            using var request = AuthorizedGet("/internal/content/active");

            var response = await httpsClient.SendAsync(request);
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal(releaseId, body.RootElement.GetProperty("contentReleaseId").GetString());
            Assert.Equal(activeFactory.Services.GetRequiredService<SiteContent>().Version,
                body.RootElement.GetProperty("contentVersion").GetString());
        }
        finally
        {
            Directory.Delete(releasesRoot, recursive: true);
        }
    }

    [Fact]
    public async Task ActivationChangesTheActiveReleaseIdAndSnapshotVersionTogether()
    {
        var releasesRoot = Path.Combine(Path.GetTempPath(), "portfolio-active-change-" + Guid.NewGuid().ToString("N"));
        const string initialId = "initial-release";
        const string candidateId = "candidate-release";
        CreateRelease(releasesRoot, initialId, "Initial private content");
        CreateRelease(releasesRoot, candidateId, "Activated private content");
        File.WriteAllText(Path.Combine(releasesRoot, ContentReleaseCatalog.ActiveReleaseFileName), initialId);
        try
        {
            using var activeFactory = CreateReleaseFactory(releasesRoot);
            using var httpsClient = CreateHttpsClient(activeFactory);
            var before = await GetActiveContentAsync(httpsClient);
            var expectedVersion = (await LoadReleaseAsync(releasesRoot, candidateId)).Version;
            using var activation = AuthorizedPost($"/internal/content/activate/{candidateId}");

            var activationResponse = await httpsClient.SendAsync(activation);
            var after = await GetActiveContentAsync(httpsClient);

            Assert.Equal(HttpStatusCode.OK, activationResponse.StatusCode);
            Assert.Equal(initialId, before.ReleaseId);
            Assert.NotEqual(before.Version, after.Version);
            Assert.Equal(candidateId, after.ReleaseId);
            Assert.Equal(expectedVersion, after.Version);
            Assert.Equal(candidateId, File.ReadAllText(Path.Combine(releasesRoot, ContentReleaseCatalog.ActiveReleaseFileName)));
        }
        finally
        {
            Directory.Delete(releasesRoot, recursive: true);
        }
    }

    [Fact]
    public async Task FailedActivationPreservesThePreviousReleaseIdAndVersion()
    {
        var releasesRoot = Path.Combine(Path.GetTempPath(), "portfolio-active-failed-" + Guid.NewGuid().ToString("N"));
        const string activeId = "active-release";
        const string invalidId = "invalid-release";
        CreateRelease(releasesRoot, activeId, "Still active private content");
        Directory.CreateDirectory(Path.Combine(releasesRoot, invalidId));
        File.WriteAllText(Path.Combine(releasesRoot, ContentReleaseCatalog.ActiveReleaseFileName), activeId);
        try
        {
            using var activeFactory = CreateReleaseFactory(releasesRoot);
            using var httpsClient = CreateHttpsClient(activeFactory);
            var before = await GetActiveContentAsync(httpsClient);
            using var activation = AuthorizedPost($"/internal/content/activate/{invalidId}");

            var failedActivation = await httpsClient.SendAsync(activation);
            var after = await GetActiveContentAsync(httpsClient);

            Assert.Equal(HttpStatusCode.BadRequest, failedActivation.StatusCode);
            Assert.Equal(activeId, before.ReleaseId);
            Assert.Equal(before, after);
            Assert.Equal(activeId, File.ReadAllText(Path.Combine(releasesRoot, ContentReleaseCatalog.ActiveReleaseFileName)));
        }
        finally
        {
            Directory.Delete(releasesRoot, recursive: true);
        }
    }

    [Theory]
    [InlineData("/internal/content/active", "GET")]
    [InlineData("/internal/content/preview/candidate-release", "POST")]
    [InlineData("/internal/content/activate/candidate-release", "POST")]
    public async Task ProtectedContentRoutesRejectConfiguredActivationTokensBelowMinimum(string path, string method)
    {
        var releasesRoot = Path.Combine(Path.GetTempPath(), "portfolio-short-activation-token-" + Guid.NewGuid().ToString("N"));
        const string releaseId = "candidate-release";
        CreateRelease(releasesRoot, releaseId, "Candidate content");
        var shortToken = new string('s', ContentReleaseCatalog.MinimumActivationTokenLength - 1);
        try
        {
            using var activeFactory = CreateReleaseFactory(releasesRoot, shortToken);
            using var httpsClient = CreateHttpsClient(activeFactory);
            using var request = new HttpRequestMessage(new HttpMethod(method), path);
            request.Headers.Add("X-Content-Activation-Token", shortToken);

            var response = await httpsClient.SendAsync(request);

            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }
        finally
        {
            Directory.Delete(releasesRoot, recursive: true);
        }
    }

    [Fact]
    public async Task ActiveContentRouteRequiresTheExistingHttpsAndTokenBoundary()
    {
        var releasesRoot = Path.Combine(Path.GetTempPath(), "portfolio-active-auth-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(releasesRoot);
        try
        {
            using var activeFactory = CreateReleaseFactory(releasesRoot);
            using var httpClient = activeFactory.CreateClient();
            using var httpsClient = CreateHttpsClient(activeFactory);
            using var noToken = new HttpRequestMessage(HttpMethod.Get, "/internal/content/active");
            using var wrongToken = new HttpRequestMessage(HttpMethod.Get, "/internal/content/active");
            wrongToken.Headers.Add("X-Content-Activation-Token", "not-the-configured-test-token");
            using var httpAuthorized = AuthorizedGet("/internal/content/active");
            using var httpsAuthorized = AuthorizedGet("/internal/content/active");

            var missing = await httpsClient.SendAsync(noToken);
            var invalid = await httpsClient.SendAsync(wrongToken);
            var insecure = await httpClient.SendAsync(httpAuthorized);
            var authorized = await httpsClient.SendAsync(httpsAuthorized);

            Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, invalid.StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, insecure.StatusCode);
            Assert.Equal(HttpStatusCode.OK, authorized.StatusCode);
        }
        finally
        {
            Directory.Delete(releasesRoot, recursive: true);
        }
    }

    [Fact]
    public async Task SearchReturnsPublishedContentButNotDrafts()
    {
        var response = await client.GetAsync("/api/search?q=.NET");
        var json = await response.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("/cv", json);
        Assert.DoesNotContain("demo-profile", json);
    }

    [Fact]
    public async Task SearchReturnsMatchingSectionWithAnchorAndSnippet()
    {
        var response = await client.GetAsync("/api/search?q=.NET");
        var results = System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        Assert.Contains(results.EnumerateArray(), item =>
            item.GetProperty("path").GetString()!.StartsWith("/cv#", StringComparison.Ordinal)
            && item.GetProperty("description").GetString()!.Contains(".NET", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task LegacySearchPageRedirectsToCv()
    {
        var noRedirect = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var response = await noRedirect.GetAsync("        /search?q=sample");
        Assert.Equal(HttpStatusCode.MovedPermanently, response.StatusCode);
        Assert.Equal("/cv", response.Headers.Location?.OriginalString);
    }

    [Fact]
    public async Task PageBrandLinksHomeWithTheWordHemAndNamesTheSite()
    {
        var siteName = factory.Services.GetRequiredService<SiteContent>().Settings.SiteName;
        foreach (var path in new[] { "/", "/cv" })
        {
            var html = System.Net.WebUtility.HtmlDecode(await client.GetStringAsync(path));
            var title = System.Text.RegularExpressions.Regex.Match(html, "<title>(.*?)</title>").Groups[1].Value;
            Assert.Contains(siteName, title);
            var header = System.Text.RegularExpressions.Regex.Match(html, "<header class=\"site-header\">.*?</header>", System.Text.RegularExpressions.RegexOptions.Singleline).Value;
            Assert.Contains(">Hem</a>", header);
            Assert.Contains($"aria-label=\"Hem \u2013 {siteName}\"", header);
            Assert.Contains("id=\"brand-mark\"", header);
            Assert.Equal(3, System.Text.RegularExpressions.Regex.Matches(System.Text.RegularExpressions.Regex.Match(header, "<svg.*?</svg>", System.Text.RegularExpressions.RegexOptions.Singleline).Value, "<circle ").Count);
            var footer = System.Text.RegularExpressions.Regex.Match(html, "<footer>.*?</footer>", System.Text.RegularExpressions.RegexOptions.Singleline).Value;
            Assert.DoesNotContain(siteName, footer);
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

    [Fact]
    public async Task CvHeroRendersNameAndOptionalTaglineAsSeparateElements()
    {
        var html = await client.GetStringAsync("/cv");
        var cv = factory.Services.GetRequiredService<SiteContent>().Cv!;
        var hero = Regex.Match(html, "<header class=\"cv-hero\">.*?</header>", RegexOptions.Singleline).Value;
        var heading = Regex.Match(hero, "<h1>(.*?)</h1>", RegexOptions.Singleline);

        Assert.True(heading.Success);
        Assert.DoesNotContain("<", heading.Groups[1].Value);
        Assert.Equal(cv.Name, System.Net.WebUtility.HtmlDecode(heading.Groups[1].Value));

        var tagline = Regex.Match(hero, "<p class=\"cv-tagline\">(.*?)</p>", RegexOptions.Singleline);
        if (cv.Tagline is null)
        {
            Assert.False(tagline.Success);
        }
        else
        {
            Assert.True(tagline.Success);
            Assert.Equal(cv.Tagline, System.Net.WebUtility.HtmlDecode(tagline.Groups[1].Value));
        }
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

    [Fact]
    public async Task ProjectsListShowsOrderedCardsWithMetaTagsAndKeywords()
    {
        using var syntheticFactory = CreateSyntheticContentFactory();
        using var syntheticClient = syntheticFactory.CreateClient();
        var html = WebUtility.HtmlDecode(await syntheticClient.GetStringAsync("/projects"));
        var titles = Regex.Matches(html, "<h2><a href=\"/projects/[^\"]+\">(.*?)</a></h2>")
            .Select(match => match.Groups[1].Value)
            .ToArray();

        Assert.Equal(["Projekt Kompass", "Projekt Lanternan", "Projekt Grön Stig"], titles);
        Assert.Equal(3, Regex.Matches(html, "class=\"project-card\"").Count);
        Assert.Contains("class=\"project-card-meta\">2026 - pågående · Föreningsliv</p>", html);
        Assert.Contains("data-keywords=\"TypeScript|Node.js|PostgreSQL|API\"", html);
        Assert.Contains("<ul class=\"tags\">", html);
        Assert.Contains("L\u00e4s om uppdraget", html);
        Assert.DoesNotContain("<article class=\"project-card\"", html);
    }

    [Fact]
    public async Task ProjectDetailHasBreadcrumbFactsAndTechnologyButtons()
    {
        using var syntheticFactory = CreateSyntheticContentFactory();
        using var syntheticClient = syntheticFactory.CreateClient();
        var html = WebUtility.HtmlDecode(await syntheticClient.GetStringAsync("/projects/kompass"));

        Assert.Contains("class=\"breadcrumb\"", html);
        Assert.Contains("<dt>Period</dt><dd>2026 - pågående</dd>", html);
        Assert.Contains("<dt>Roll</dt><dd>Lead utvecklare för digitala tjänster</dd>", html);
        Assert.Contains("<dt>Bransch</dt><dd>Föreningsliv</dd>", html);
        Assert.Contains("data-page-keywords=\"TypeScript|Node.js|PostgreSQL|API\"", html);
        Assert.Contains("Teknik i uppdraget", html);
        Assert.Contains("class=\"skill-btn\"", html);
        Assert.Contains("data-skill=\"TypeScript\"", html);
        Assert.Contains("data-pin-status", html);
        Assert.Single(Regex.Matches(html, "<dt>Period</dt>"));
        Assert.Single(Regex.Matches(html, "<dt>Roll</dt>"));
    }

    [Fact]
    public async Task ContactPageLinksOnToTheOtherPages()
    {
        var html = await client.GetStringAsync("/contact");

        Assert.Contains("id=\"utforska\"", html);
        Assert.Contains("href=\"#utforska\"", html);
        foreach (var route in new[] { "/services", "/projects", "/cv" })
            Assert.Contains($"<h2><a href=\"{route}\">", html);
    }

    [Fact]
    public async Task CvAssignmentsLinkToTheirProjectPages()
    {
        var html = await client.GetStringAsync("/cv");
        var projects = factory.Services.GetRequiredService<SiteContent>().PublishedProjects;
        var logLinks = Regex.Matches(html, "<a class=\"git-msg\" href=\"([^\"]+)\">").Select(match => match.Groups[1].Value).ToArray();

        Assert.NotEmpty(logLinks);
        Assert.All(logLinks, link => Assert.StartsWith("/projects/", link));
        Assert.Equal(logLinks.Length, Regex.Matches(html, "class=\"assignment-link\"").Count);
        Assert.All(logLinks, link => Assert.Contains(projects, project => "/" + project.Slug == link));
    }

    [Fact]
    public async Task CvPutsHistoryAfterTheOverviewWithPracticalCardsAndPrintButton()
    {
        using var syntheticFactory = CreateSyntheticContentFactory();
        using var syntheticClient = syntheticFactory.CreateClient();
        var html = await syntheticClient.GetStringAsync("/cv");
        var headings = Regex.Matches(html, "<h2 id=\"([a-z0-9-]+)\"")
            .Select(match => match.Groups[1].Value)
            .ToArray();

        Assert.Equal(["oversikt", "uppdragshistorik", "kompetensomraden", "branscherfarenhet", "anstallningar", "sprak"], headings);
        Assert.Contains("class=\"practical\"", html);
        Assert.DoesNotContain("id=\"praktiskt\"", html);
        Assert.Contains("data-print", html);
        Assert.Contains("class=\"skill-btn\"", html);
        Assert.Contains("data-skill=\"TypeScript\"", html);
    }

    [Fact]
    public async Task PublicProjectListingUsesSyntheticEditorialOrderAndSourceBackedFacts()
    {
        var html = WebUtility.HtmlDecode(await client.GetStringAsync("/projects"));
        var titles = Regex.Matches(html, "<h2><a href=\"/projects/[^\"]+\">(.*?)</a></h2>")
            .Select(match => match.Groups[1].Value)
            .ToArray();

        Assert.Equal([
            "Exempelplattformen",
            "Demoportalen",
            "Exempelintegrationen",
            "Demologistiken",
            "Demobanken",
            "Demokommunen"
        ], titles);
        Assert.Contains("class=\"project-card-meta\">2023 – 2025 · Digitala tjänster</p>", html);
        Assert.Contains("class=\"project-card-meta\">2021 – 2023 · Offentlig sektor</p>", html);
        Assert.Contains("class=\"project-card-meta\">2019 – 2021 · Systemintegration</p>", html);
        Assert.Contains("class=\"project-card-meta\">2017 – 2019 · Logistik</p>", html);
        Assert.Contains("class=\"project-card-meta\">2015 – 2017 · Finansiella tjänster</p>", html);
        Assert.Contains("class=\"project-card-meta\">2013 – 2015 · Kommunal verksamhet</p>", html);
    }

    [Fact]
    public async Task PublicProjectDetailRoutesExposeTheirSyntheticSourceBackedFacts()
    {
        var projects = new[]
        {
            (Slug: "demo-platform", Period: "2023 – 2025", Role: "Lösningsarkitekt (syntetiskt exempel)", Industry: "Digitala tjänster"),
            (Slug: "demoportalen", Period: "2021 – 2023", Role: "Backendutvecklare (syntetiskt exempel)", Industry: "Offentlig sektor"),
            (Slug: "exempelintegrationen", Period: "2019 – 2021", Role: "Integrationsutvecklare (syntetiskt exempel)", Industry: "Systemintegration"),
            (Slug: "demologistiken", Period: "2017 – 2019", Role: "Lösningsarkitekt (syntetiskt exempel)", Industry: "Logistik"),
            (Slug: "demobanken", Period: "2015 – 2017", Role: "Backendutvecklare (syntetiskt exempel)", Industry: "Finansiella tjänster"),
            (Slug: "demokommunen", Period: "2013 – 2015", Role: "Integrationsutvecklare (syntetiskt exempel)", Industry: "Kommunal verksamhet")
        };

        foreach (var project in projects)
        {
            using var response = await client.GetAsync($"/projects/{project.Slug}");
            var html = WebUtility.HtmlDecode(await response.Content.ReadAsStringAsync());

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Contains($"<dt>Period</dt><dd>{project.Period}</dd>", html);
            Assert.Contains($"<dt>Roll</dt><dd>{project.Role}</dd>", html);
            Assert.Contains($"<dt>Bransch</dt><dd>{project.Industry}</dd>", html);
        }
    }

    [Fact]
    public async Task PublicCvPlacesHistoryAfterOverviewAndBeforeCompetenceAndIndustry()
    {
        var html = await client.GetStringAsync("/cv");
        var headings = Regex.Matches(html, "<h2 id=\"([a-z0-9-]+)\"")
            .Select(match => match.Groups[1].Value)
            .ToArray();

        var overviewIndex = Array.IndexOf(headings, "oversikt");
        var historyIndex = Array.IndexOf(headings, "uppdragshistorik");
        var competenceIndex = Array.IndexOf(headings, "kompetensomraden");
        var industryIndex = Array.IndexOf(headings, "branscherfarenhet");

        Assert.True(overviewIndex >= 0);
        Assert.True(historyIndex > overviewIndex);
        Assert.True(competenceIndex > historyIndex);
        Assert.True(industryIndex > competenceIndex);
    }

    private static WebApplicationFactory<Program> CreateSyntheticContentFactory()
    {
        var pagesRoot = Path.Combine(AppContext.BaseDirectory, "synthetic-presentation", "content", "pages");
        return new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseSetting("Content:PagesRoot", pagesRoot));
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

    private static WebApplicationFactory<Program> CreateReleaseFactory(string releasesRoot, string? activationToken = null) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Content:ReleasesRoot", releasesRoot);
            builder.UseSetting("Content:ActivationToken", activationToken ?? TestActivationToken);
        });

    private static HttpClient CreateHttpsClient(WebApplicationFactory<Program> activeFactory) =>
        activeFactory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });

    private static HttpRequestMessage AuthorizedGet(string path)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("X-Content-Activation-Token", TestActivationToken);
        return request;
    }

    private static HttpRequestMessage AuthorizedPost(string path)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path);
        request.Headers.Add("X-Content-Activation-Token", TestActivationToken);
        return request;
    }

    private static async Task<(string? ReleaseId, string Version)> GetActiveContentAsync(HttpClient httpsClient)
    {
        using var request = AuthorizedGet("/internal/content/active");
        using var response = await httpsClient.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return (body.RootElement.GetProperty("contentReleaseId").GetString(), body.RootElement.GetProperty("contentVersion").GetString()!);
    }

    private static string CreateRelease(string releasesRoot, string releaseId, string siteName)
    {
        var releaseRoot = Path.Combine(releasesRoot, releaseId);
        var pages = Path.Combine(releaseRoot, "pages");
        Directory.CreateDirectory(pages);
        File.WriteAllText(Path.Combine(releaseRoot, "site.json"), JsonSerializer.Serialize(new
        {
            supportedLocales = new[] { "sv-SE" },
            siteName
        }));
        foreach (var slug in new[] { "home", "services", "contact", "projects", "cv" })
            File.WriteAllText(Path.Combine(pages, slug + ".md"), $"---\ntitle: {siteName} {slug}\ndescription: Private {slug} content\nlocale: sv-SE\nstatus: published\ntype: page\n---\n# {siteName} {slug}");
        return pages;
    }

    private static async Task<ContentSnapshot> LoadReleaseAsync(string releasesRoot, string releaseId) =>
        await new ContentSnapshotLoader(["home", "services", "contact", "projects", "cv"])
            .LoadAsync(Path.Combine(releasesRoot, releaseId, "pages"));

}
