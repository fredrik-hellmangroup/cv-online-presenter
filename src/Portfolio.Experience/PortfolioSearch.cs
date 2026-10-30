using Portfolio.Content;
using Portfolio.Contracts;

namespace Portfolio.Experience;

public sealed record SearchResult(string Path, string Title, string Description);

public static class PortfolioSearch
{
    public static IReadOnlyList<SearchResult> Find(ContentSnapshot snapshot, string? query, IPublicationPolicy policy)
    {
        if (string.IsNullOrWhiteSpace(query)) return [];
        var term = query.Trim();
        if (term.Length > 100) return [];
        return snapshot.Documents
            .Where(document => policy.IsPublished(document.Status, document.Locale))
            .Where(document => document.Title.Contains(term, StringComparison.OrdinalIgnoreCase)
                || document.Description.Contains(term, StringComparison.OrdinalIgnoreCase)
                || document.Markdown.Contains(term, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(document => document.Title.Contains(term, StringComparison.OrdinalIgnoreCase))
            .ThenBy(document => document.Title, StringComparer.CurrentCultureIgnoreCase)
            .Select(document => new SearchResult(ToPath(document.Slug), document.Title, document.Description))
            .ToArray();
    }

    private static string ToPath(string slug) => slug.Equals("home", StringComparison.OrdinalIgnoreCase) ? "/" : "/" + slug.Trim('/');
}
