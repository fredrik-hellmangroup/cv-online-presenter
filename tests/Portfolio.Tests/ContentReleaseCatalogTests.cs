using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Portfolio.Content;

namespace Portfolio.Tests;

public sealed class ContentReleaseCatalogTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "portfolio-releases-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(root)) Directory.Delete(root, true);
    }

    [Theory]
    [InlineData("2026-11-01_abc123", true)]
    [InlineData("", false)]
    [InlineData("..", false)]
    [InlineData("a/b", false)]
    [InlineData("a\\b", false)]
    [InlineData("release.1", false)]
    public void ReleaseIdsAreRestrictedToSafeCharacters(string releaseId, bool expected)
    {
        Assert.Equal(expected, ContentReleaseCatalog.IsValidReleaseId(releaseId));
    }

    [Fact]
    public void ActiveReleasePointerRoundTripsAndOverwrites()
    {
        var catalog = new ContentReleaseCatalog(root);
        Assert.Null(catalog.ReadActiveReleaseId());

        catalog.WriteActiveReleaseId("release-1");
        catalog.WriteActiveReleaseId("release-2");

        Assert.Equal("release-2", catalog.ReadActiveReleaseId());
        Assert.Equal([ContentReleaseCatalog.ActiveReleaseFileName], Directory.GetFiles(root).Select(Path.GetFileName));
    }

    [Fact]
    public void CorruptPointerIsRejected()
    {
        Directory.CreateDirectory(root);
        File.WriteAllText(Path.Combine(root, ContentReleaseCatalog.ActiveReleaseFileName), "../escape");

        Assert.Throws<InvalidOperationException>(() => new ContentReleaseCatalog(root).ReadActiveReleaseId());
    }

    [Fact]
    public async Task AppServesTheActiveReleaseAfterRestartAndFallsBackWhenItIsBroken()
    {
        WriteRelease("good", "Release Person");
        new ContentReleaseCatalog(root).WriteActiveReleaseId("good");

        await using (var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseSetting("Content:ReleasesRoot", root)))
        {
            var html = await factory.CreateClient().GetStringAsync("/");
            Assert.Contains("Release Person", html);
        }

        File.WriteAllText(Path.Combine(root, "good", "pages", "home.md"), "invalid");
        await using (var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseSetting("Content:ReleasesRoot", root)))
        {
            var response = await factory.CreateClient().GetAsync("/");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Contains("Alex Exempel", await response.Content.ReadAsStringAsync());
        }
    }

    private void WriteRelease(string releaseId, string siteName)
    {
        var pages = Path.Combine(root, releaseId, "pages");
        Directory.CreateDirectory(pages);
        File.WriteAllText(Path.Combine(root, releaseId, "site.json"), $"{{\"supportedLocales\":[\"sv-SE\"],\"siteName\":\"{siteName}\"}}");
        foreach (var slug in new[] { "home", "cv", "services", "projects", "contact" })
            File.WriteAllText(Path.Combine(pages, slug + ".md"), $"---\ntitle: {siteName} {slug}\ndescription: Test {slug}\nlocale: sv-SE\nstatus: published\ntype: page\n---\n# {siteName}\n\nText for {slug}.");
    }
}
