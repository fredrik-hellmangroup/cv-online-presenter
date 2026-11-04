using Portfolio.Content;
using Xunit.Abstractions;

namespace Portfolio.Tests;

public sealed class ContentPathSafetyTests(ITestOutputHelper output) : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "portfolio-path-safety-" + Guid.NewGuid().ToString("N"));
    private readonly MarkdownContentService markdown = new();

    public void Dispose()
    {
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }

    [Fact]
    public async Task MarkdownDirectoryLoaderRejectsSymlinkedPagesRoot()
    {
        var actualPages = Path.Combine(root, "actual-pages");
        Directory.CreateDirectory(actualPages);
        await File.WriteAllTextAsync(Path.Combine(actualPages, "home.md"), ValidMarkdown("External"));
        var linkedPages = Path.Combine(root, "pages");
        if (!TryCreateSymlink(() => Directory.CreateSymbolicLink(linkedPages, actualPages), "pages-root directory")) return;

        try
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() => markdown.LoadDirectoryAsync(linkedPages));
        }
        finally
        {
            DeleteLink(linkedPages, isDirectory: true);
        }
    }

    [Fact]
    public async Task MarkdownDirectoryLoaderRejectsSymlinkedDirectory()
    {
        var pages = Path.Combine(root, "pages");
        var external = Path.Combine(root, "external");
        Directory.CreateDirectory(pages);
        Directory.CreateDirectory(external);
        await File.WriteAllTextAsync(Path.Combine(external, "secret.md"), ValidMarkdown("Secret"));
        var link = Path.Combine(pages, "linked");
        if (!TryCreateSymlink(() => Directory.CreateSymbolicLink(link, external), "directory")) return;

        try
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() => markdown.LoadDirectoryAsync(pages));
        }
        finally
        {
            DeleteLink(link, isDirectory: true);
        }
    }

    [Fact]
    public async Task MarkdownDirectoryLoaderRejectsSymlinkedFile()
    {
        var pages = Path.Combine(root, "pages");
        Directory.CreateDirectory(pages);
        var external = Path.Combine(root, "outside.md");
        await File.WriteAllTextAsync(external, ValidMarkdown("External"));
        var link = Path.Combine(pages, "home.md");
        if (!TryCreateSymlink(() => File.CreateSymbolicLink(link, external), "file")) return;

        try
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() => markdown.LoadDirectoryAsync(pages));
        }
        finally
        {
            DeleteLink(link, isDirectory: false);
        }
    }

    [Fact]
    public async Task SnapshotLoaderRejectsSymlinkedSiteJson()
    {
        var pages = CreatePages("Trusted");
        var sitePath = Path.Combine(root, "site.json");
        File.Delete(sitePath);
        var outside = Path.Combine(root, "outside-site.json");
        await File.WriteAllTextAsync(outside, "{\"supportedLocales\":[\"sv-SE\"],\"siteName\":\"External\"}");
        if (!TryCreateSymlink(() => File.CreateSymbolicLink(sitePath, outside), "site.json file")) return;

        try
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() => new ContentSnapshotLoader().LoadAsync(pages));
        }
        finally
        {
            DeleteLink(sitePath, isDirectory: false);
        }
    }

    [Fact]
    public async Task SnapshotLoaderRejectsSymlinkedPageFile()
    {
        var pages = CreatePages("Trusted");
        var pagePath = Path.Combine(pages, "home.md");
        File.Delete(pagePath);
        var outside = Path.Combine(root, "outside.md");
        await File.WriteAllTextAsync(outside, ValidMarkdown("External"));
        if (!TryCreateSymlink(() => File.CreateSymbolicLink(pagePath, outside), "page file")) return;

        try
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() => new ContentSnapshotLoader().LoadAsync(pages));
        }
        finally
        {
            DeleteLink(pagePath, isDirectory: false);
        }
    }

    [Fact]
    public async Task SnapshotLoaderRejectsPagesRootReachedThroughSymlinkedAncestor()
    {
        var actualApp = Path.Combine(root, "actual-app");
        var actualRelease = Path.Combine(actualApp, "release");
        var actualPages = Path.Combine(actualRelease, "pages");
        Directory.CreateDirectory(actualPages);
        await File.WriteAllTextAsync(Path.Combine(actualRelease, "site.json"), "{\"supportedLocales\":[\"sv-SE\"],\"siteName\":\"Trusted\"}");
        await File.WriteAllTextAsync(Path.Combine(actualPages, "home.md"), ValidMarkdown("Trusted"));
        var linkedApp = Path.Combine(root, "linked-app");
        if (!TryCreateSymlink(() => Directory.CreateSymbolicLink(linkedApp, actualApp), "pages-root ancestor directory")) return;

        try
        {
            var linkedPages = Path.Combine(linkedApp, "release", "pages");
            await Assert.ThrowsAsync<InvalidOperationException>(() => new ContentSnapshotLoader().LoadAsync(linkedPages));
        }
        finally
        {
            DeleteLink(linkedApp, isDirectory: true);
        }
    }

    [Fact]
    public void ReleaseRootInsideAppContentOrDeploymentTreeIsRejected()
    {
        var appRoot = Path.Combine(root, "app");
        var contentRoot = Path.Combine(appRoot, "content", "releases");
        var deploymentRoot = Path.Combine(appRoot, "deployment", "releases");

        Assert.Throws<InvalidOperationException>(() => ContentReleaseCatalog.ValidateReleasesRoot(contentRoot, appRoot));
        Assert.Throws<InvalidOperationException>(() => ContentReleaseCatalog.ValidateReleasesRoot(deploymentRoot, appRoot));
    }

    [Fact]
    public void ReleaseRootSymlinkIntoAppContentTreeIsRejected()
    {
        var appRoot = Path.Combine(root, "app");
        var contentRoot = Path.Combine(appRoot, "content");
        Directory.CreateDirectory(contentRoot);
        var linkedRoot = Path.Combine(root, "linked-releases");
        if (!TryCreateSymlink(() => Directory.CreateSymbolicLink(linkedRoot, contentRoot), "release-root directory")) return;

        try
        {
            Assert.Throws<InvalidOperationException>(() => ContentReleaseCatalog.ValidateReleasesRoot(linkedRoot, appRoot));
        }
        finally
        {
            DeleteLink(linkedRoot, isDirectory: true);
        }
    }

    [Fact]
    public void ReleaseRootWithSymlinkedAncestorIntoAppContentTreeIsRejected()
    {
        var appRoot = Path.Combine(root, "app");
        Directory.CreateDirectory(Path.Combine(appRoot, "content"));
        var linkedAncestor = Path.Combine(root, "linked-app");
        if (!TryCreateSymlink(() => Directory.CreateSymbolicLink(linkedAncestor, appRoot), "release-root ancestor")) return;
        var linkedRoot = Path.Combine(linkedAncestor, "content", "releases");

        try
        {
            Assert.Throws<InvalidOperationException>(() => ContentReleaseCatalog.ValidateReleasesRoot(linkedRoot, appRoot));
        }
        finally
        {
            DeleteLink(linkedAncestor, isDirectory: true);
        }
    }

    [Fact]
    public void ReleaseRootOutsideAppAndDocumentedAppDataLocationAreAllowed()
    {
        var appRoot = Path.Combine(root, "app");
        var outsideRoot = Path.Combine(root, "private-releases");
        var appDataRoot = Path.Combine(appRoot, "App_Data", "content-releases");

        Assert.Equal(Path.GetFullPath(outsideRoot), ContentReleaseCatalog.ValidateReleasesRoot(outsideRoot, appRoot));
        Assert.Equal(Path.GetFullPath(appDataRoot), ContentReleaseCatalog.ValidateReleasesRoot(appDataRoot, appRoot));
    }

    [Fact]
    public void ReleaseRootSiblingPrefixIsNotMistakenForPathInsideApp()
    {
        var appRoot = Path.Combine(root, "app");
        var sibling = appRoot + "-releases";

        Assert.Equal(Path.GetFullPath(sibling), ContentReleaseCatalog.ValidateReleasesRoot(sibling, appRoot));
    }

    [Fact]
    public void ReleaseRootContainmentUsesPlatformPathCaseRules()
    {
        var appRoot = Path.Combine(root, "AppBoundary");
        var alternateCase = Path.Combine(root, "appboundary", "content-releases");

        if (OperatingSystem.IsWindows())
            Assert.Throws<InvalidOperationException>(() => ContentReleaseCatalog.ValidateReleasesRoot(alternateCase, appRoot));
        else
            Assert.Equal(Path.GetFullPath(alternateCase), ContentReleaseCatalog.ValidateReleasesRoot(alternateCase, appRoot));
    }

    private string CreatePages(string siteName)
    {
        var pages = Path.Combine(root, "pages");
        Directory.CreateDirectory(pages);
        File.WriteAllText(Path.Combine(root, "site.json"), "{\"supportedLocales\":[\"sv-SE\"],\"siteName\":\"" + siteName + "\"}");
        File.WriteAllText(Path.Combine(pages, "home.md"), ValidMarkdown(siteName));
        return pages;
    }

    private static string ValidMarkdown(string title) => $"---\ntitle: {title}\ndescription: Welcome\nlocale: sv-SE\nstatus: published\ntype: page\n---\n# {title}";

    private bool TryCreateSymlink(Action create, string kind)
    {
        try
        {
            create();
            return true;
        }
        catch (Exception exception) when (exception is UnauthorizedAccessException or PlatformNotSupportedException or NotSupportedException)
        {
            output.WriteLine($"SKIP: this environment cannot create {kind} symlinks: {exception.Message}");
            return false;
        }
    }

    private static void DeleteLink(string path, bool isDirectory)
    {
        if (isDirectory)
        {
            if (Directory.Exists(path)) Directory.Delete(path);
        }
        else if (File.Exists(path)) File.Delete(path);
    }
}
