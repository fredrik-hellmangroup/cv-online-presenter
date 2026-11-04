using Portfolio.Content;

namespace Portfolio.Tests;

public sealed class MarkdownContentTests
{
    private readonly MarkdownContentService service = new();

    [Fact]
    public void ParseRejectsMissingFrontMatter()
    {
        Assert.Throws<ContentValidationException>(() => service.Parse("home", "home.md", "# Home"));
    }

    [Fact]
    public void ValidationRejectsUnpublishedLinkTargets()
    {
        var source = "---\ntitle: Home\ndescription: Welcome\nlocale: sv-SE\nstatus: published\ntype: page\n---\n# Home\n[Missing](/missing)";
        var document = service.Parse("home", "home.md", source);
        var errors = service.Validate([document], new HashSet<string> { "sv-SE" });
        Assert.Contains(errors, error => error.Message.Contains("does not resolve to published content"));
    }

    [Theory]
    [InlineData("projects/sample-project", false)]
    [InlineData("projects/group/sample-project", true)]
    [InlineData("projects", true)]
    [InlineData("archive/sample-project", true)]
    public void ValidateEnforcesOneLevelProjectDetailRoute(string slug, bool shouldReject)
    {
        const string source = "---\ntitle: Sample project\ndescription: Synthetic project description\nlocale: sv-SE\nstatus: published\ntype: project\nsummary: Synthetic summary\ntechnologies: [Example]\nlinks: None\n---\n# Sample project\n\nSynthetic project body.";
        var document = service.Parse(slug, $"{slug}.md", source);

        var errors = service.Validate([document], new HashSet<string> { "sv-SE" });

        var routeError = errors.FirstOrDefault(error => error.Message.Contains("one-level '/projects/{slug}' route", StringComparison.Ordinal));
        if (shouldReject) Assert.NotNull(routeError);
        else Assert.Null(routeError);
    }

    [Fact]
    public void RenderRemovesActiveHtml()
    {
        var html = service.Render("# Safe\n<script>alert(1)</script>\n[unsafe](javascript:alert)");
        Assert.DoesNotContain("<script", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("javascript:", html, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Safe", html);
    }
}
