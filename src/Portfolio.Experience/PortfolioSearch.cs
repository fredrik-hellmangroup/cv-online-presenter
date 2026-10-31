using System.Text.RegularExpressions;
using Portfolio.Content;
using Portfolio.Contracts;

namespace Portfolio.Experience;

// Path may carry a #fragment pointing at the matching heading; Description is a text excerpt around the match.
public sealed record SearchResult(string Path, string Title, string Description);

public static class PortfolioSearch
{
    private const int MaxResults = 20;
    private const int SnippetRadius = 70;

    public static IReadOnlyList<SearchResult> Find(ContentSnapshot snapshot, string? query, IPublicationPolicy policy)
    {
        if (string.IsNullOrWhiteSpace(query)) return [];
        var term = query.Trim();
        if (term.Length > 100) return [];

        var results = new List<(int Rank, SearchResult Result)>();
        foreach (var document in snapshot.Documents.Where(document => policy.IsPublished(document.Status, document.Locale))
                     .OrderBy(document => document.Title, StringComparer.CurrentCultureIgnoreCase))
        {
            var path = ToPath(document.Slug);
            if (Matches(document.Title, term) || Matches(document.Description, term))
                results.Add((0, new SearchResult(path, document.Title, Snippet(document.Description, term))));

            foreach (var section in MarkdownContentService.ExtractSections(document.Markdown))
            {
                var inHeading = Matches(section.Heading, term);
                if (!inHeading && !Matches(section.Text, term)) continue;
                var title = section.Heading.Length > 0 ? section.Heading : document.Title;
                var fragment = string.IsNullOrEmpty(section.Id) ? string.Empty : "#" + section.Id;
                var excerpt = Snippet(Matches(section.Text, term) ? section.Text : section.Heading, term);
                results.Add((inHeading ? 1 : 2, new SearchResult(path + fragment, title, excerpt)));
            }
        }

        return results.OrderBy(item => item.Rank).Select(item => item.Result).Take(MaxResults).ToArray();
    }

    private static bool Matches(string text, string term) => text.Contains(term, StringComparison.OrdinalIgnoreCase);

    private static string Snippet(string text, string term)
    {
        var flat = Regex.Replace(text, @"\s+", " ").Trim();
        var index = flat.IndexOf(term, StringComparison.OrdinalIgnoreCase);
        if (index < 0) return flat.Length <= SnippetRadius * 2 ? flat : flat[..(SnippetRadius * 2)].TrimEnd() + "…";
        var start = Math.Max(0, index - SnippetRadius);
        var end = Math.Min(flat.Length, index + term.Length + SnippetRadius);
        var excerpt = flat[start..end].Trim();
        return (start > 0 ? "…" : string.Empty) + excerpt + (end < flat.Length ? "…" : string.Empty);
    }

    private static string ToPath(string slug) => slug.Equals("home", StringComparison.OrdinalIgnoreCase) ? "/" : "/" + slug.Trim('/');
}
