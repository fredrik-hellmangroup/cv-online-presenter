using Portfolio.Content;

namespace Portfolio.Tests;

public sealed class CvPresenterTests
{
    private const string Cv = """
        # SYNTHETIC PERSON

        ## Roles
        - Synthetic Role A
        - Synthetic Role B

        ## Overview
        Synthetic profile summary. A fictional example with over 18 years of sample experience.

        Additional synthetic text.

        ## Expertise
        - Example technical capability

        **Key Technologies**
        - Core: .NET, C#, Azure
        - Integration: REST, MQTT

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

    private static CvView Build()
    {
        var sample = Cv.Replace("over 18 years", "\u00f6" + "ver 18 " + "\u00e5" + "rs", StringComparison.Ordinal);
        var html = new MarkdownContentService().Render(sample);
        var headings = new CvHeadings(
            Roles: "Roles", Overview: "Overview", Industries: "Industries",
            History: "Assignment History", Employment: "Employment", Skills: "Key Technologies",
            Keywords: "Keywords", Period: "Period", Role: "Role", Ongoing: "ongoing");
        return CvPresenter.Build(html, headings) ?? throw new InvalidOperationException("The synthetic sample CV was not recognised.");
    }

    [Fact]
    public void ExtractsHeroFactsAndFigures()
    {
        var view = Build();
        Assert.Equal("SYNTHETIC PERSON", view.Name);
        Assert.Equal("Example Organization A · Synthetic Role A · sedan 2023", view.Kicker);
        Assert.Equal(["Synthetic Role A", "Synthetic Role B"], view.Roles);
        Assert.Equal("Synthetic profile summary.", view.Summary);
        Assert.Equal(
            [(18, "+", "års erfarenhet"), (3, "", "uppdrag"), (3, "", "branscher"), (5, "", "nyckelteknologier")],
            view.Figures.Select(figure => (figure.Count, figure.Suffix, figure.Label)));
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
    public void GroupsSkillsAndRendersChips()
    {
        var view = Build();
        Assert.Equal(["Core", "Integration"], view.SkillGroups.Select(group => group.Name));
        Assert.Equal([".NET", "C#", "Azure"], view.SkillGroups[0].Skills);
        Assert.Contains("data-skill=\".NET\"", view.BeforeHistoryHtml);
        Assert.DoesNotContain("<strong>Key Technologies</strong>", view.BeforeHistoryHtml);
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
