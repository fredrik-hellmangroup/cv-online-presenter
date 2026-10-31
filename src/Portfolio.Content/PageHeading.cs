using System.Text.RegularExpressions;

namespace Portfolio.Content;

/// <summary>
/// Headings may read "Name – tagline". The name stays the large H1 text and the tagline becomes a
/// secondary line inside the same H1, so the page carries both name and role without repeating the name.
/// </summary>
public static class PageHeading
{
    private const string Separator = " – ";

    private static readonly Regex H1Pattern = new(
        @"(?<open><h1(?:\s[^>]*)?>)(?<name>[^<]*?)" + Separator + @"(?<tagline>[^<]*?)(?<close></h1>)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.Singleline);

    public static (string Name, string? Tagline) Split(string heading)
    {
        var index = heading.IndexOf(Separator, StringComparison.Ordinal);
        if (index <= 0) return (heading.Trim(), null);
        var tagline = heading[(index + Separator.Length)..].Trim();
        return (heading[..index].Trim(), tagline.Length == 0 ? null : tagline);
    }

    /// <summary>Rewrites the first "Name – tagline" H1 in rendered, sanitized HTML into name and tagline spans.</summary>
    public static string SplitFirstH1(string renderedHtml) =>
        H1Pattern.Replace(
            renderedHtml,
            match => $"{match.Groups["open"].Value}<span class=\"h1-name\">{match.Groups["name"].Value}</span>"
                + $"<span class=\"h1-tagline\">{match.Groups["tagline"].Value}</span>{match.Groups["close"].Value}",
            1);

    private static readonly Regex AnyH1Pattern = new(
        @"<h1(?:\s[^>]*)?>.*?</h1>\s*",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.Singleline);

    /// <summary>Drops the first H1 from rendered HTML, for pages whose heading is supplied by a hero instead.</summary>
    public static string RemoveFirstH1(string renderedHtml) => AnyH1Pattern.Replace(renderedHtml, string.Empty, 1);

    /// <summary>Initials of a name, for a compact brand mark ("Fredrik Hallerös" becomes "FH").</summary>
    public static string Monogram(string name)
    {
        var letters = name.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(part => char.IsLetter(part[0]))
            .Select(part => char.ToUpperInvariant(part[0]))
            .Take(3)
            .ToArray();
        return letters.Length == 0 ? name : new string(letters);
    }
}
