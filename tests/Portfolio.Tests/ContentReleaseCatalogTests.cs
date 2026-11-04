using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit.Abstractions;
using Portfolio.Content;

namespace Portfolio.Tests;

[Collection(WebHostCollection.Name)]
public sealed class ContentReleaseCatalogTests : IDisposable
{
    private readonly ITestOutputHelper output;

    public ContentReleaseCatalogTests(ITestOutputHelper output) => this.output = output;

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
        WriteRelease("good", "SYNTHETIC RELEASE PERSON");
        new ContentReleaseCatalog(root).WriteActiveReleaseId("good");

        await using (var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseSetting("Content:ReleasesRoot", root)))
        {
            var html = await factory.CreateClient().GetStringAsync("/");
            Assert.Contains("SYNTHETIC RELEASE PERSON", html);
        }

        File.WriteAllText(Path.Combine(root, "good", "pages", "home.md"), "invalid");
        await using (var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseSetting("Content:ReleasesRoot", root)))
        {
            var response = await factory.CreateClient().GetAsync("/");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var fallbackHtml = await response.Content.ReadAsStringAsync();
            Assert.Contains("<main", fallbackHtml);
            Assert.DoesNotContain("SYNTHETIC RELEASE PERSON", fallbackHtml);
        }
    }

    [Fact]
    public async Task FailedPersistLeavesTheServedSnapshotUnchanged()
    {
        WriteRelease("first", "SYNTHETIC FIRST");
        WriteRelease("second", "SYNTHETIC SECOND");
        var loader = new ContentSnapshotLoader();
        var store = new ContentSnapshotStore(await loader.LoadAsync(Path.Combine(root, "first", "pages")), loader, "first");
        var before = store.Current.Version;

        await Assert.ThrowsAsync<IOException>(() => store.ActivateAsync(Path.Combine(root, "second", "pages"), "second", persist: () => throw new IOException("disk full")));

        Assert.Equal(before, store.Current.Version);
    }

    [Fact]
    public async Task ReleaseWithoutRequiredPublishedPagesIsRejected()
    {
        WriteRelease("partial", "Partial Person");
        File.Delete(Path.Combine(root, "partial", "pages", "cv.md"));
        var loader = new ContentSnapshotLoader(["home", "cv"]);

        var exception = await Assert.ThrowsAsync<ContentValidationException>(() => loader.LoadAsync(Path.Combine(root, "partial", "pages")));

        Assert.Contains(exception.Errors, error => error.Message.Contains("'cv'"));
    }

    [Fact]
    public void MissingPointerMeansNoActiveRelease() =>
        Assert.Null(new ContentReleaseCatalog(root).ReadActiveReleaseId());

    [Fact]
    public void ActivationTokenFileIsTrimmedAndMustBeLongEnough()
    {
        var catalog = new ContentReleaseCatalog(root);
        Assert.Null(catalog.ReadActivationToken());

        Directory.CreateDirectory(root);
        var tokenFile = Path.Combine(root, ContentReleaseCatalog.ActivationTokenFileName);
        File.WriteAllText(tokenFile, "short\n");
        Assert.Null(catalog.ReadActivationToken());

        var token = new string('a', ContentReleaseCatalog.MinimumActivationTokenLength);
        File.WriteAllText(tokenFile, token + "\r\n");
        Assert.Equal(token, catalog.ReadActivationToken());
    }

    [Fact]
    public async Task ActivationEndpointUsesTheTokenFileAndAFolderRelativeToTheApp()
    {
        WriteRelease("good", "SYNTHETIC RELEASE PERSON");
        var token = new string('t', ContentReleaseCatalog.MinimumActivationTokenLength);
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseSetting("Content:ReleasesRoot", root));
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });

        using (var request = new HttpRequestMessage(HttpMethod.Post, "/internal/content/activate/good"))
        {
            request.Headers.Add("X-Content-Activation-Token", token);
            Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(request)).StatusCode);
        }

        File.WriteAllText(Path.Combine(root, ContentReleaseCatalog.ActivationTokenFileName), token);
        using (var request = new HttpRequestMessage(HttpMethod.Post, "/internal/content/activate/good"))
        {
            request.Headers.Add("X-Content-Activation-Token", token);
            Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(request)).StatusCode);
        }

        using (var request = new HttpRequestMessage(HttpMethod.Post, "/internal/content/activate/good"))
        {
            request.Headers.Add("X-Content-Activation-Token", "wrong");
            Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(request)).StatusCode);
        }
        using (var request = new HttpRequestMessage(HttpMethod.Delete, "/internal/content/activate/good"))
        {
            request.Headers.Add("X-Content-Activation-Token", token);
            Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(request)).StatusCode);
        }
        Assert.Equal("good", new ContentReleaseCatalog(root).ReadActiveReleaseId());
    }

    [Theory]
    [InlineData("20261101-210215-1a6df58", true)]
    [InlineData("20261101-235959-abcdef0", true)]
    [InlineData("20261101T235959Z-abcdef0", false)]
    [InlineData("20261101-235959-ABCDEF0", false)]
    [InlineData("20261301-235959-abcdef0", false)]
    [InlineData("20260230-235959-abcdef0", false)]
    [InlineData("20261101-250000-abcdef0", false)]
    [InlineData("20261101_abcdef0", false)]
    [InlineData("20261101-235959-abcdef", false)]
    [InlineData("20261101-235959-abcdef0\n", false)]
    [InlineData("٢٠261101-235959-abcdef0", false)]
    public void WorkflowReleaseIdRequiresRealUtcTimestampAndSevenLowercaseHexCharacters(string id, bool expected)
    {
        Assert.Equal(expected, ContentReleaseCatalog.TryParseWorkflowReleaseId(id, out _));
    }

    [Fact]
    public void WorkflowReleaseIdTimestampIsParsedAsUtc()
    {
        Assert.True(ContentReleaseCatalog.TryParseWorkflowReleaseId("20261101-210215-1a6df58", out var timestamp));

        Assert.Equal(new DateTimeOffset(2026, 11, 1, 21, 2, 15, TimeSpan.Zero), timestamp);
        Assert.Equal(TimeSpan.Zero, timestamp.Offset);
    }

    [Fact]
    public async Task PruningPreservesReleaseIdsOutsideTheExactWorkflowFormat()
    {
        var catalog = new ContentReleaseCatalog(root);
        var timestamp = new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero);
        var active = WorkflowId(timestamp.AddDays(1), "abcdef0");
        var trailingNewline = WorkflowId(timestamp, "abcdef1") + "\n";
        var unicodeDigit = "٢٠261101-000000-abcdef2";
        var noncanonicalTimestamp = "20261101T000000Z-abcdef3";
        var invalidDate = "20260230-000000-abcdef4";
        var invalidTime = "20261101-250000-abcdef5";
        WriteRelease(active, "Active");
        foreach (var invalidId in new[] { unicodeDigit, noncanonicalTimestamp, invalidDate, invalidTime })
            Directory.CreateDirectory(Path.Combine(root, invalidId));
        var trailingNewlineCreated = true;
        try
        {
            WriteRelease(trailingNewline, "Trailing newline");
        }
        catch (Exception exception) when (exception is IOException or ArgumentException or NotSupportedException)
        {
            // Win32 rejects control characters in names; on Unix-like filesystems this exercises prune preservation.
            trailingNewlineCreated = false;
            output.WriteLine($"SKIP trailing-newline filesystem case: {exception.Message}");
        }
        catalog.WriteActiveReleaseId(active);

        var result = await catalog.PruneInactiveReleasesAsync(active, new ContentSnapshotLoader());

        Assert.False(result.Aborted);
        Assert.Empty(result.DeletedReleaseIds);
        foreach (var invalidId in new[] { unicodeDigit, noncanonicalTimestamp, invalidDate, invalidTime })
        {
            Assert.True(Directory.Exists(Path.Combine(root, invalidId)));
            Assert.Contains(result.Issues, issue => issue.ReleaseId == invalidId);
        }
        if (trailingNewlineCreated)
        {
            Assert.True(Directory.Exists(Path.Combine(root, trailingNewline)));
            Assert.Contains(result.Issues, issue => issue.ReleaseId == trailingNewline);
        }
    }

    [Fact]
    public async Task PrunesOnlyBeyondTenEligibleInactiveReleasesInTimestampAndOrdinalOrder()
    {
        var catalog = new ContentReleaseCatalog(root);
        var loader = new ContentSnapshotLoader();
        var baseTime = new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero);
        var active = WorkflowId(baseTime.AddDays(20), "ffffff0");
        WriteRelease(active, "Active");
        catalog.WriteActiveReleaseId(active);

        for (var hoursAgo = 9; hoursAgo >= 1; hoursAgo--)
            WriteRelease(WorkflowId(baseTime.AddHours(hoursAgo), hoursAgo.ToString("x7")), "Recent " + hoursAgo);
        var tieTimestamp = baseTime;
        var tied = new[] { "0000001", "0000002", "0000003" };
        foreach (var sha in tied) WriteRelease(WorkflowId(tieTimestamp, sha), "Tie " + sha);

        var result = await catalog.PruneInactiveReleasesAsync(active, loader);

        Assert.False(result.Aborted);
        Assert.Equal(12, result.EligibleInactiveReleaseCount);
        Assert.Equal(10, result.RetainedInactiveReleaseCount);
        Assert.Equal([WorkflowId(tieTimestamp, "0000002"), WorkflowId(tieTimestamp, "0000003")], result.DeletedReleaseIds);
        Assert.True(Directory.Exists(Path.Combine(root, WorkflowId(tieTimestamp, "0000001"))));
        Assert.Equal(10, Enumerable.Range(1, 9).Count(hours => Directory.Exists(Path.Combine(root, WorkflowId(baseTime.AddHours(hours), hours.ToString("x7"))))) + (Directory.Exists(Path.Combine(root, WorkflowId(tieTimestamp, "0000001"))) ? 1 : 0));
    }

    [Fact]
    public async Task ActiveOldRollbackReleaseIsProtectedOutsideTheInactiveRetentionWindow()
    {
        var catalog = new ContentReleaseCatalog(root);
        var loader = new ContentSnapshotLoader();
        var now = new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero);
        var active = WorkflowId(now.AddDays(-30), "0000001");
        WriteRelease(active, "Old active rollback");
        catalog.WriteActiveReleaseId(active);
        var inactive = Enumerable.Range(1, 11)
            .Select(index => WorkflowId(now.AddHours(index), index.ToString("x7")))
            .ToArray();
        foreach (var id in inactive) WriteRelease(id, "Inactive " + id);

        var result = await catalog.PruneInactiveReleasesAsync(active, loader);

        Assert.False(result.Aborted);
        Assert.True(Directory.Exists(Path.Combine(root, active)));
        Assert.Equal([inactive[0]], result.DeletedReleaseIds);
        Assert.Equal(10, inactive.Count(id => Directory.Exists(Path.Combine(root, id))));
    }

    [Fact]
    public async Task PruningTouchesOnlyReleaseDirectoriesAndPreservesAllRootFiles()
    {
        var catalog = new ContentReleaseCatalog(root);
        var loader = new ContentSnapshotLoader();
        var now = new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero);
        var active = WorkflowId(now.AddDays(2), "abcdef0");
        WriteRelease(active, "Active");
        catalog.WriteActiveReleaseId(active);
        var inactive = Enumerable.Range(1, 11).Select(index => WorkflowId(now.AddHours(index), index.ToString("x7"))).ToArray();
        foreach (var id in inactive) WriteRelease(id, "Inactive " + id);
        File.WriteAllText(Path.Combine(root, ContentReleaseCatalog.ActivationTokenFileName), new string('t', 40));
        File.WriteAllText(Path.Combine(root, "active-release.pointer.tmp"), "not a release");
        File.WriteAllText(Path.Combine(root, ".active-release.txt.temporary.tmp"), "also protected");
        File.WriteAllText(Path.Combine(root, "operator-notes.txt"), "keep this root file");

        var result = await catalog.PruneInactiveReleasesAsync(active, loader);

        Assert.Equal([inactive[0]], result.DeletedReleaseIds);
        Assert.Equal(active, File.ReadAllText(Path.Combine(root, ContentReleaseCatalog.ActiveReleaseFileName)));
        Assert.Equal(new string('t', 40), File.ReadAllText(Path.Combine(root, ContentReleaseCatalog.ActivationTokenFileName)));
        Assert.Equal("not a release", File.ReadAllText(Path.Combine(root, "active-release.pointer.tmp")));
        Assert.Equal("also protected", File.ReadAllText(Path.Combine(root, ".active-release.txt.temporary.tmp")));
        Assert.Equal("keep this root file", File.ReadAllText(Path.Combine(root, "operator-notes.txt")));
    }

    [Fact]
    public async Task MalformedIncompleteUnrecognizedAndUnexpectedReleaseTreesArePreservedAndReported()
    {
        var catalog = new ContentReleaseCatalog(root);
        var loader = new ContentSnapshotLoader();
        var active = WorkflowId(new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero), "abcdef0");
        WriteRelease(active, "Active");
        catalog.WriteActiveReleaseId(active);
        var malformed = "20261301T000000Z-abcdef0";
        var incomplete = WorkflowId(new DateTimeOffset(2026, 10, 1, 0, 0, 0, TimeSpan.Zero), "abcdef1");
        var unexpected = WorkflowId(new DateTimeOffset(2026, 9, 1, 0, 0, 0, TimeSpan.Zero), "abcdef2");
        Directory.CreateDirectory(Path.Combine(root, malformed));
        Directory.CreateDirectory(Path.Combine(root, "legacy-release"));
        Directory.CreateDirectory(Path.Combine(root, incomplete, "pages"));
        File.WriteAllText(Path.Combine(root, incomplete, "site.json"), "not valid site identity");
        Directory.CreateDirectory(Path.Combine(root, unexpected, "pages"));
        File.WriteAllText(Path.Combine(root, unexpected, "site.json"), "{\"supportedLocales\":[\"sv-SE\"],\"siteName\":\"Unexpected\"}");
        File.WriteAllText(Path.Combine(root, unexpected, "extra.json"), "unexpected");

        var result = await catalog.PruneInactiveReleasesAsync(active, loader);

        Assert.False(result.Aborted);
        Assert.Empty(result.DeletedReleaseIds);
        Assert.All(new[] { malformed, "legacy-release", incomplete, unexpected }, id => Assert.True(Directory.Exists(Path.Combine(root, id))));
        Assert.Contains(result.Issues, issue => issue.ReleaseId == malformed);
        Assert.Contains(result.Issues, issue => issue.ReleaseId == "legacy-release");
        Assert.Contains(result.Issues, issue => issue.ReleaseId == incomplete);
        Assert.Contains(result.Issues, issue => issue.ReleaseId == unexpected);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("invalid")]
    [InlineData("mismatch")]
    public async Task MissingInvalidOrMismatchedActivePointerAbortsWithoutPruning(string pointerState)
    {
        var catalog = new ContentReleaseCatalog(root);
        var loader = new ContentSnapshotLoader();
        var now = new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero);
        var expectedActive = WorkflowId(now.AddDays(2), "abcdef0");
        WriteRelease(expectedActive, "Expected active");
        var inactive = Enumerable.Range(1, 11).Select(index => WorkflowId(now.AddHours(index), index.ToString("x7"))).ToArray();
        foreach (var id in inactive) WriteRelease(id, "Inactive " + id);
        if (pointerState == "invalid") File.WriteAllText(Path.Combine(root, ContentReleaseCatalog.ActiveReleaseFileName), "../escape");
        if (pointerState == "mismatch") catalog.WriteActiveReleaseId(WorkflowId(now.AddDays(3), "abcdef1"));

        var result = await catalog.PruneInactiveReleasesAsync(expectedActive, loader);

        Assert.True(result.Aborted);
        Assert.Empty(result.DeletedReleaseIds);
        Assert.All(inactive, id => Assert.True(Directory.Exists(Path.Combine(root, id))));
        Assert.True(Directory.Exists(Path.Combine(root, expectedActive)));
    }

    [Fact]
    public async Task DeleteFailureIsReportedWithoutLosingOtherEligibleReleases()
    {
        var now = new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero);
        var active = WorkflowId(now.AddDays(2), "abcdef0");
        WriteRelease(active, "Active");
        var inactive = Enumerable.Range(1, 11).Select(index => WorkflowId(now.AddHours(index), index.ToString("x7"))).ToArray();
        foreach (var id in inactive) WriteRelease(id, "Inactive " + id);
        var catalog = new ContentReleaseCatalog(root, _ => throw new IOException("simulated delete failure"));
        catalog.WriteActiveReleaseId(active);

        var result = await catalog.PruneInactiveReleasesAsync(active, new ContentSnapshotLoader());

        Assert.False(result.Aborted);
        Assert.Empty(result.DeletedReleaseIds);
        var issue = Assert.Single(result.Issues, item => item.ReleaseId == inactive[0]);
        Assert.Contains("simulated delete failure", issue.Reason);
        Assert.Contains("remains unchanged", issue.Reason);
        Assert.DoesNotContain("preserved", issue.Reason, StringComparison.OrdinalIgnoreCase);
        Assert.True(Directory.Exists(Path.Combine(root, inactive[0])));
    }

    [Fact]
    public async Task DeleteFailureDuringPostCommitPruningDoesNotFailActivation()
    {
        var now = new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero);
        var previousActive = WorkflowId(now.AddDays(-20), "0000001");
        var nextActive = WorkflowId(now.AddDays(20), "abcdef0");
        WriteRelease(previousActive, "Previous active");
        WriteRelease(nextActive, "Next active");
        var inactive = Enumerable.Range(1, 11).Select(index => WorkflowId(now.AddHours(index), index.ToString("x7"))).ToArray();
        foreach (var id in inactive) WriteRelease(id, "Inactive " + id);
        var catalog = new ContentReleaseCatalog(root, path =>
        {
            File.Delete(Path.Combine(path, "pages", "cv.md"));
            throw new IOException("simulated partial delete failure");
        });
        catalog.WriteActiveReleaseId(previousActive);
        var loader = new ContentSnapshotLoader();
        var initial = await loader.LoadAsync(catalog.PagesPath(previousActive));
        var store = new ContentSnapshotStore(initial, loader, previousActive);
        ContentReleasePruneResult? cleanup = null;

        var diff = await store.ActivateAsync(
            catalog.PagesPath(nextActive),
            nextActive,
            persist: () => catalog.WriteActiveReleaseId(nextActive),
            afterCommit: async () => cleanup = await catalog.PruneInactiveReleasesAsync(nextActive, loader));

        Assert.Equal(nextActive, catalog.ReadActiveReleaseId());
        Assert.NotEqual(initial.Version, store.Current.Version);
        Assert.Equal(store.Current.Version, diff.ToVersion);
        var cleanupResult = Assert.IsType<ContentReleasePruneResult>(cleanup);
        Assert.Empty(cleanupResult.DeletedReleaseIds);
        var cleanupIssue = Assert.Single(cleanupResult.Issues, issue => issue.ReleaseId == inactive[0]);
        Assert.Contains("simulated partial delete failure", cleanupIssue.Reason);
        Assert.Contains("has changed", cleanupIssue.Reason);
        Assert.Contains("partial", cleanupIssue.Reason);
        Assert.DoesNotContain("preserved", cleanupIssue.Reason, StringComparison.OrdinalIgnoreCase);
        Assert.True(Directory.Exists(Path.Combine(root, inactive[0])));
        Assert.False(File.Exists(Path.Combine(root, inactive[0], "pages", "cv.md")));
    }

    [Fact]
    public async Task ReparsePointReleaseDirectoryIsPreservedWithoutFollowingIt()
    {
        var outside = Path.Combine(Path.GetTempPath(), "portfolio-outside-release-" + Guid.NewGuid().ToString("N"));
        var catalog = new ContentReleaseCatalog(root);
        var active = WorkflowId(new DateTimeOffset(2026, 11, 2, 0, 0, 0, TimeSpan.Zero), "abcdef0");
        WriteRelease(active, "Active");
        catalog.WriteActiveReleaseId(active);
        var linkedId = WorkflowId(new DateTimeOffset(2026, 10, 1, 0, 0, 0, TimeSpan.Zero), "abcdef1");
        var outsideRelease = Path.Combine(outside, linkedId);
        WriteReleaseUnder(outside, linkedId, "Outside target");
        try
        {
            Directory.CreateSymbolicLink(Path.Combine(root, linkedId), outsideRelease);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or PlatformNotSupportedException or NotSupportedException)
        {
            if (Directory.Exists(outside)) Directory.Delete(outside, recursive: true);
            output.WriteLine($"SKIP: directory symlinks are unsupported in this environment: {exception.Message}");
            return;
        }

        try
        {
            var result = await catalog.PruneInactiveReleasesAsync(active, new ContentSnapshotLoader());
            Assert.False(result.Aborted);
            Assert.True(Directory.Exists(Path.Combine(root, linkedId)));
            Assert.True(File.Exists(Path.Combine(outsideRelease, "site.json")));
            Assert.Contains(result.Issues, issue => issue.ReleaseId == linkedId && issue.Reason.Contains("reparse", StringComparison.OrdinalIgnoreCase));
        }
        finally
        {
            if (Directory.Exists(outside)) Directory.Delete(outside, recursive: true);
        }
    }

    [Fact]
    public async Task ReparsePointAncestorOfReleaseRootAbortsCleanup()
    {
        var actualParent = Path.Combine(Path.GetTempPath(), "portfolio-release-parent-" + Guid.NewGuid().ToString("N"));
        var linkedParent = Path.Combine(Path.GetTempPath(), "portfolio-release-parent-link-" + Guid.NewGuid().ToString("N"));
        var actualRoot = Path.Combine(actualParent, "releases");
        var linkedRoot = Path.Combine(linkedParent, "releases");
        Directory.CreateDirectory(actualRoot);
        var active = WorkflowId(new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero), "abcdef0");
        var catalog = new ContentReleaseCatalog(actualRoot);
        WriteReleaseUnder(actualRoot, active, "Active");
        catalog.WriteActiveReleaseId(active);
        try
        {
            Directory.CreateSymbolicLink(linkedParent, actualParent);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or PlatformNotSupportedException or NotSupportedException)
        {
            Directory.Delete(actualParent, recursive: true);
            output.WriteLine($"SKIP: directory symlinks are unsupported in this environment: {exception.Message}");
            return;
        }

        try
        {
            var result = await new ContentReleaseCatalog(linkedRoot).PruneInactiveReleasesAsync(active, new ContentSnapshotLoader());
            Assert.True(result.Aborted);
            Assert.Contains("reparse", result.AbortReason, StringComparison.OrdinalIgnoreCase);
            Assert.True(Directory.Exists(Path.Combine(actualRoot, active)));
        }
        finally
        {
            Directory.Delete(linkedParent);
            if (Directory.Exists(actualParent)) Directory.Delete(actualParent, recursive: true);
        }
    }

    [Fact]
    public async Task ReleaseRootReparsePointAbortsCleanup()
    {
        var actualRoot = Path.Combine(Path.GetTempPath(), "portfolio-release-real-" + Guid.NewGuid().ToString("N"));
        var linkRoot = Path.Combine(Path.GetTempPath(), "portfolio-release-link-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(actualRoot);
        var active = WorkflowId(new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero), "abcdef0");
        var actualCatalog = new ContentReleaseCatalog(actualRoot);
        WriteReleaseUnder(actualRoot, active, "Active");
        actualCatalog.WriteActiveReleaseId(active);
        try
        {
            Directory.CreateSymbolicLink(linkRoot, actualRoot);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or PlatformNotSupportedException or NotSupportedException)
        {
            Directory.Delete(actualRoot, recursive: true);
            output.WriteLine($"SKIP: directory symlinks are unsupported in this environment: {exception.Message}");
            return;
        }

        try
        {
            var result = await new ContentReleaseCatalog(linkRoot).PruneInactiveReleasesAsync(active, new ContentSnapshotLoader());
            Assert.True(result.Aborted);
            Assert.Contains("reparse", result.AbortReason, StringComparison.OrdinalIgnoreCase);
            Assert.True(Directory.Exists(Path.Combine(actualRoot, active)));
        }
        finally
        {
            if (Directory.Exists(linkRoot) || (File.GetAttributes(linkRoot) & FileAttributes.ReparsePoint) != 0) Directory.Delete(linkRoot);
            if (Directory.Exists(actualRoot)) Directory.Delete(actualRoot, recursive: true);
        }
    }

    private static string WorkflowId(DateTimeOffset timestamp, string sha) => timestamp.UtcDateTime.ToString("yyyyMMdd-HHmmss", System.Globalization.CultureInfo.InvariantCulture) + "-" + sha;

    private static void WriteReleaseUnder(string releaseRoot, string releaseId, string siteName)
    {
        var pages = Path.Combine(releaseRoot, releaseId, "pages");
        Directory.CreateDirectory(pages);
        File.WriteAllText(Path.Combine(releaseRoot, releaseId, "site.json"), $"{{\"supportedLocales\":[\"sv-SE\"],\"siteName\":\"{siteName}\"}}");
        foreach (var slug in new[] { "home", "cv", "services", "projects", "contact" })
            File.WriteAllText(Path.Combine(pages, slug + ".md"), $"---\ntitle: {siteName} {slug}\ndescription: Test {slug}\nlocale: sv-SE\nstatus: published\ntype: page\n---\n# {siteName}\n\nText for {slug}.");
    }

    private void WriteRelease(string releaseId, string siteName) => WriteReleaseUnder(root, releaseId, siteName);
}
