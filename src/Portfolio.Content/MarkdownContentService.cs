using System.Text.RegularExpressions;
using Ganss.Xss;
using Markdig;
using YamlDotNet.Core;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace Portfolio.Content;

public sealed class MarkdownContentService
{
    private static readonly IReadOnlyDictionary<string, string[]> RequiredFieldsByType = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
    {
        ["page"] = ["title", "description"],
        ["profile"] = ["displayName", "headline", "summary"],
        ["experience"] = ["role", "organization", "dates", "highlights"],
        ["project"] = ["title", "summary", "technologies", "links"],
        ["service"] = ["label", "description"],
        ["skill"] = ["label", "description"]
    };

    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
        .UseAdvancedExtensions()
        .DisableHtml()
        .Build();

    private static readonly IDeserializer Yaml = new DeserializerBuilder()
        .WithNamingConvention(CamelCaseNamingConvention.Instance)
        .Build();

    private static readonly Regex InternalLinkPattern = new(
        @"(?<!!)\[[^\]]*\]\((?<url>[^)\s]+)", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public ContentDocument Parse(string slug, string sourcePath, string source)
    {
        var (frontMatter, markdown) = SplitFrontMatter(source, sourcePath);
        IReadOnlyDictionary<string, object> metadata;
        try
        {
            metadata = Yaml.Deserialize<Dictionary<string, object>>(frontMatter)
                ?? new Dictionary<string, object>();
        }
        catch (YamlException exception)
        {
            throw new ContentValidationException([new(sourcePath, $"Invalid YAML front matter: {exception.Message}")]);
        }

        string Get(string key) => metadata.TryGetValue(key, out var value) ? value?.ToString()?.Trim() ?? "" : "";

        return new ContentDocument(
            slug,
            Get("title"),
            Get("description"),
            Get("locale"),
            Get("status"),
            Get("type"),
            metadata,
            markdown,
            sourcePath);
    }

    public IReadOnlyList<ContentValidationError> Validate(
        IEnumerable<ContentDocument> documents,
        IReadOnlySet<string> supportedLocales)
    {
        var items = documents.ToArray();
        var publishedSlugs = items.Where(item => item.Status.Equals("published", StringComparison.OrdinalIgnoreCase))
            .Select(item => item.Slug.Trim('/')).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var errors = new List<ContentValidationError>();

        foreach (var document in items)
        {
            void Require(string value, string field)
            {
                if (string.IsNullOrWhiteSpace(value)) errors.Add(new(document.SourcePath, $"Required field '{field}' is missing."));
            }

            Require(document.Title, "title");
            Require(document.Description, "description");
            Require(document.Locale, "locale");
            Require(document.Type, "type");
            if (!RequiredFieldsByType.TryGetValue(document.Type, out var requiredFields))
                errors.Add(new(document.SourcePath, $"Unknown content type '{document.Type}'."));
            else
            {
                foreach (var field in requiredFields)
                {
                    if (!document.Metadata.TryGetValue(field, out var value) || value is null || string.IsNullOrWhiteSpace(value.ToString()))
                        errors.Add(new(document.SourcePath, $"Content type '{document.Type}' requires field '{field}'."));
                }
            }
            if (document.Status is not ("published" or "draft"))
                errors.Add(new(document.SourcePath, "Field 'status' must be 'published' or 'draft'."));
            if (!supportedLocales.Contains(document.Locale))
                errors.Add(new(document.SourcePath, $"Unknown locale '{document.Locale}'. Configure it before publishing content."));
            if (document.Status == "published" && string.IsNullOrWhiteSpace(document.Markdown))
                errors.Add(new(document.SourcePath, "Published content must have a non-empty body."));

            foreach (Match match in InternalLinkPattern.Matches(document.Markdown))
            {
                var target = match.Groups["url"].Value;
                if (HasDisallowedScheme(target))
                    errors.Add(new(document.SourcePath, $"URL scheme is not allowed in '{target}'. Use http, https, mailto, tel, or a site-relative link."));
                else if (IsInternalPath(target))
                {
                    var path = target.Split(['?', '#'], 2)[0].Trim('/');
                    if (path.Length > 0 && !publishedSlugs.Contains(path))
                        errors.Add(new(document.SourcePath, $"Internal link '{target}' does not resolve to published content."));
                }
            }
        }

        return errors;
    }

    public string Render(string markdown)
    {
        var html = Markdown.ToHtml(markdown, Pipeline);
        var sanitizer = new HtmlSanitizer();
        sanitizer.AllowedSchemes.Clear();
        sanitizer.AllowedSchemes.Add("http");
        sanitizer.AllowedSchemes.Add("https");
        sanitizer.AllowedSchemes.Add("mailto");
        sanitizer.AllowedSchemes.Add("tel");
        sanitizer.AllowedTags.Remove("style");
        sanitizer.AllowedAttributes.Remove("style");
        return sanitizer.Sanitize(html);
    }

    public async Task<IReadOnlyList<ContentDocument>> LoadDirectoryAsync(string contentRoot, CancellationToken cancellationToken = default)
    {
        if (!Directory.Exists(contentRoot)) return [];
        var root = Path.GetFullPath(contentRoot);
        var documents = new List<ContentDocument>();
        foreach (var file in Directory.EnumerateFiles(root, "*.md", SearchOption.AllDirectories).Order(StringComparer.Ordinal))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var relative = Path.GetRelativePath(root, file);
            var slug = Path.ChangeExtension(relative, null).Replace('\\', '/');
            var source = await File.ReadAllTextAsync(file, cancellationToken);
            documents.Add(Parse(slug, relative, source));
        }
        return documents;
    }

    private static (string FrontMatter, string Markdown) SplitFrontMatter(string source, string file)
    {
        using var reader = new StringReader(source);
        if (reader.ReadLine()?.Trim() != "---")
            throw new ContentValidationException([new(file, "Markdown must start with YAML front matter delimited by '---'.")]);

        var lines = new List<string>();
        string? line;
        while ((line = reader.ReadLine()) is not null && line.Trim() != "---") lines.Add(line);
        if (line is null)
            throw new ContentValidationException([new(file, "YAML front matter is missing its closing '---'.")]);
        return (string.Join(Environment.NewLine, lines), reader.ReadToEnd());
    }

    private static bool IsInternalPath(string target) =>
        target.StartsWith('/') || target.StartsWith('#') || !target.Contains(':');

    private static bool HasDisallowedScheme(string target)
    {
        if (target.StartsWith('/') || target.StartsWith('#')) return false;
        var colon = target.IndexOf(':');
        if (colon <= 0) return false;
        var scheme = target[..colon];
        return !scheme.Equals("http", StringComparison.OrdinalIgnoreCase)
            && !scheme.Equals("https", StringComparison.OrdinalIgnoreCase)
            && !scheme.Equals("mailto", StringComparison.OrdinalIgnoreCase)
            && !scheme.Equals("tel", StringComparison.OrdinalIgnoreCase);
    }
}
