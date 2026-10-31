using Portfolio.Content;

namespace Portfolio.Tests;

public sealed class CvPresenterTests
{
    private const string Cv = """
        # FREDRIK TEST

        ## Roller
        - Lösningsarkitekt
        - Backendutvecklare

        ## Översikt
        Senior konsult med över 18 års erfarenhet av .NET och Azure. Arbetar i komplexa miljöer.

        Mer text.

        ## Kompetensområden
        - Backend i .NET

        **Nyckelteknik**
        - Kärnplattform: .NET, C#, Azure
        - Integration: REST, MQTT

        ## Branscherfarenhet
        Finans, försäkring, telekom

        ## Uppdragshistorik

        ### Alfa AB
        **Period:** 2023 - pågående
        **Roll:** Arkitekt

        Beskrivning av Alfa.

        #### Resultat
        Bra resultat.

        #### Nyckelord
        .NET, Azure, REST

        ### Beta AB
        **Period:** 2018 - 2020  
        **Roll:** Utvecklare

        Beskrivning av Beta.

        #### Nyckelord
        C#, MQTT

        ### Gamma AB
        **Period:** 2016
        **Roll:** Konsult

        Beskrivning av Gamma.

        ## Anställningar
        - IT-konsult, Test Group AB, 2023 - pågående
        - IT-konsult, Gammal AB, 2011 - 2016

        ## Språk
        Svenska
        """;

    private static CvView Build()
    {
        var html = new MarkdownContentService().Render(Cv);
        return CvPresenter.Build(html) ?? throw new InvalidOperationException("The sample CV was not recognised.");
    }

    [Fact]
    public void ExtractsHeroFactsAndFigures()
    {
        var view = Build();
        Assert.Equal("FREDRIK TEST", view.Name);
        Assert.Equal("Test Group AB · IT-konsult · sedan 2023", view.Kicker);
        Assert.Equal(["Lösningsarkitekt", "Backendutvecklare"], view.Roles);
        Assert.Equal("Senior konsult med över 18 års erfarenhet av .NET och Azure.", view.Summary);
        Assert.Equal(
            [(18, "+", "års erfarenhet"), (3, "", "uppdrag"), (3, "", "branscher"), (5, "", "nyckelteknologier")],
            view.Figures.Select(figure => (figure.Count, figure.Suffix, figure.Label)));
    }

    [Fact]
    public void ParsesAssignmentsWithPeriodRoleAndKeywords()
    {
        var assignments = Build().Assignments;
        Assert.Equal(["Alfa AB", "Beta AB", "Gamma AB"], assignments.Select(item => item.Title));
        Assert.Equal(("alfa-ab", 2023, null, true), (assignments[0].Id, assignments[0].StartYear, assignments[0].EndYear, assignments[0].Ongoing));
        Assert.Equal("Arkitekt", assignments[0].Role);
        Assert.Equal([".NET", "Azure", "REST"], assignments[0].Keywords);
        Assert.Equal((2018, 2020, false), (assignments[1].StartYear, assignments[1].EndYear, assignments[1].Ongoing));
        Assert.Equal((2016, 2016), (assignments[2].StartYear, assignments[2].EndYear));
        Assert.Empty(assignments[2].Keywords);
    }

    [Fact]
    public void GroupsSkillsAndRendersChips()
    {
        var view = Build();
        Assert.Equal(["Kärnplattform", "Integration"], view.SkillGroups.Select(group => group.Name));
        Assert.Equal([".NET", "C#", "Azure"], view.SkillGroups[0].Skills);
        Assert.Contains("data-skill=\".NET\"", view.BeforeHistoryHtml);
        Assert.DoesNotContain("<strong>Nyckelteknik</strong>", view.BeforeHistoryHtml);
    }

    [Fact]
    public void WrapsAssignmentsInCardsWithTags()
    {
        var html = Build().AssignmentsHtml;
        Assert.Equal(3, html.Split("<section class=\"assignment\"", StringSplitOptions.None).Length - 1);
        Assert.Contains("data-keywords=\".NET|Azure|REST\"", html);
        Assert.Contains("<span class=\"assignment-period\">2023 – pågående</span>", html);
        Assert.Contains("<span class=\"assignment-role\">Arkitekt</span>", html);
        Assert.Contains("<ul class=\"tags\"><li>.NET</li>", html);
        Assert.DoesNotContain("<strong>Period:</strong>", html);
    }

    [Fact]
    public void KeepsHeadingAnchorsAndMovesHeroContentOutOfTheBody()
    {
        var view = Build();
        Assert.Contains("id=\"uppdragshistorik\"", view.HistoryHeadingHtml);
        Assert.DoesNotContain("<h1", view.BeforeHistoryHtml);
        Assert.DoesNotContain("Roller", view.BeforeHistoryHtml);
        Assert.Contains("id=\"oversikt\"", view.BeforeHistoryHtml);
        Assert.Contains("id=\"anstallningar\"", view.AfterHistoryHtml);
    }

    [Fact]
    public void ReturnsNullWhenTheDocumentHasNoAssignmentHistory()
    {
        var html = new MarkdownContentService().Render("# Titel\n\n## Annat\nText");
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
        CvAssignment Make(string title, int start, int end) => new(title.ToLowerInvariant(), title, "Roll", start, end, false, []);
        var graph = GitGraphLayout.Build([Make("Yttre", 2019, 2022), Make("Inre", 2020, 2021)]);

        var outerMerge = graph.Rows.Single(row => row.Kind == GitRowKind.Merge && row.AssignmentIndex == 0);
        var innerMerge = graph.Rows.Single(row => row.Kind == GitRowKind.Merge && row.AssignmentIndex == 1);
        Assert.NotEqual(outerMerge.Lane, innerMerge.Lane);
        Assert.Contains(outerMerge.Lane, innerMerge.ThroughLanes);
        Assert.Equal(3, graph.LaneCount);
    }
}
