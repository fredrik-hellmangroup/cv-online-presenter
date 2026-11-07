using Portfolio.Content;

namespace Portfolio.Tests;

public sealed class CvPresenterTests
{
    private const string Cv = """
        # SYNTHETIC PERSON

        Synthetic Role Headline

        Introductory text that remains in the article body.

        ## Roles
        - Synthetic Role A
        - Synthetic Role B

        ## Overview
        Synthetic profile summary. A fictional example with over 18 years of sample experience.

        Additional synthetic text.

        ## Practical
        - Available: From 1 Feb 2027
        - Work model: Hybrid
        - Malformed line without a separator

        ## Expertise
        - Example technical capability

        ## Industries
        Sample Sector A, Sample Sector B, Sample Sector C

        ## Assignment History

        ### Sample Project Alpha
        **Period:** 2023 - ongoing
        **Role:** Synthetic Assignment Role A

        Synthetic description for sample project Alpha.

        #### Results
        Synthetic result placeholder.

        #### Keywords
        .NET, Azure, REST

        ### Sample Project Beta
        **Period:** 2018 - 2020  
        **Role:** Synthetic Assignment Role B

        Synthetic description for sample project Beta.

        #### Keywords
        C#, MQTT

        ### Sample Project Gamma
        **Period:** 2016
        **Role:** Synthetic Assignment Role C

        Synthetic description for sample project Gamma.

        ## Employment
        - Synthetic Role A, Example Organization A, 2023 - ongoing
        - Synthetic Role B, Example Organization B, 2011 - 2016

        ## Languages
        Example language
        """;

    private static readonly CvHeadings Headings = new(
        Roles: "Roles", Overview: "Overview", Industries: "Industries",
        History: "Assignment History", Employment: "Employment", Skills: "Key Technologies",
        Keywords: "Keywords", Period: "Period", Role: "Role", Ongoing: "ongoing", Practical: "Practical",
        Competence: "Expertise", OtherSkills: "Other");

    private static readonly TechGroup[] Mapping =
    [
        new("Integration", ["MQTT", "Unused"]),
        new("Core", [".NET", "C#", "Azure"])
    ];

    private static CvView Build(string? document = null, IReadOnlyList<TechGroup>? techGroups = null)
    {
        var sample = (document ?? Cv).Replace("over 18 years", "\u00f6" + "ver 18 " + "\u00e5" + "rs", StringComparison.Ordinal);
        var html = new MarkdownContentService().Render(sample);
        return CvPresenter.Build(html, Headings, techGroups: techGroups) ?? throw new InvalidOperationException("The synthetic sample CV was not recognised.");
    }

    [Fact]
    public void ExtractsHeroFactsAndFigures()
    {
        var view = Build();
        Assert.Equal("SYNTHETIC PERSON", view.Name);
        Assert.Equal("Synthetic Role Headline", view.Tagline);
        Assert.DoesNotContain("Synthetic Role Headline", view.BeforeHistoryHtml);
        Assert.Contains("Introductory text that remains in the article body.", view.BeforeHistoryHtml);
        Assert.Equal("Example Organization A \u00b7 Synthetic Role A \u00b7 sedan 2023", view.Kicker);
        Assert.Equal(["Synthetic Role A", "Synthetic Role B"], view.Roles);
        Assert.Equal("Synthetic profile summary.", view.Summary);
        Assert.Equal(
            [(18, "+", "\u00e5rs erfarenhet"), (3, "", "uppdrag"), (3, "", "branscher"), (5, "", "nyckelteknologier")],
            view.Figures.Select(figure => (figure.Count, figure.Suffix, figure.Label)));
    }


    [Fact]
    public void PracticalFactsBecomeCardsAfterTheOverviewInsteadOfASection()
    {
        var view = Build();
        var overview = view.BeforeHistoryHtml.IndexOf("id=\"overview\"", StringComparison.Ordinal);
        var practical = view.BeforeHistoryHtml.IndexOf("class=\"practical\"", StringComparison.Ordinal);

        Assert.True(overview >= 0 && practical > overview, "The practical cards should follow the overview text.");
        Assert.Contains("<div><dt>Available</dt><dd>From 1 Feb 2027</dd></div>", view.BeforeHistoryHtml);
        Assert.Contains("<div><dt>Work model</dt><dd>Hybrid</dd></div>", view.BeforeHistoryHtml);
        Assert.DoesNotContain("Malformed line", view.BeforeHistoryHtml);
        Assert.DoesNotContain("id=\"practical\"", view.BeforeHistoryHtml);
    }

    [Fact]
    public void WithoutAPracticalSectionNoCardsAreRendered()
    {
        var document = System.Text.RegularExpressions.Regex.Replace(
            Cv, @"## Practical.*?(?=## Expertise)", string.Empty, System.Text.RegularExpressions.RegexOptions.Singleline);

        Assert.DoesNotContain("class=\"practical\"", Build(document).BeforeHistoryHtml);
    }

    [Fact]
    public void TaglineIsNullWhenNoParagraphFollowsTheName()
    {
        var document = Cv.Replace("Synthetic Role Headline", string.Empty, StringComparison.Ordinal)
            .Replace("Introductory text that remains in the article body.", string.Empty, StringComparison.Ordinal);

        Assert.Null(Build(document).Tagline);
    }

    [Fact]
    public void ParsesAssignmentsWithPeriodRoleAndKeywords()
    {
        var assignments = Build().Assignments;
        Assert.Equal(["Sample Project Alpha", "Sample Project Beta", "Sample Project Gamma"], assignments.Select(item => item.Title));
        Assert.Equal(("sample-project-alpha", 2023, null, true), (assignments[0].Id, assignments[0].StartYear, assignments[0].EndYear, assignments[0].Ongoing));
        Assert.Equal("Synthetic Assignment Role A", assignments[0].Role);
        Assert.Equal([".NET", "Azure", "REST"], assignments[0].Keywords);
        Assert.Equal((2018, 2020, false), (assignments[1].StartYear, assignments[1].EndYear, assignments[1].Ongoing));
        Assert.Equal((2016, 2016), (assignments[2].StartYear, assignments[2].EndYear));
        Assert.Empty(assignments[2].Keywords);
    }

    [Fact]
    public void DerivesSkillGroupsFromAssignmentKeywordsUsingTheConfiguredGroups()
    {
        var view = Build(techGroups: Mapping);

        Assert.Equal(["Integration", "Core", "Other"], view.SkillGroups.Select(group => group.Name));
        Assert.Equal(["MQTT"], view.SkillGroups[0].Skills);
        Assert.Equal([".NET", "Azure", "C#"], view.SkillGroups[1].Skills);
        Assert.Equal(["REST"], view.SkillGroups[2].Skills);
        Assert.Contains("data-keywords=\"MQTT\"", view.BeforeHistoryHtml);
        Assert.Contains("data-skill=\".NET\"", view.BeforeHistoryHtml);
        Assert.DoesNotContain("Unused", view.BeforeHistoryHtml);
        Assert.DoesNotContain("<strong>Key Technologies</strong>", view.BeforeHistoryHtml);
    }

    [Fact]
    public void ListsTheSkillGroupsAtTheEndOfTheCompetenceSection()
    {
        var html = Build(techGroups: Mapping).BeforeHistoryHtml;
        var expertise = html.IndexOf("id=\"expertise\"", StringComparison.Ordinal);
        var skills = html.IndexOf("class=\"skill-groups\"", StringComparison.Ordinal);
        var industries = html.IndexOf("id=\"industries\"", StringComparison.Ordinal);

        Assert.True(expertise >= 0 && expertise < skills && skills < industries, "The technology groups should end the competence section.");
        Assert.DoesNotContain("class=\"skill-groups\"", Build(techGroups: Mapping).AfterHistoryHtml);
    }

    [Fact]
    public void ListsAllKeywordsInOneGroupWhenNoGroupsAreConfigured()
    {
        var view = Build();

        var group = Assert.Single(view.SkillGroups);
        Assert.Equal("Key Technologies", group.Name);
        Assert.Equal([".NET", "Azure", "C#", "MQTT", "REST"], group.Skills);
    }

    [Fact]
    public void CountsOnlyGroupedKeywordsAsTechnologiesWhenGroupsAreConfigured()
    {
        var figure = Build(techGroups: Mapping).Figures.Single(item => item.Label == "nyckelteknologier");

        Assert.Equal(4, figure.Count);
    }

    [Fact]
    public void ListsMoreUsedKeywordsFirstAndMergesCaseVariants()
    {
        var document = Cv.Replace(".NET, Azure, REST", ".NET, Azure, REST, c#", StringComparison.Ordinal)
            .Replace("C#, MQTT", "C#, MQTT, Azure", StringComparison.Ordinal);
        var view = Build(document, [new("Core", [".NET", "C#", "Azure"])]);

        Assert.Equal(["Azure", "c#", ".NET"], view.SkillGroups[0].Skills);
    }

    [Fact]
    public void FallsBackToTheStartOfTheLaterSectionsWhenThereIsNoCompetenceSection()
    {
        var document = System.Text.RegularExpressions.Regex.Replace(
            Cv, @"## Expertise.*?(?=## Industries)", string.Empty, System.Text.RegularExpressions.RegexOptions.Singleline);
        var view = Build(document, Mapping);

        Assert.StartsWith("<div class=\"skill-groups\">", view.AfterHistoryHtml);
    }

    [Fact]
    public void WrapsAssignmentsInCardsWithTags()
    {
        var html = Build().AssignmentsHtml;
        Assert.Equal(3, html.Split("<section class=\"assignment\"", StringSplitOptions.None).Length - 1);
        Assert.Contains("data-keywords=\".NET|Azure|REST\"", html);
        Assert.Contains("<span class=\"assignment-period\">2023 \u2013 ongoing</span>", html);
        Assert.Contains("<span class=\"assignment-role\">Synthetic Assignment Role A</span>", html);
        Assert.Contains("<ul class=\"tags\"><li>.NET</li>", html);
        Assert.DoesNotContain("<strong>Period:</strong>", html);
    }

    [Fact]
    public void KeepsHeadingAnchorsAndMovesHeroContentOutOfTheBody()
    {
        var view = Build();
        Assert.Contains("id=\"assignment-history\"", view.HistoryHeadingHtml);
        Assert.DoesNotContain("<h1", view.BeforeHistoryHtml);
        Assert.DoesNotContain("Roles", view.BeforeHistoryHtml);
        Assert.Contains("id=\"overview\"", view.BeforeHistoryHtml);
        Assert.Contains("id=\"employment\"", view.AfterHistoryHtml);
    }

    [Fact]
    public void AssignmentsLinkToTheirProjectPageWhenOneIsFound()
    {
        var html = new MarkdownContentService().Render(Cv.Replace("over 18 years", "\u00f6" + "ver 18 " + "\u00e5" + "rs", StringComparison.Ordinal));
        var view = CvPresenter.Build(html, Headings, title => title == "Sample Project Beta" ? "/projects/beta" : null)!;

        Assert.Equal([null, "/projects/beta", null], view.Assignments.Select(item => item.Url));
        Assert.Single(System.Text.RegularExpressions.Regex.Matches(view.AssignmentsHtml, "class=\"assignment-link\""));
        Assert.Contains("<a href=\"/projects/beta\">", view.AssignmentsHtml);
    }

    [Fact]
    public void ReturnsNullWhenTheDocumentHasNoAssignmentHistory()
    {
        var html = new MarkdownContentService().Render("# Title\n\n## Other\nText");
        Assert.Null(CvPresenter.Build(html));
    }

    [Fact]
    public void GitGraphMergesFinishedWorkAndKeepsOngoingWorkOnItsOwnLane()
    {
        var assignments = Build().Assignments;
        var graph = GitGraphLayout.Build(assignments);

        Assert.Equal(GitRowKind.Head, graph.Rows[0].Kind);
        Assert.Equal([1], graph.Rows[0].ThroughLanes);
        Assert.Equal(6, graph.Rows.Count);
        Assert.Equal(1, graph.Rows.First(row => row.Kind == GitRowKind.Branch && row.AssignmentIndex == 0).Lane);
        Assert.Equal(
            [(2020, GitRowKind.Merge, 1), (2018, GitRowKind.Branch, 1)],
            graph.Rows.Where(row => row.AssignmentIndex == 1).Select(row => (row.Year, row.Kind, row.AssignmentIndex)));
        Assert.All(graph.Rows.Where(row => row.Kind != GitRowKind.Head), row => Assert.True(row.Lane >= 1));
        Assert.Equal(2, graph.LaneCount);
    }

    [Fact]
    public void GitGraphUsesSeparateLanesForOverlappingAssignments()
    {
        CvAssignment Make(string title, int start, int end) => new(title.ToLowerInvariant(), title, "Synthetic Role", start, end, false, []);
        var graph = GitGraphLayout.Build([Make("Outer Sample", 2019, 2022), Make("Inner Sample", 2020, 2021)]);

        var outerMerge = graph.Rows.Single(row => row.Kind == GitRowKind.Merge && row.AssignmentIndex == 0);
        var innerMerge = graph.Rows.Single(row => row.Kind == GitRowKind.Merge && row.AssignmentIndex == 1);
        Assert.NotEqual(outerMerge.Lane, innerMerge.Lane);
        Assert.Contains(outerMerge.Lane, innerMerge.ThroughLanes);
        Assert.Equal(3, graph.LaneCount);
    }
}
