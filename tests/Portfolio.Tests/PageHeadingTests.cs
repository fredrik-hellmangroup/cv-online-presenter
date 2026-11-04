using Portfolio.Content;

namespace Portfolio.Tests;

public sealed class PageHeadingTests
{
    [Fact]
    public void SplitSeparatesNameFromTagline()
    {
        var (name, tagline) = PageHeading.Split("Synthetic Person \u2013 Synthetic Role");
        Assert.Equal("Synthetic Person", name);
        Assert.Equal("Synthetic Role", tagline);
    }

    [Theory]
    [InlineData("Synthetic Person")]
    [InlineData("Synthetic Person \u2013 ")]
    public void SplitWithoutTaglineKeepsName(string heading)
    {
        var (name, tagline) = PageHeading.Split(heading);
        Assert.StartsWith("Synthetic Person", name);
        Assert.Null(tagline);
    }

    [Fact]
    public void SplitFirstH1WrapsNameAndTaglineInsideOneHeading()
    {
        var html = PageHeading.SplitFirstH1("<h1 id=\"x\">Synthetic Person \u2013 Synthetic Role</h1><p>A \u2013 B</p>");
        Assert.Equal(
            "<h1 id=\"x\"><span class=\"h1-name\">Synthetic Person</span> <span class=\"h1-tagline\">Synthetic Role</span></h1><p>A \u2013 B</p>",
            html);
    }

    [Fact]
    public void SplitFirstH1LeavesPlainHeadingsAlone()
    {
        const string html = "<h1>Contact</h1>";
        Assert.Equal(html, PageHeading.SplitFirstH1(html));
    }

    [Theory]
    [InlineData("Synthetic Person", "SP")]
    [InlineData("Example", "E")]
    [InlineData("", "")]
    public void MonogramUsesInitials(string name, string expected) =>
        Assert.Equal(expected, PageHeading.Monogram(name));
}
