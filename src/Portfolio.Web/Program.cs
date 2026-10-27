using System.Net;
using System.Text.Json;
using System.Xml.Linq;
using Portfolio.Content;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options => options.AddServerHeader = false);
var contentRoot = ResolveContentRoot(builder.Environment.ContentRootPath);
var sitePath = Path.GetFullPath(Path.Combine(contentRoot, "..", "site.json"));
var settings = JsonSerializer.Deserialize<SiteSettings>(await File.ReadAllTextAsync(sitePath), new JsonSerializerOptions(JsonSerializerDefaults.Web))
    ?? throw new InvalidOperationException("The content/site.json configuration is invalid.");
var service = new MarkdownContentService();
var documents = await service.LoadDirectoryAsync(contentRoot);
var validationErrors = service.Validate(documents, settings.SupportedLocales.ToHashSet(StringComparer.OrdinalIgnoreCase));
if (validationErrors.Count > 0) throw new ContentValidationException(validationErrors);
var siteUrl = NormalizeSiteUrl(settings.SiteUrl);
var app = builder.Build();
app.Use(async (context, next) =>
{
    context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    context.Response.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
    if (app.Environment.IsProduction() && siteUrl?.StartsWith("https://", StringComparison.OrdinalIgnoreCase) == true && context.Request.IsHttps)
        context.Response.Headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
    await next();
});
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapGet("/health", () => Results.Json(new { status = "ok" }));

var routes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
{
    ["/"] = "home",
    ["/profile"] = "profile",
    ["/services"] = "services",
    ["/contact"] = "contact",
    ["/projects"] = "projects"
};

foreach (var (route, slug) in routes)
{
    app.MapGet(route, (HttpContext context) =>
    {
        var page = PublishedPage(slug);
        if (page is null) return Results.NotFound();
        return RenderPage(context, page, route);
    });
}

app.MapGet("/projects/{slug}", (HttpContext context, string slug) =>
{
    var project = documents.FirstOrDefault(item => item.Type == "project"
        && item.Slug.Equals($"projects/{slug}", StringComparison.OrdinalIgnoreCase)
        && IsPublished(item));
    return project is null ? Results.NotFound() : RenderPage(context, project, $"/projects/{slug}");
});

app.MapGet("/sitemap.xml", () =>
{
    if (siteUrl is null) return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
    var paths = routes.Select(pair => (pair.Key, PublishedPage(pair.Value)))
        .Where(item => item.Item2 is not null)
        .Select(item => item.Key)
        .Concat(documents.Where(item => item.Type == "project" && IsPublished(item))
            .Select(item => $"/projects/{item.Slug.Split('/').Last()}"));
    var xml = new XDocument(new XElement("urlset",
        new XAttribute("xmlns", "http://www.sitemaps.org/schemas/sitemap/0.9"),
        paths.Distinct().Select(path => new XElement("url", new XElement("loc", $"{siteUrl}{path}")))));
    return Results.Text(xml.ToString(), "application/xml; charset=utf-8");
});

app.MapGet("/robots.txt", (HttpContext context) =>
{
    if (!app.Environment.IsProduction() || siteUrl is null)
    {
        context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
        return Results.Text("User-agent: *\nDisallow: /\n", "text/plain; charset=utf-8");
    }
    return Results.Text($"User-agent: *\nAllow: /\nSitemap: {siteUrl}/sitemap.xml\n", "text/plain; charset=utf-8");
});

app.Run();

ContentDocument? PublishedPage(string slug) => documents.FirstOrDefault(item => item.Slug.Equals(slug, StringComparison.OrdinalIgnoreCase) && IsPublished(item));
bool IsPublished(ContentDocument page) => page.Status == "published" && settings.SupportedLocales.Contains(page.Locale, StringComparer.OrdinalIgnoreCase);

IResult RenderPage(HttpContext context, ContentDocument page, string path)
{
    if (!app.Environment.IsProduction() || siteUrl is null)
        context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
    var canonical = siteUrl is null ? "" : $"<link rel=\"canonical\" href=\"{Encode(siteUrl + path)}\"><meta property=\"og:url\" content=\"{Encode(siteUrl + path)}\">";
    var contact = path == "/contact" && IsValidEmail(settings.ContactEmail)
        ? $"<p><a href=\"mailto:{Encode(settings.ContactEmail!)}\">{Encode(settings.ContactEmail!)}</a></p>"
        : "";
    var title = $"{page.Title} · {settings.SiteName}";
    var html = $"<!doctype html><html lang=\"{Encode(page.Locale)}\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{Encode(title)}</title><meta name=\"description\" content=\"{Encode(page.Description)}\"><meta property=\"og:type\" content=\"website\"><meta property=\"og:title\" content=\"{Encode(title)}\"><meta property=\"og:description\" content=\"{Encode(page.Description)}\">{canonical}<link rel=\"stylesheet\" href=\"/css/site.css\"></head><body><a class=\"skip-link\" href=\"#main\">Hoppa till innehåll</a><header><a class=\"brand\" href=\"/\">{Encode(settings.SiteName)}</a><nav aria-label=\"Huvudnavigation\"><a href=\"/profile\">Profil</a><a href=\"/services\">Tjänster</a><a href=\"/projects\">Projekt</a><a href=\"/contact\">Kontakt</a></nav></header><main id=\"main\"><article>{service.Render(page.Markdown)}{contact}</article></main><footer>{Encode(settings.SiteName)}</footer></body></html>";
    return Results.Content(html, "text/html; charset=utf-8");
}

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

static string? NormalizeSiteUrl(string? value)
{
    if (string.IsNullOrWhiteSpace(value)) return null;
    if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme is not ("https" or "http"))
        throw new InvalidOperationException("siteUrl must be an absolute HTTP or HTTPS URL.");
    return uri.GetLeftPart(UriPartial.Authority).TrimEnd('/');
}

static bool IsValidEmail(string? value) =>
    !string.IsNullOrWhiteSpace(value) && System.Net.Mail.MailAddress.TryCreate(value, out var address) && address.Address == value;

static string Encode(string value) => WebUtility.HtmlEncode(value);

internal sealed record SiteSettings(string[] SupportedLocales, string? ContactEmail, string SiteName, string? SiteUrl);
