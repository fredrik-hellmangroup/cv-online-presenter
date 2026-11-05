using Portfolio.Content;

namespace Portfolio.Tests;

public sealed class PageHeroTests
{
    private static string Render(string markdown) => new MarkdownContentService().Render(markdown);

    [Fact]
    public void SplitsHeadingLeadAndPanelItems()
    {
        var view = PageHero.Build(Render("""
            # Synthetic Heading

            Synthetic lead paragraph.

            ## First Item
            First body.

            ## Second Item
            Second body.
            """));

        Assert.NotNull(view);
        Assert.Contains("Synthetic Heading", view.HeadingHtml);
        Assert.Contains("Synthetic lead paragraph.", view.LeadHtml);
        Assert.DoesNotContain("First Item", view.LeadHtml);
        Assert.Equal(["First Item", "Second Item"], view.Items.Select(item => item.Heading));
        Assert.Contains("First body.", view.Items[0].BodyHtml);
        Assert.DoesNotContain("Second body.", view.Items[0].BodyHtml);
    }

    [Theory]
    [InlineData("# Only A Heading\n\nNo sections here.")]
    [InlineData("Lead without a heading.\n\n## Item\nBody.")]
    public void ReturnsNullWhenThePageHasNoHeadingOrNoSections(string markdown) =>
        Assert.Null(PageHero.Build(Render(markdown)));

    [Fact]
    public void NestsH3ItemsUnderH2GroupsAndKeepsTheGroupLead()
    {
        var view = PageHero.Build(Render("""
            # Synthetic Heading

            Lead.

            ## Build
            Build lead.

            ### First Item
            First body.

            ### Second Item
            Second body.

            ## Deliver
            Deliver lead.

            ### Third Item
            Third body.
            """));

        Assert.NotNull(view);
        Assert.Empty(view.Items);
        Assert.Equal(["Build", "Deliver"], view.Groups.Select(group => group.Heading));
        Assert.Contains("Build lead.", view.Groups[0].LeadHtml);
        Assert.DoesNotContain("First Item", view.Groups[0].LeadHtml);
        Assert.Equal(["First Item", "Second Item"], view.Groups[0].Items.Select(item => item.Heading));
        Assert.Contains("First body.", view.Groups[0].Items[0].BodyHtml);
        Assert.DoesNotContain("Second body.", view.Groups[0].Items[0].BodyHtml);
        Assert.Equal(["Third Item"], view.Groups[1].Items.Select(item => item.Heading));
    }

    [Fact]
    public void AGroupWithoutItemsKeepsItsTextAsLeadWhenOtherGroupsHaveItems()
    {
        var view = PageHero.Build(Render("""
            # Synthetic Heading

            ## Plain
            Only a lead.

            ## Nested
            ### Item
            Body.
            """));

        Assert.NotNull(view);
        Assert.Equal(2, view.Groups.Count);
        Assert.Contains("Only a lead.", view.Groups[0].LeadHtml);
        Assert.Empty(view.Groups[0].Items);
        Assert.Single(view.Groups[1].Items);
    }

    [Fact]
    public void AFlatPageStillProducesItemsAndNoGroups()
    {
        var view = PageHero.Build(Render("# Heading\n\n## One\nBody one.\n\n## Two\nBody two."));

        Assert.NotNull(view);
        Assert.Empty(view.Groups);
        Assert.Equal(2, view.Items.Count);
    }
}
