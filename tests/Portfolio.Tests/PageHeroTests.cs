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
}
