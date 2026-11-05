using AngleSharp.Dom;
using AngleSharp.Html.Parser;

namespace Portfolio.Content;

public sealed record PageHeroItem(string Heading, string BodyHtml);

/// <summary>A page split into a hero (heading and lead) and the short items that make up its side panel.</summary>
public sealed record PageHeroView(string HeadingHtml, string LeadHtml, IReadOnlyList<PageHeroItem> Items);

/// <summary>
/// Reads the sanitized HTML of a short editorial page: the <c>h1</c> and the paragraphs before the first <c>h2</c>
/// become the hero, and every <c>h2</c> with the content below it becomes a panel item. Returns null when the page
/// has no <c>h1</c> or no <c>h2</c>, so the caller can render the page as plain Markdown instead.
/// </summary>
public static class PageHero
{
    public static PageHeroView? Build(string renderedHtml)
    {
        using var document = new HtmlParser().ParseDocument(renderedHtml);
        var elements = document.Body?.Children.ToList() ?? [];
        var heading = elements.FirstOrDefault(element => element.LocalName == "h1");
        if (heading is null || !elements.Any(element => element.LocalName == "h2")) return null;

        var lead = new List<string>();
        var items = new List<PageHeroItem>();
        string? itemHeading = null;
        var itemBody = new List<string>();

        foreach (var element in elements)
        {
            if (ReferenceEquals(element, heading)) continue;
            if (element.LocalName == "h2")
            {
                Flush();
                itemHeading = element.TextContent.Trim();
                itemBody = [];
            }
            else if (itemHeading is null) lead.Add(element.OuterHtml);
            else itemBody.Add(element.OuterHtml);
        }
        Flush();

        return new PageHeroView(heading.OuterHtml, string.Concat(lead), items);

        void Flush()
        {
            if (itemHeading is not null) items.Add(new PageHeroItem(itemHeading, string.Concat(itemBody)));
        }
    }
}
