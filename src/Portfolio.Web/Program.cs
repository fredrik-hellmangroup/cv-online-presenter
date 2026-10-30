using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;
using System.Diagnostics;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Http.HttpResults;
using OpenTelemetry.Resources;
using OpenTelemetry.Metrics;
using OpenTelemetry.Trace;
using Portfolio.Content;
using Portfolio.Infrastructure;
using Portfolio.Web;
using Portfolio.Web.Components;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options => options.AddServerHeader = false);
builder.Services.AddSingleton<TimeProvider, SystemReleaseClock>();
builder.Services.AddRazorComponents();
builder.Services.AddHttpContextAccessor();
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

var contentRoot = ResolveContentRoot(builder.Environment.ContentRootPath);
var loader = new ContentSnapshotLoader();
var initialSnapshot = await loader.LoadAsync(contentRoot);
var store = new ContentSnapshotStore(initialSnapshot, loader);
var service = new MarkdownContentService();
builder.Services.AddSingleton(store);
builder.Services.AddSingleton(provider => new SiteContent(store, provider.GetRequiredService<IHttpContextAccessor>(), service));

var app = builder.Build();
var siteContent = app.Services.GetRequiredService<SiteContent>();
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
    context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Cache-Control"] = "no-cache";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    context.Response.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
    if (app.Environment.IsProduction() && siteContent.SiteUrl?.StartsWith("https://", StringComparison.OrdinalIgnoreCase) == true && context.Request.IsHttps)
        context.Response.Headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
    await next();
});
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseRouting();
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
app.MapGet("/api/search", (string? q) => Results.Json(siteContent.Search(q)));
app.MapGet("/sitemap.xml", () =>
{
    if (siteContent.SiteUrl is null) return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
    var paths = SiteContent.CoreRoutes.Keys.Where(path => siteContent.FindByPath(path) is not null)
        .Concat(siteContent.PublishedProjects.Select(project => $"/projects/{project.Slug.Split('/').Last()}"));
    var xml = new XDocument(new XElement("urlset",
        new XAttribute("xmlns", "http://www.sitemaps.org/schemas/sitemap/0.9"),
        paths.Distinct().Select(path => new XElement("url", new XElement("loc", $"{siteContent.SiteUrl}{path}")))));
    return Results.Text(xml.ToString(), "application/xml; charset=utf-8");
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
var releasesRoot = builder.Configuration["Content:ReleasesRoot"];
var activationToken = builder.Configuration["Content:ActivationToken"];
if (!string.IsNullOrWhiteSpace(releasesRoot) && !string.IsNullOrWhiteSpace(activationToken))
{
    var releaseDirectory = Path.GetFullPath(releasesRoot);
    app.MapPost("/internal/content/{action}/{releaseId}", async (HttpContext context, string action, string releaseId) =>
    {
        if (!context.Request.IsHttps || !IsAuthorized(context, activationToken)) return Results.NotFound();
        if (action is not ("preview" or "activate") || releaseId.Length == 0
            || releaseId.Any(character => !char.IsAsciiLetterOrDigit(character) && character is not ('-' or '_')))
            return Results.BadRequest();
        var pages = Path.Combine(releaseDirectory, releaseId, "pages");
        try
        {
            var candidate = await loader.LoadAsync(pages, context.RequestAborted);
            var diff = ContentSnapshotLoader.Compare(store.Current, candidate);
            if (action == "activate")
            {
                diff = await store.ActivateAsync(pages, context.RequestAborted);
                app.Logger.LogInformation("Activated content release {ReleaseId} with snapshot {Version}", releaseId, diff.ToVersion);
            }
            return Results.Json(diff);
        }
        catch (Exception exception) when (exception is ContentValidationException or IOException or InvalidOperationException or System.Text.Json.JsonException)
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

static string ResolveContentRoot(string webRoot)
{
    var candidates = new[]
    {
        Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "content", "content", "pages")),
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
