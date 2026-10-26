using System.Net;
using System.Text.Json;
using Portfolio.Content;

var builder = WebApplication.CreateBuilder(args);
var contentRoot = ResolveContentRoot(builder.Environment.ContentRootPath);
var sitePath = Path.GetFullPath(Path.Combine(contentRoot, "..", "site.json"));
var siteSettings = JsonSerializer.Deserialize<SiteSettings>(await File.ReadAllTextAsync(sitePath), new JsonSerializerOptions(JsonSerializerDefaults.Web))
    ?? throw new InvalidOperationException("The content/site.json configuration is invalid.");
var contentService = new MarkdownContentService();
var pages = await contentService.LoadDirectoryAsync(contentRoot);
var validationErrors = contentService.Validate(pages, siteSettings.SupportedLocales.ToHashSet(StringComparer.OrdinalIgnoreCase));
if (validationErrors.Count > 0) throw new ContentValidationException(validationErrors);

var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();

var routes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
{
    ["/"] = "home",
    ["/profile"] = "profile",
    ["/services"] = "services",
    ["/contact"] = "contact"
};

foreach (var (route, slug) in routes)
{
    app.MapGet(route, () =>
    {
        var page = pages.FirstOrDefault(item => item.Slug.Equals(slug, StringComparison.OrdinalIgnoreCase)
            && item.Status == "published" && siteSettings.SupportedLocales.Contains(item.Locale, StringComparer.OrdinalIgnoreCase));
        if (page is null) return Results.NotFound();

        var contact = route.Equals("/contact", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(siteSettings.ContactEmail)
            ? $"<p><a href=\"mailto:{WebUtility.HtmlEncode(siteSettings.ContactEmail)}\">{WebUtility.HtmlEncode(siteSettings.ContactEmail)}</a></p>"
            : "";
        var html = $"<!doctype html><html lang=\"{WebUtility.HtmlEncode(page.Locale)}\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{WebUtility.HtmlEncode(page.Title)} · {WebUtility.HtmlEncode(siteSettings.SiteName)}</title><meta name=\"description\" content=\"{WebUtility.HtmlEncode(page.Description)}\"><link rel=\"stylesheet\" href=\"/css/site.css\"></head><body><a class=\"skip-link\" href=\"#main\">Hoppa till innehåll</a><header><a class=\"brand\" href=\"/\">{WebUtility.HtmlEncode(siteSettings.SiteName)}</a><nav aria-label=\"Huvudnavigation\"><a href=\"/profile\">Profil</a><a href=\"/services\">Tjänster</a><a href=\"/contact\">Kontakt</a></nav></header><main id=\"main\"><article>{contentService.Render(page.Markdown)}{contact}</article></main><footer>{WebUtility.HtmlEncode(siteSettings.SiteName)}</footer></body></html>";
        return Results.Content(html, "text/html; charset=utf-8");
    });
}

app.Run();

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

internal sealed record SiteSettings(string[] SupportedLocales, string? ContactEmail, string SiteName);

