using System.Security.Cryptography;
using System.Text;
using System.Threading.RateLimiting;
using System.Xml.Linq;
using System.Diagnostics;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Http.HttpResults;
using OpenTelemetry.Resources;
using OpenTelemetry.Metrics;
using OpenTelemetry.Trace;
using Portfolio.Content;
using Portfolio.Contracts;
using Portfolio.Experience;
using Portfolio.Infrastructure;
using Portfolio.Web;
using Portfolio.Web.Components;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options => options.AddServerHeader = false);
builder.Services.AddSingleton<TimeProvider, SystemReleaseClock>();
builder.Services.AddRazorComponents();
builder.Services.AddHttpContextAccessor();
builder.Services.Configure<TurnstileOptions>(builder.Configuration.GetSection(TurnstileOptions.SectionName));
builder.Services.Configure<SmtpOptions>(builder.Configuration.GetSection(SmtpOptions.SectionName));
builder.Services.AddSingleton(provider => provider.GetRequiredService<Microsoft.Extensions.Options.IOptions<TurnstileOptions>>().Value);
builder.Services.AddSingleton(provider => provider.GetRequiredService<Microsoft.Extensions.Options.IOptions<SmtpOptions>>().Value);
builder.Services.AddSingleton<ContactFormSettings>();
builder.Services.AddHttpClient<ICaptchaVerifier, TurnstileCaptchaVerifier>(client => client.Timeout = TimeSpan.FromSeconds(5));
builder.Services.AddSingleton<IContactSender, SmtpContactSender>();
builder.Services.AddScoped<ContactSubmissionService>();
// Contact form submissions are limited per client address; no address is stored or logged.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = async (context, token) =>
    {
        context.HttpContext.Response.ContentType = "text/plain; charset=utf-8";
        await context.HttpContext.Response.WriteAsync("För många försök. Vänta en stund och försök igen.", token);
    };
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
        HttpMethods.IsPost(context.Request.Method) && context.Request.Path.StartsWithSegments("/contact")
            ? RateLimitPartition.GetFixedWindowLimiter(
                context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 5, Window = TimeSpan.FromMinutes(10), QueueLimit = 0 })
            : RateLimitPartition.GetNoLimiter("other"));
});
var releaseIdentity = ReleaseIdentity.Load(builder.Environment.ContentRootPath);
builder.Services.AddSingleton(releaseIdentity);
builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource.AddService("cv-online-presenter", serviceVersion: releaseIdentity.BuildId))
    .WithTracing(tracing =>
    {
        tracing.AddSource(PortfolioTelemetry.InstrumentationName);
        if (!string.IsNullOrWhiteSpace(builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"])) tracing.AddOtlpExporter();
    })
    .WithMetrics(metrics =>
    {
        metrics.AddMeter(PortfolioTelemetry.InstrumentationName);
        if (!string.IsNullOrWhiteSpace(builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"])) metrics.AddOtlpExporter();
    });

var releasesRoot = builder.Configuration["Content:ReleasesRoot"];
var configuredActivationToken = builder.Configuration["Content:ActivationToken"];
// A relative root (appsettings.Production.json) resolves against the app folder, so no host-level environment variables are needed.
var releaseCatalog = string.IsNullOrWhiteSpace(releasesRoot)
    ? null
    : new ContentReleaseCatalog(Path.GetFullPath(releasesRoot, builder.Environment.ContentRootPath));
string? ResolveActivationToken() => !string.IsNullOrWhiteSpace(configuredActivationToken)
    ? configuredActivationToken
    : releaseCatalog?.ReadActivationToken();
var contentRoot = ResolveContentRoot(builder.Environment.ContentRootPath);
var loader = new ContentSnapshotLoader(PortfolioRoutes.CorePages.Values.ToArray());
var (initialSnapshot, activeReleaseId, startupWarning) = await LoadInitialSnapshotAsync(loader, releaseCatalog, contentRoot);
var store = new ContentSnapshotStore(initialSnapshot, loader);
var service = new MarkdownContentService();
builder.Services.AddSingleton(store);
builder.Services.AddSingleton(provider => new SiteContent(store, provider.GetRequiredService<IHttpContextAccessor>(), service));

var app = builder.Build();
if (startupWarning is not null) app.Logger.LogWarning("{Message}", startupWarning);
app.Logger.LogInformation("Serving content {Source} with snapshot {Version}", activeReleaseId is null ? "bundled with the app" : $"release {activeReleaseId}", initialSnapshot.Version);
var siteContent = app.Services.GetRequiredService<SiteContent>();
var contactForm = app.Services.GetRequiredService<ContactFormSettings>();
const string baseCsp = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
// Turnstile needs its script, frame and verification traffic; the allowance is limited to the contact page and only when the form is on.
const string contactCsp = $"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' {ContactFormSettings.TurnstileOrigin}; frame-src {ContactFormSettings.TurnstileOrigin}; connect-src 'self' {ContactFormSettings.TurnstileOrigin}; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
if (app.Environment.IsDevelopment()) app.UseDeveloperExceptionPage();
else app.UseExceptionHandler(errorApp => errorApp.Run(async context =>
{
    context.Response.StatusCode = StatusCodes.Status500InternalServerError;
    context.Response.ContentType = "text/plain; charset=utf-8";
    context.Response.Headers["Cache-Control"] = "no-store";
    await context.Response.WriteAsync("Ett oväntat fel inträffade.");
}));
app.Use(async (context, next) =>
{
    context.Items[typeof(ContentSnapshot)] = store.Current;
    context.Response.Headers["Content-Security-Policy"] = contactForm.IsEnabled && context.Request.Path.StartsWithSegments("/contact") ? contactCsp : baseCsp;
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Cache-Control"] = "no-cache";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    context.Response.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
    if (app.Environment.IsProduction() && siteContent.SiteUrl?.StartsWith("https://", StringComparison.OrdinalIgnoreCase) == true && context.Request.IsHttps)
        context.Response.Headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
    context.Response.OnStarting(() =>
    {
        var relativePath = context.Request.Path.Value?.TrimStart('/');
        var assetRevision = context.RequestServices.GetRequiredService<ReleaseIdentity>().AppRevision;
        if (relativePath is not null
            && IsCacheableStaticAsset(relativePath)
            && (string.Equals(relativePath, "css/fonts.css", StringComparison.Ordinal)
                || app.Environment.WebRootFileProvider.GetFileInfo(relativePath) is { Exists: true, IsDirectory: false })
            && (context.Response.StatusCode is StatusCodes.Status200OK or StatusCodes.Status304NotModified)
            && IsFullAppRevision(assetRevision)
            && context.Request.Query.TryGetValue("v", out var requestedVersion)
            && requestedVersion.Count == 1
            && string.Equals(requestedVersion[0], assetRevision, StringComparison.Ordinal))
        {
            context.Response.Headers["Cache-Control"] = "public, max-age=31536000, immutable";
        }
        return Task.CompletedTask;
    });
    await next();
});
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseRouting();
app.UseRateLimiter();
app.UseAntiforgery();
app.Use(async (context, next) =>
{
    var route = (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText ?? "unmatched";
    var start = Stopwatch.GetTimestamp();
    using var activity = PortfolioTelemetry.ActivitySource.StartActivity("http.request");
    activity?.SetTag("http.route", route);
    activity?.SetTag("service.version", releaseIdentity.BuildId);
    activity?.SetTag("app.revision", releaseIdentity.AppRevision);
    activity?.SetTag("content.revision", releaseIdentity.ContentRevision);
    using (app.Logger.BeginScope(new Dictionary<string, object>
    {
        ["BuildId"] = releaseIdentity.BuildId,
        ["AppRevision"] = releaseIdentity.AppRevision,
        ["ContentRevision"] = releaseIdentity.ContentRevision
    }))
    {
        try
        {
            await next();
        }
        catch (Exception exception)
        {
            activity?.SetStatus(ActivityStatusCode.Error);
            app.Logger.LogError(exception, "Request failed for route {Route}", route);
            throw;
        }
        finally
        {
            var duration = Stopwatch.GetElapsedTime(start).TotalMilliseconds;
            var tags = new TagList { { "http.route", route }, { "http.response.status_code", context.Response.StatusCode } };
            PortfolioTelemetry.Requests.Add(1, tags);
            PortfolioTelemetry.Duration.Record(duration, tags);
            activity?.SetTag("http.response.status_code", context.Response.StatusCode);
        }
    }
});
app.MapGet("/health", () => Results.Json(new { status = "ok" }));
app.MapGet("/css/fonts.css", (ReleaseIdentity identity) =>
{
    var fontVersion = IsFullAppRevision(identity.AppRevision) ? $"?v={identity.AppRevision}" : string.Empty;
    var fontStylesheet = $$"""
        @font-face {
          font-family: "Barlow Condensed";
          font-style: normal;
          font-weight: 700;
          font-display: swap;
          src: url("/fonts/BarlowCondensed-700.woff2{{fontVersion}}") format("woff2");
        }

        @font-face {
          font-family: "Barlow Condensed";
          font-style: normal;
          font-weight: 800;
          font-display: swap;
          src: url("/fonts/BarlowCondensed-800.woff2{{fontVersion}}") format("woff2");
        }
        """;
    return Results.Text(fontStylesheet, "text/css; charset=utf-8");
});
app.MapGet("/api/search", (string? q) => Results.Json(siteContent.Search(q)));
app.MapGet("/search", () => Results.Redirect("/cv", permanent: true));
app.MapGet("/profile", () => Results.Redirect("/cv", permanent: true));
app.MapGet("/sitemap.xml", (HttpContext context) =>
{
    if (!app.Environment.IsProduction()) context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
    if (siteContent.SiteUrl is null) return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
    XNamespace sitemap = "http://www.sitemaps.org/schemas/sitemap/0.9";
    var xml = new XDocument(new XElement(sitemap + "urlset",
        PublishedPages(siteContent).Select(item => new XElement(sitemap + "url",
            new XElement(sitemap + "loc", $"{siteContent.SiteUrl}{item.Path}")))));
    return Results.Text(xml.ToString(), "application/xml; charset=utf-8");
});
app.MapGet("/llms.txt", (HttpContext context) =>
{
    if (!app.Environment.IsProduction()) context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
    if (siteContent.SiteUrl is null) return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
    var lines = PublishedPages(siteContent).Select(item =>
        $"- {item.Document.Title}: {item.Document.Description.ReplaceLineEndings(" ")} ({siteContent.SiteUrl}{item.Path})");
    return Results.Text($"# {siteContent.Settings.SiteName}{Environment.NewLine}{Environment.NewLine}{string.Join(Environment.NewLine, lines)}{Environment.NewLine}", "text/plain; charset=utf-8");
});
app.MapGet("/robots.txt", (HttpContext context) =>
{
    if (!app.Environment.IsProduction() || siteContent.SiteUrl is null)
    {
        context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
        return Results.Text("User-agent: *\nDisallow: /\n", "text/plain; charset=utf-8");
    }
    return Results.Text($"User-agent: *\nAllow: /\nSitemap: {siteContent.SiteUrl}/sitemap.xml\n", "text/plain; charset=utf-8");
});
if (releaseCatalog is not null)
{
    app.MapPost("/internal/content/{action}/{releaseId}", async (HttpContext context, string action, string releaseId) =>
    {
        // The token is read per request so provisioning the token file needs no app restart.
        var activationToken = ResolveActivationToken();
        if (string.IsNullOrWhiteSpace(activationToken) || !context.Request.IsHttps || !IsAuthorized(context, activationToken)) return Results.NotFound();
        if (action is not ("preview" or "activate") || !ContentReleaseCatalog.IsValidReleaseId(releaseId))
            return Results.BadRequest();
        var pages = releaseCatalog.PagesPath(releaseId);
        try
        {
            var candidate = await loader.LoadAsync(pages, context.RequestAborted);
            var diff = ContentSnapshotLoader.Compare(store.Current, candidate);
            if (action == "activate")
            {
                // The pointer is persisted inside the store's activation lock and only after the candidate loaded,
                // so a restart never selects an invalid release and concurrent activations stay ordered.
                diff = await store.ActivateAsync(pages, context.RequestAborted, () => releaseCatalog.WriteActiveReleaseId(releaseId));
                app.Logger.LogInformation("Activated content release {ReleaseId} with snapshot {Version}", releaseId, diff.ToVersion);
            }
            return Results.Json(diff);
        }
        catch (Exception exception) when (exception is ContentValidationException or IOException or InvalidOperationException or System.Text.Json.JsonException or UnauthorizedAccessException)
        {
            return Results.BadRequest(new { error = exception.Message });
        }
    });
}
app.MapRazorComponents<App>();
app.MapFallback((HttpContext context) =>
{
    context.Response.StatusCode = StatusCodes.Status404NotFound;
    context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
    return new RazorComponentResult<App>();
});
app.Run();

static IEnumerable<(string Path, ContentDocument Document)> PublishedPages(SiteContent content)
{
    foreach (var path in SiteContent.CoreRoutes.Keys)
    {
        if (content.FindByPath(path) is { } document) yield return (path, document);
    }

    foreach (var document in content.PublishedProjects)
        yield return ($"/{document.Slug}", document);
}

static bool IsFullAppRevision(string revision) => revision.Length == 40
    && revision.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');

static bool IsCacheableStaticAsset(string path) => Path.GetExtension(path).ToLowerInvariant() is
    ".css" or ".js" or ".mjs" or ".woff" or ".woff2" or ".ttf" or ".otf"
        or ".svg" or ".png" or ".jpg" or ".jpeg" or ".gif" or ".webp" or ".avif" or ".ico";

static async Task<(ContentSnapshot Snapshot, string? ActiveReleaseId, string? Warning)> LoadInitialSnapshotAsync(
    ContentSnapshotLoader loader, ContentReleaseCatalog? catalog, string bundledPages)
{
    string? warning = null;
    if (catalog is not null)
    {
        try
        {
            if (catalog.ReadActiveReleaseId() is { } releaseId)
                return (await loader.LoadAsync(catalog.PagesPath(releaseId)), releaseId, null);
        }
        catch (Exception exception) when (exception is ContentValidationException or IOException or InvalidOperationException or System.Text.Json.JsonException or UnauthorizedAccessException)
        {
            warning = $"The active content release could not be loaded; falling back to the bundled content: {exception.Message}";
        }
    }
    return (await loader.LoadAsync(bundledPages), null, warning);
}

static string ResolveContentRoot(string webRoot)
{
    var candidates = new[]
    {
        Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "content", "pages")),
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "content", "pages")),
        Path.GetFullPath(Path.Combine(webRoot, "content", "pages"))
    };
    return candidates.FirstOrDefault(Directory.Exists)
        ?? throw new DirectoryNotFoundException("Could not locate the content/pages directory.");
}

static bool IsAuthorized(HttpContext context, string expected)
{
    var actual = context.Request.Headers["X-Content-Activation-Token"].ToString();
    if (string.IsNullOrEmpty(actual)) return false;
    return CryptographicOperations.FixedTimeEquals(
        SHA256.HashData(Encoding.UTF8.GetBytes(actual)),
        SHA256.HashData(Encoding.UTF8.GetBytes(expected)));
}

public partial class Program { }
