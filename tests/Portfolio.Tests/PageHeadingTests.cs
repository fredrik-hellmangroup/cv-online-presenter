using Portfolio.Content;

namespace Portfolio.Tests;

public sealed class PageHeadingTests
{
    [Theory]
    [InlineData("Synthetic Person", "SP")]
    [InlineData("Example", "E")]
    [InlineData("", "")]
    public void MonogramUsesInitials(string name, string expected) =>
        Assert.Equal(expected, PageHeading.Monogram(name));
}
