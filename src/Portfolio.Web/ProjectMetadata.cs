using System.Collections;
using System.Globalization;
using Portfolio.Content;

namespace Portfolio.Web;

/// <summary>Reads the optional presentation metadata of a project document (front matter).</summary>
public static class ProjectMetadata
{
    public static string Text(ContentDocument document, string key) =>
        document.Metadata.TryGetValue(key, out var value) ? value?.ToString()?.Trim() ?? string.Empty : string.Empty;

    public static IReadOnlyList<string> Technologies(ContentDocument document)
    {
        if (!document.Metadata.TryGetValue("technologies", out var value)) return [];
        var items = value is IEnumerable sequence and not string
            ? sequence.Cast<object?>().Where(item => item is not null).Select(item => item!.ToString()!)
            : (value?.ToString() ?? string.Empty).Split(',');
        return items.Select(item => item.Trim()).Where(item => item.Length > 0).ToList();
    }

    /// <summary>Optional sort key; projects without one come last, then alphabetically.</summary>
    public static int Order(ContentDocument document) =>
        int.TryParse(Text(document, "order"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var order) ? order : int.MaxValue;

    /// <summary>The line above a project card title: period and category (or industry) when the front matter provides them.</summary>
    public static string CardMeta(ContentDocument document)
    {
        var category = Text(document, "category");
        if (category.Length == 0) category = Text(document, "industry");
        return string.Join(" · ", new[] { Text(document, "period"), category }.Where(part => part.Length > 0));
    }
}
