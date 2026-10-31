using Portfolio.Content;

namespace Portfolio.Tests;

public sealed class PageHeadingTests
{
    [Fact]
    public void SplitSeparatesNameFromTagline()
    {
        var (name, tagline) = PageHeading.Split("Fredrik Hallerös – Lösningsarkitekt och senior .NET-konsult");
        Assert.Equal("Fredrik Hallerös", name);
        Assert.Equal("Lösningsarkitekt och senior .NET-konsult", tagline);
    }

    [Theory]
    [InlineData("Fredrik Hallerös")]
    [InlineData("Fredrik – ")]
    public void SplitWithoutTaglineKeepsName(string heading)
    {
        var (name, tagline) = PageHeading.Split(heading);
        Assert.StartsWith("Fredrik", name);
        Assert.Null(tagline);
    }

    [Fact]
    public void SplitFirstH1WrapsNameAndTaglineInsideOneHeading()
    {
        var html = PageHeading.SplitFirstH1("<h1 id=\"x\">Fredrik Hallerös – Arkitekt</h1><p>A – B</p>");
        Assert.Equal(
            "<h1 id=\"x\"><span class=\"h1-name\">Fredrik Hallerös</span><span class=\"h1-tagline\">Arkitekt</span></h1><p>A – B</p>",
            html);
    }

    [Fact]
    public void SplitFirstH1LeavesPlainHeadingsAlone()
    {
        const string html = "<h1>Kontakt</h1>";
        Assert.Equal(html, PageHeading.SplitFirstH1(html));
    }

    [Fact]
    public void RemoveFirstH1DropsOnlyTheFirstHeading()
    {
        Assert.Equal("<p>Text</p><h1>Kvar</h1>", PageHeading.RemoveFirstH1("<h1 id=\"profil\">Profil</h1>\n<p>Text</p><h1>Kvar</h1>"));
    }

    [Theory]
    [InlineData("Fredrik Hallerös", "FH")]
    [InlineData("Cher", "C")]
    [InlineData("", "")]
    public void MonogramUsesInitials(string name, string expected) =>
        Assert.Equal(expected, PageHeading.Monogram(name));
}
