using System.Globalization;
using System.Text.RegularExpressions;
using AngleSharp.Dom;
using AngleSharp.Html.Parser;

namespace Portfolio.Content;

public sealed record CvFigure(int Count, string Suffix, string Label);

public sealed record CvAssignment(
    string Id,
    string Title,
    string Role,
    int StartYear,
    int? EndYear,
    bool Ongoing,
    IReadOnlyList<string> Keywords);

public sealed record SkillGroup(string Name, IReadOnlyList<string> Skills);

public sealed record CvView(
    string Name,
    string? Kicker,
    IReadOnlyList<string> Roles,
    string? Summary,
    IReadOnlyList<CvFigure> Figures,
    IReadOnlyList<CvAssignment> Assignments,
    IReadOnlyList<SkillGroup> SkillGroups,
    string BeforeHistoryHtml,
    string HistoryHeadingHtml,
    string HistoryId,
    string AssignmentsHtml,
    string AfterHistoryHtml);

// Swedish heading names the CV Markdown is expected to use; override for another language or template.
public sealed record CvHeadings(
    string Roles = "Roller",
    string Overview = "Översikt",
    string Industries = "Branscherfarenhet",
    string History = "Uppdragshistorik",
    string Employment = "Anställningar",
    string Skills = "Nyckelteknik",
    string Keywords = "Nyckelord",
    string Period = "Period",
    string Role = "Roll",
    string Ongoing = "pågående");

/// <summary>
/// Turns the sanitized HTML of the CV page into a structured view: hero facts, assignment cards,
/// skill chips and the data behind the git graph. Returns null when the document does not follow
/// the expected structure so the page can fall back to plain Markdown rendering.
/// </summary>
public static class CvPresenter
{
    private static readonly Regex PeriodPattern = new(
        @"(?<start>\d{4})(?:\s*[-–—]\s*(?<end>\d{4}|[\p{L}]+))?",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex YearsPattern = new(
        @"över\s+(?<years>\d+)\s+års", RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    public static CvView? Build(string renderedHtml, CvHeadings? headings = null)
    {
        var names = headings ?? new CvHeadings();
        using var document = new HtmlParser().ParseDocument(renderedHtml);
        var body = document.Body;
        if (body is null) return null;

        var sections = SplitSections(body.Children.ToList());
        var history = Find(sections, names.History);
        var h1 = sections[0].Items.FirstOrDefault(item => item.LocalName == "h1");
        if (history is null || h1 is null || !history.Items.Any(item => item.LocalName == "h3")) return null;

        var skillGroups = TransformSkillGroups(document, sections, names);
        var (introHtml, cards, assignments) = BuildAssignments(document, history, names);
        if (assignments.Count == 0) return null;

        var roles = Find(sections, names.Roles)?.Items.FirstOrDefault(item => item.LocalName == "ul")
            ?.Children.Select(item => item.TextContent.Trim()).Where(text => text.Length > 0).ToList() ?? [];
        var overview = Find(sections, names.Overview);
        var firstParagraph = overview?.Items.FirstOrDefault(item => item.LocalName == "p")?.TextContent.Trim();
        var yearsMatch = overview is null ? Match.Empty : YearsPattern.Match(string.Join(' ', overview.Items.Select(item => item.TextContent)));
        var industries = Find(sections, names.Industries)?.Items.FirstOrDefault(item => item.LocalName == "p")
            ?.TextContent.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Length ?? 0;

        var figures = new List<CvFigure>();
        if (yearsMatch.Success) figures.Add(new(int.Parse(yearsMatch.Groups["years"].Value, CultureInfo.InvariantCulture), "+", "års erfarenhet"));
        figures.Add(new(assignments.Count, string.Empty, "uppdrag"));
        if (industries > 0) figures.Add(new(industries, string.Empty, "branscher"));
        var technologyCount = skillGroups.SelectMany(group => group.Skills).Distinct(StringComparer.OrdinalIgnoreCase).Count();
        if (technologyCount > 0) figures.Add(new(technologyCount, string.Empty, "nyckelteknologier"));

        var historyIndex = sections.IndexOf(history);
        var before = string.Concat(sections.Take(historyIndex).SelectMany(section => Render(section, names.Roles, h1)));
        var after = string.Concat(sections.Skip(historyIndex + 1).SelectMany(section => Render(section, names.Roles, h1)));

        return new CvView(
            h1.TextContent.Trim(),
            BuildKicker(Find(sections, names.Employment), names),
            roles,
            FirstSentence(firstParagraph),
            figures,
            assignments,
            skillGroups,
            before,
            history.Heading!.OuterHtml,
            history.Heading.Id ?? string.Empty,
            introHtml + string.Concat(cards.Select(card => card.OuterHtml)),
            after);
    }

    private sealed class Section(IElement? heading)
    {
        public IElement? Heading { get; } = heading;
        public List<IElement> Items { get; } = [];
    }

    private static List<Section> SplitSections(IEnumerable<IElement> elements)
    {
        var sections = new List<Section> { new(null) };
        foreach (var element in elements)
        {
            if (element.LocalName == "h2") sections.Add(new Section(element));
            else sections[^1].Items.Add(element);
        }
        return sections;
    }

    private static Section? Find(IEnumerable<Section> sections, string title) =>
        sections.FirstOrDefault(section => section.Heading is not null && Matches(section.Heading.TextContent, title));

    private static bool Matches(string text, string expected) =>
        string.Equals(text.Trim(), expected, StringComparison.OrdinalIgnoreCase);

    private static IEnumerable<string> Render(Section section, string rolesTitle, IElement h1)
    {
        // Roles and the H1 live in the hero, so they are left out of the article body.
        if (section.Heading is not null && Matches(section.Heading.TextContent, rolesTitle)) yield break;
        if (section.Heading is not null) yield return section.Heading.OuterHtml;
        foreach (var item in section.Items)
            if (!ReferenceEquals(item, h1)) yield return item.OuterHtml;
    }

    private static string? BuildKicker(Section? employment, CvHeadings names)
    {
        var first = employment?.Items.FirstOrDefault(item => item.LocalName == "ul")?.Children.FirstOrDefault()?.TextContent.Trim();
        if (string.IsNullOrWhiteSpace(first)) return null;
        var parts = first.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 3) return first;
        var period = PeriodPattern.Match(parts[^1]);
        var ongoing = period.Success && period.Groups["end"].Success && !char.IsDigit(period.Groups["end"].Value[0]);
        var since = ongoing ? $" · sedan {period.Groups["start"].Value}" : string.Empty;
        return $"{parts[1]} · {parts[0]}{since}";
    }

    private static string? FirstSentence(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var end = text.IndexOf(". ", StringComparison.Ordinal);
        return end < 0 ? text : text[..(end + 1)];
    }

    private static List<SkillGroup> TransformSkillGroups(IDocument document, IEnumerable<Section> sections, CvHeadings names)
    {
        var groups = new List<SkillGroup>();
        foreach (var section in sections)
        {
            for (var index = 0; index < section.Items.Count; index++)
            {
                var paragraph = section.Items[index];
                if (paragraph.LocalName != "p" || !Matches(paragraph.FirstElementChild?.TextContent ?? string.Empty, names.Skills)) continue;
                if (paragraph.NextElementSibling is not { LocalName: "ul" } list) continue;

                var container = document.CreateElement("div");
                container.ClassName = "skill-groups";
                var title = document.CreateElement("p");
                title.ClassName = "skill-groups-title";
                title.TextContent = names.Skills;
                container.AppendChild(title);

                foreach (var item in list.Children)
                {
                    var text = item.TextContent.Trim();
                    var colon = text.IndexOf(':');
                    var groupName = colon > 0 ? text[..colon].Trim() : names.Skills;
                    var skills = (colon > 0 ? text[(colon + 1)..] : text)
                        .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
                    if (skills.Length == 0) continue;
                    groups.Add(new SkillGroup(groupName, skills));

                    var group = document.CreateElement("div");
                    group.ClassName = "skill-group";
                    group.SetAttribute("role", "group");
                    group.SetAttribute("aria-label", groupName);
                    var label = document.CreateElement("p");
                    label.ClassName = "skill-group-name";
                    label.TextContent = groupName;
                    var chips = document.CreateElement("ul");
                    chips.ClassName = "chips";
                    foreach (var skill in skills)
                    {
                        var chip = document.CreateElement("li");
                        chip.SetAttribute("data-skill", skill);
                        chip.TextContent = skill;
                        chips.AppendChild(chip);
                    }
                    group.Append(label, chips);
                    container.AppendChild(group);
                }

                section.Items[index] = container;
                section.Items.Remove(list);
                paragraph.Replace(container);
                list.Remove();
                break;
            }
        }
        return groups;
    }

    private static (string IntroHtml, List<IElement> Cards, List<CvAssignment> Assignments) BuildAssignments(
        IDocument document, Section history, CvHeadings names)
    {
        var intro = new List<IElement>();
        var cards = new List<IElement>();
        var assignments = new List<CvAssignment>();
        IElement? heading = null;
        var group = new List<IElement>();

        foreach (var item in history.Items)
        {
            if (item.LocalName == "h3")
            {
                Flush();
                heading = item;
                group = [];
            }
            else if (heading is null) intro.Add(item);
            else group.Add(item);
        }
        Flush();
        return (string.Concat(intro.Select(item => item.OuterHtml)), cards, assignments);

        void Flush()
        {
            if (heading is null) return;
            var title = heading.TextContent.Trim();
            var meta = group.FirstOrDefault(item => item.LocalName == "p" && item.TextContent.TrimStart().StartsWith(names.Period + ":", StringComparison.OrdinalIgnoreCase));
            var (period, role) = meta is null ? (string.Empty, string.Empty) : SplitMeta(meta.TextContent, names);
            var keywordsHeading = group.FirstOrDefault(item => item.LocalName == "h4" && Matches(item.TextContent, names.Keywords));
            var keywordsParagraph = keywordsHeading?.NextElementSibling is { LocalName: "p" } next ? next : null;
            var keywords = keywordsParagraph?.TextContent.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries) ?? [];

            var parsed = PeriodPattern.Match(period);
            CvAssignment? assignment = null;
            if (parsed.Success)
            {
                var start = int.Parse(parsed.Groups["start"].Value, CultureInfo.InvariantCulture);
                var endGroup = parsed.Groups["end"];
                var ongoing = endGroup.Success && !char.IsDigit(endGroup.Value[0]);
                int? end = !endGroup.Success ? start : ongoing ? null : int.Parse(endGroup.Value, CultureInfo.InvariantCulture);
                assignment = new CvAssignment(heading.Id ?? string.Empty, title, role, start, end, ongoing, keywords);
                assignments.Add(assignment);
            }

            var card = document.CreateElement("section");
            card.ClassName = "assignment";
            if (!string.IsNullOrEmpty(heading.Id)) card.SetAttribute("aria-labelledby", heading.Id);
            if (keywords.Length > 0) card.SetAttribute("data-keywords", string.Join('|', keywords));
            card.AppendChild(heading);
            if (meta is not null)
            {
                var metaElement = document.CreateElement("p");
                metaElement.ClassName = "assignment-meta";
                var periodElement = document.CreateElement("span");
                periodElement.ClassName = "assignment-period";
                periodElement.TextContent = assignment is null ? period : DescribePeriod(assignment, names);
                var roleElement = document.CreateElement("span");
                roleElement.ClassName = "assignment-role";
                roleElement.TextContent = role;
                metaElement.Append(periodElement, roleElement);
                card.AppendChild(metaElement);
            }
            if (keywords.Length > 0)
            {
                var tags = document.CreateElement("div");
                tags.ClassName = "assignment-tags";
                var label = document.CreateElement("h4");
                label.ClassName = "visually-hidden";
                label.TextContent = names.Keywords;
                var list = document.CreateElement("ul");
                list.ClassName = "tags";
                foreach (var keyword in keywords)
                {
                    var tag = document.CreateElement("li");
                    tag.TextContent = keyword;
                    list.AppendChild(tag);
                }
                tags.Append(label, list);
                card.AppendChild(tags);
            }
            foreach (var item in group)
            {
                if (ReferenceEquals(item, meta) || ReferenceEquals(item, keywordsHeading) || ReferenceEquals(item, keywordsParagraph)) continue;
                card.AppendChild(item);
            }
            cards.Add(card);
        }
    }

    private static (string Period, string Role) SplitMeta(string text, CvHeadings names)
    {
        text = text.TrimStart();
        var roleMarker = text.IndexOf(names.Role + ":", StringComparison.OrdinalIgnoreCase);
        var periodMarker = names.Period.Length + 1;
        var periodText = roleMarker < 0 ? text[periodMarker..] : text[periodMarker..roleMarker];
        var roleText = roleMarker < 0 ? string.Empty : text[(roleMarker + names.Role.Length + 1)..];
        return (periodText.Trim(), roleText.Trim());
    }

    public static string DescribePeriod(CvAssignment assignment, CvHeadings? headings = null)
    {
        var names = headings ?? new CvHeadings();
        if (assignment.Ongoing) return $"{assignment.StartYear} – {names.Ongoing}";
        return assignment.EndYear is { } end && end != assignment.StartYear
            ? $"{assignment.StartYear} – {end}"
            : assignment.StartYear.ToString(CultureInfo.InvariantCulture);
    }
}
