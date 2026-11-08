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
    IReadOnlyList<string> Keywords,
    string? Url = null);

// How the catch-all group of keywords outside techGroups is trimmed: concepts are left out, then at most Limit remain.
// Ties in usage are broken with Random (Random.Shared when null).
public sealed record OtherSkillsOptions(int Limit, IReadOnlyCollection<string>? Concepts = null, Random? Random = null);

public sealed record SkillGroup(string Name, IReadOnlyList<string> Skills);

public sealed record CvView(
    string Name,
    string? Tagline,
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
    string Skills = "Teknik i uppdragen",
    string Keywords = "Nyckelord",
    string Period = "Period",
    string Role = "Roll",
    string Ongoing = "pågående",
    string Practical = "Praktiskt",
    string Competence = "Kompetensområden",
    string OtherSkills = "Övrigt");

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

    public static CvView? Build(
        string renderedHtml, CvHeadings? headings = null, Func<string, string?>? projectUrl = null, IReadOnlyList<TechGroup>? techGroups = null,
        OtherSkillsOptions? otherSkills = null)
    {
        var names = headings ?? new CvHeadings();
        using var document = new HtmlParser().ParseDocument(renderedHtml);
        var body = document.Body;
        if (body is null) return null;

        var sections = SplitSections(body.Children.ToList());
        var history = Find(sections, names.History);
        var h1 = sections[0].Items.FirstOrDefault(item => item.LocalName == "h1");
        if (history is null || h1 is null || !history.Items.Any(item => item.LocalName == "h3")) return null;
        var h1Index = sections[0].Items.IndexOf(h1);
        var taglineParagraph = sections[0].Items.Skip(h1Index + 1).FirstOrDefault(item => item.LocalName == "p");
        var tagline = taglineParagraph?.TextContent.Trim();
        if (string.IsNullOrWhiteSpace(tagline)) tagline = null;

        var (introHtml, cards, assignments) = BuildAssignments(document, history, names, projectUrl);
        if (assignments.Count == 0) return null;

        var skillGroups = DeriveSkillGroups(assignments, techGroups, names, otherSkills, out var ungroupedCount);
        var skillsContainer = BuildSkillGroups(document, skillGroups, names);
        var competence = Find(sections, names.Competence);
        if (competence is not null) BuildCompetenceTabs(document, competence);
        if (skillsContainer is not null && competence is not null) competence.Items.Add(skillsContainer);

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
        // Ungrouped keywords are not counted as technologies once the content defines groups.
        var technologyCount = skillGroups.Sum(group => group.Skills.Count) - ungroupedCount;
        if (technologyCount > 0) figures.Add(new(technologyCount, string.Empty, "nyckelteknologier"));

        var historyIndex = sections.IndexOf(history);
        var practicalHtml = BuildPractical(document, Find(sections, names.Practical));
        var before = string.Concat(sections.Take(historyIndex).SelectMany(section => Render(section, names, h1, taglineParagraph, practicalHtml)));
        var after = (skillsContainer is not null && competence is null ? skillsContainer.OuterHtml : string.Empty)
            + string.Concat(sections.Skip(historyIndex + 1).SelectMany(section => Render(section, names, h1, taglineParagraph, practicalHtml)));

        return new CvView(
            h1.TextContent.Trim(),
            tagline,
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

    private static IEnumerable<string> Render(Section section, CvHeadings names, IElement h1, IElement? taglineParagraph, string practicalHtml)
    {
        // Roles, the H1 and its tagline live in the hero, so they are left out of the article body.
        if (section.Heading is not null && Matches(section.Heading.TextContent, names.Roles)) yield break;
        // The practical facts are shown as cards at the end of the overview instead of as a section of their own.
        if (section.Heading is not null && Matches(section.Heading.TextContent, names.Practical)) yield break;
        if (section.Heading is not null) yield return section.Heading.OuterHtml;
        foreach (var item in section.Items)
            if (!ReferenceEquals(item, h1) && !ReferenceEquals(item, taglineParagraph)) yield return item.OuterHtml;
        if (section.Heading is not null && Matches(section.Heading.TextContent, names.Overview)) yield return practicalHtml;
    }

    // "Label: value" list items become small fact cards (availability, working model, references...).
    private static string BuildPractical(IDocument document, Section? practical)
    {
        var list = practical?.Items.FirstOrDefault(item => item.LocalName == "ul");
        if (list is null) return string.Empty;
        var facts = document.CreateElement("dl");
        facts.ClassName = "practical";
        facts.SetAttribute("aria-label", practical!.Heading!.TextContent.Trim());
        foreach (var item in list.Children)
        {
            var text = item.TextContent.Trim();
            var colon = text.IndexOf(':');
            if (colon <= 0 || colon == text.Length - 1) continue;
            var card = document.CreateElement("div");
            var term = document.CreateElement("dt");
            term.TextContent = text[..colon].Trim();
            var description = document.CreateElement("dd");
            description.TextContent = text[(colon + 1)..].Trim();
            card.Append(term, description);
            facts.AppendChild(card);
        }
        return facts.HasChildNodes ? facts.OuterHtml : string.Empty;
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

    // The technology list is the union of the assignment keywords. Site settings only decide which group a keyword is
    // listed under; most used first within a group, and keywords without a group end up last under "other", where
    // concepts are left out and only the most used few are kept (ties are picked at random).
    private static List<SkillGroup> DeriveSkillGroups(
        IEnumerable<CvAssignment> assignments, IReadOnlyList<TechGroup>? mapping, CvHeadings names, OtherSkillsOptions? otherSkills, out int ungroupedCount)
    {
        var usage = new Dictionary<string, (string Name, int Count)>(StringComparer.OrdinalIgnoreCase);
        foreach (var assignment in assignments)
            foreach (var keyword in assignment.Keywords.Distinct(StringComparer.OrdinalIgnoreCase))
                usage[keyword] = usage.TryGetValue(keyword, out var seen) ? (seen.Name, seen.Count + 1) : (keyword, 1);

        var remaining = usage.Values
            .OrderByDescending(entry => entry.Count)
            .ThenBy(entry => entry.Name, StringComparer.InvariantCultureIgnoreCase)
            .ToList();
        var groups = new List<SkillGroup>();
        foreach (var group in mapping ?? [])
        {
            var members = remaining.Where(entry => group.Items.Contains(entry.Name, StringComparer.OrdinalIgnoreCase)).ToList();
            if (members.Count == 0) continue;
            remaining.RemoveAll(members.Contains);
            groups.Add(new SkillGroup(group.Name, members.Select(entry => entry.Name).ToList()));
        }
        var grouped = mapping is { Count: > 0 };
        if (grouped && otherSkills is not null) remaining = LimitOther(remaining, otherSkills);
        // Keywords without a group are not counted as technologies once the content defines groups.
        ungroupedCount = grouped ? remaining.Count : 0;
        if (remaining.Count > 0)
            groups.Add(new SkillGroup(grouped ? names.OtherSkills : names.Skills, remaining.Select(entry => entry.Name).ToList()));
        return groups;
    }

    private static List<(string Name, int Count)> LimitOther(List<(string Name, int Count)> remaining, OtherSkillsOptions options)
    {
        var concepts = (options.Concepts ?? []).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var random = options.Random ?? Random.Shared;
        return remaining
            .Where(entry => !concepts.Contains(entry.Name))
            .Select(entry => (Entry: entry, Tie: random.Next()))
            .OrderByDescending(candidate => candidate.Entry.Count)
            .ThenBy(candidate => candidate.Tie)
            .Take(Math.Max(0, options.Limit))
            .Select(candidate => candidate.Entry)
            .OrderByDescending(entry => entry.Count)
            .ThenBy(entry => entry.Name, StringComparer.InvariantCultureIgnoreCase)
            .ToList();
    }

    // Two or more "###" groups in the competence section become the same tab panel as on the services page
    // (data-hero-tabs is enhanced by the client; without scripts the groups stay stacked under their headings).
    private static void BuildCompetenceTabs(IDocument document, Section competence)
    {
        var firstGroup = competence.Items.FindIndex(item => item.LocalName == "h3");
        if (firstGroup < 0 || competence.Items.Count(item => item.LocalName == "h3") < 2) return;

        var groups = new List<(IElement Heading, List<IElement> Body)>();
        foreach (var item in competence.Items.Skip(firstGroup))
        {
            if (item.LocalName == "h3") groups.Add((item, []));
            else groups[^1].Body.Add(item);
        }

        var tabs = document.CreateElement("div");
        tabs.ClassName = "hero-tabs";
        tabs.SetAttribute("data-hero-tabs", string.Empty);
        foreach (var (heading, body) in groups) tabs.AppendChild(BuildCompetencePanel(document, heading, body));

        var panel = document.CreateElement("div");
        panel.ClassName = "page-hero-panel cv-competence-panel";
        panel.AppendChild(tabs);

        competence.Items.RemoveRange(firstGroup, competence.Items.Count - firstGroup);
        competence.Items.Add(panel);
    }

    private static IElement BuildCompetencePanel(IDocument document, IElement heading, List<IElement> body)
    {
        var panel = document.CreateElement("section");
        panel.ClassName = "hero-tab-panel";
        panel.SetAttribute("data-hero-tab-panel", string.Empty);
        heading.ClassName = "hero-tab-heading";
        heading.SetAttribute("data-hero-tab-label", string.Empty);
        panel.AppendChild(heading);

        var firstItem = body.FindIndex(element => element.LocalName == "h4");
        var leadCount = firstItem < 0 ? body.Count : firstItem;
        if (leadCount > 0)
        {
            var lead = document.CreateElement("div");
            lead.ClassName = "hero-tab-lead";
            foreach (var element in body.Take(leadCount)) lead.AppendChild(element);
            panel.AppendChild(lead);
        }
        if (firstItem < 0) return panel;

        var list = document.CreateElement("ul");
        list.ClassName = "page-hero-list";
        IElement? text = null;
        foreach (var element in body.Skip(firstItem))
        {
            if (element.LocalName == "h4")
            {
                var item = document.CreateElement("li");
                var title = document.CreateElement("strong");
                title.TextContent = element.TextContent.Trim();
                text = document.CreateElement("div");
                text.ClassName = "page-hero-item-text";
                item.Append(title, text);
                list.AppendChild(item);
            }
            else text!.AppendChild(element);
        }
        panel.AppendChild(list);
        return panel;
    }

    private static IElement? BuildSkillGroups(IDocument document, IReadOnlyList<SkillGroup> groups, CvHeadings names)
    {
        if (groups.Count == 0) return null;
        var container = document.CreateElement("div");
        container.ClassName = "skill-groups";
        var title = document.CreateElement("p");
        title.ClassName = "skill-groups-title";
        title.TextContent = names.Skills;
        var hint = document.CreateElement("span");
        hint.ClassName = "tech-hint";
        hint.TextContent = " · klicka för att markera";
        title.AppendChild(hint);
        container.AppendChild(title);

        foreach (var skillGroup in groups)
        {
            var group = document.CreateElement("div");
            group.ClassName = "skill-group";
            group.SetAttribute("role", "group");
            group.SetAttribute("aria-label", skillGroup.Name);
            // Hovering the group lights up all of its technologies in the constellation, like hovering an assignment.
            group.SetAttribute("data-keywords", string.Join('|', skillGroup.Skills));
            var label = document.CreateElement("p");
            label.ClassName = "skill-group-name";
            label.TextContent = skillGroup.Name;
            var chips = document.CreateElement("ul");
            chips.ClassName = "chips";
            foreach (var skill in skillGroup.Skills)
            {
                var chip = document.CreateElement("li");
                var button = document.CreateElement("button");
                button.ClassName = "skill-btn";
                button.SetAttribute("type", "button");
                button.SetAttribute("data-skill", skill);
                button.SetAttribute("aria-pressed", "false");
                button.TextContent = skill;
                chip.AppendChild(button);
                chips.AppendChild(chip);
            }
            group.Append(label, chips);
            container.AppendChild(group);
        }
        return container;
    }

    private static (string IntroHtml, List<IElement> Cards, List<CvAssignment> Assignments) BuildAssignments(
        IDocument document, Section history, CvHeadings names, Func<string, string?>? projectUrl)
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
            var url = projectUrl?.Invoke(title);
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
                assignment = new CvAssignment(heading.Id ?? string.Empty, title, role, start, end, ongoing, keywords, url);
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
            if (!string.IsNullOrEmpty(url))
            {
                var link = document.CreateElement("p");
                link.ClassName = "assignment-link";
                var anchor = document.CreateElement("a");
                anchor.SetAttribute("href", url);
                anchor.TextContent = "Läs om uppdraget →";
                link.AppendChild(anchor);
                card.AppendChild(link);
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
