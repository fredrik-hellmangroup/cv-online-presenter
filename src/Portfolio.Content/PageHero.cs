using AngleSharp.Dom;
using AngleSharp.Html.Parser;

namespace Portfolio.Content;

public sealed record PageHeroItem(string Heading, string BodyHtml);

/// <summary>A themed group of panel items, shown as one tab. <c>LeadHtml</c> is the text between the group heading and its first item.</summary>
public sealed record PageHeroGroup(string Heading, string LeadHtml, IReadOnlyList<PageHeroItem> Items);

/// <summary>
/// A page split into a hero (heading and lead) and its side panel. The panel is either a flat list of
/// <see cref="Items"/> or, when the Markdown nests <c>###</c> items under <c>##</c> headings, a set of <see cref="Groups"/>.
/// </summary>
public sealed record PageHeroView(
    string HeadingHtml,
    string LeadHtml,
    IReadOnlyList<PageHeroItem> Items,
    IReadOnlyList<PageHeroGroup> Groups);

/// <summary>
/// Reads the sanitized HTML of a short editorial page: the <c>h1</c> and the paragraphs before the first <c>h2</c>
/// become the hero. Each <c>h2</c> with the content below it becomes a flat panel item, unless any <c>h2</c> contains
/// <c>h3</c> headings: then every <c>h2</c> becomes a group and each <c>h3</c> an item in it. Returns null when the page
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
        var sections = new List<Section>();
        Section? section = null;
        string? itemHeading = null;
        var itemBody = new List<string>();

        foreach (var element in elements)
        {
            if (ReferenceEquals(element, heading)) continue;
            if (element.LocalName == "h2")
            {
                FlushItem();
                section = new Section(element.TextContent.Trim());
                sections.Add(section);
            }
            else if (element.LocalName == "h3" && section is not null)
            {
                FlushItem();
                itemHeading = element.TextContent.Trim();
            }
            else if (section is null) lead.Add(element.OuterHtml);
            else if (itemHeading is null) section.Lead.Add(element.OuterHtml);
            else itemBody.Add(element.OuterHtml);
        }
        FlushItem();

        if (sections.Any(candidate => candidate.Items.Count > 0))
        {
            var groups = sections
                .Select(candidate => new PageHeroGroup(candidate.Heading, string.Concat(candidate.Lead), candidate.Items))
                .ToList();
            return new PageHeroView(heading.OuterHtml, string.Concat(lead), [], groups);
        }

        var items = sections
            .Select(candidate => new PageHeroItem(candidate.Heading, string.Concat(candidate.Lead)))
            .ToList();
        return new PageHeroView(heading.OuterHtml, string.Concat(lead), items, []);

        void FlushItem()
        {
            if (section is not null && itemHeading is not null)
                section.Items.Add(new PageHeroItem(itemHeading, string.Concat(itemBody)));
            itemHeading = null;
            itemBody = [];
        }
    }

    private sealed class Section(string heading)
    {
        public string Heading { get; } = heading;
        public List<string> Lead { get; } = [];
        public List<PageHeroItem> Items { get; } = [];
    }
}
