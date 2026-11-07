using Portfolio.Content;
using Portfolio.Web;
using Microsoft.AspNetCore.Http;

namespace Portfolio.Tests;

public sealed class ContentSnapshotTests
{
    [Fact]
    public async Task InvalidCandidateDoesNotReplaceActiveSnapshot()
    {
        var root = Path.Combine(Path.GetTempPath(), "portfolio-snapshot-" + Guid.NewGuid().ToString("N"));
        var pages = Path.Combine(root, "pages");
        Directory.CreateDirectory(pages);
        try
        {
            await File.WriteAllTextAsync(Path.Combine(root, "site.json"), "{\"supportedLocales\":[\"sv-SE\"],\"siteName\":\"Test\"}");
            var page = Path.Combine(pages, "home.md");
            await File.WriteAllTextAsync(page, "---\ntitle: Home\ndescription: Welcome\nlocale: sv-SE\nstatus: published\ntype: page\n---\n# Home");
            var loader = new ContentSnapshotLoader();
            var initial = await loader.LoadAsync(pages);
            var store = new ContentSnapshotStore(initial, loader);
            var accessor = new HttpContextAccessor { HttpContext = new DefaultHttpContext() };
            accessor.HttpContext.Items[typeof(ContentSnapshot)] = initial;
            var siteContent = new SiteContent(store, accessor, new MarkdownContentService());
            await File.WriteAllTextAsync(page, "invalid content");
            await Assert.ThrowsAsync<ContentValidationException>(() => store.ActivateAsync(pages, releaseId: null));
            Assert.Same(initial, store.Current);
            await File.WriteAllTextAsync(page, "---\ntitle: Home\ndescription: Welcome\nlocale: sv-SE\nstatus: published\ntype: page\n---\n# Updated");
            var diff = await store.ActivateAsync(pages, releaseId: null);
            Assert.NotEqual(initial.Version, store.Current.Version);
            Assert.Equal(["home"], diff.Changed);
            Assert.Equal(initial.Version, siteContent.Version);
            accessor.HttpContext.Items[typeof(ContentSnapshot)] = store.Current;
            Assert.Equal(store.Current.Version, siteContent.Version);
        }
        finally
        {
            Directory.Delete(root, true);
        }
    }

    [Fact]
    public async Task LoadAsyncAcceptsPublishedProjectWithoutLinks()
    {
        var root = Path.Combine(Path.GetTempPath(), "portfolio-snapshot-project-" + Guid.NewGuid().ToString("N"));
        var pages = CreatePages(root, "Synthetic");
        try
        {
            var projects = Path.Combine(pages, "projects");
            Directory.CreateDirectory(projects);
            await File.WriteAllTextAsync(Path.Combine(projects, "sample-project.md"), """
                ---
                title: Sample project
                description: Synthetic project description
                locale: sv-SE
                status: published
                type: project
                summary: Synthetic summary
                technologies: [Example]
                ---
                # Sample project

                Synthetic project body.
                """);

            var snapshot = await new ContentSnapshotLoader().LoadAsync(pages);
            var project = snapshot.Documents.Single(document => document.Slug == "projects/sample-project");

            Assert.Equal("published", project.Status);
            Assert.DoesNotContain("links", project.Metadata.Keys);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task ActiveReleaseStatePublishesReleaseIdAndSnapshotAsOneImmutableValue()
    {
        var root = Path.Combine(Path.GetTempPath(), "portfolio-snapshot-state-" + Guid.NewGuid().ToString("N"));
        var initialPages = CreatePages(root, "Initial");
        var candidatePages = CreatePages(Path.Combine(root, "candidate"), "Candidate");
        try
        {
            var loader = new ContentSnapshotLoader();
            var initial = await loader.LoadAsync(initialPages);
            var store = new ContentSnapshotStore(initial, loader, "initial-release");
            var previousState = store.CurrentState;
            ContentReleaseState? stateObservedDuringPersistence = null;

            await store.ActivateAsync(
                candidatePages,
                "candidate-release",
                persist: () => stateObservedDuringPersistence = store.CurrentState);

            Assert.Same(previousState, stateObservedDuringPersistence);
            Assert.NotSame(previousState, store.CurrentState);
            Assert.Equal("initial-release", previousState.ContentReleaseId);
            Assert.Same(initial, previousState.Snapshot);
            Assert.Equal("candidate-release", store.CurrentState.ContentReleaseId);
            Assert.Equal("Candidate", store.CurrentState.Snapshot.Identity.SiteName);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task FailedPointerPersistencePreservesTheSameReleaseState()
    {
        var root = Path.Combine(Path.GetTempPath(), "portfolio-snapshot-persist-" + Guid.NewGuid().ToString("N"));
        var initialPages = CreatePages(root, "Initial");
        var candidatePages = CreatePages(Path.Combine(root, "candidate"), "Candidate");
        try
        {
            var loader = new ContentSnapshotLoader();
            var initial = await loader.LoadAsync(initialPages);
            var store = new ContentSnapshotStore(initial, loader, "initial-release");
            var previousState = store.CurrentState;
            var cleanupRan = false;

            await Assert.ThrowsAsync<IOException>(() => store.ActivateAsync(
                candidatePages,
                "candidate-release",
                persist: () => throw new IOException("simulated pointer write failure"),
                afterCommit: () => { cleanupRan = true; return Task.CompletedTask; }));

            Assert.Same(previousState, store.CurrentState);
            Assert.Same(initial, store.CurrentState.Snapshot);
            Assert.Equal("initial-release", store.CurrentState.ContentReleaseId);
            Assert.False(cleanupRan);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task CleanupFailureDoesNotChangeCommittedActivationSuccess()
    {
        var root = Path.Combine(Path.GetTempPath(), "portfolio-snapshot-cleanup-" + Guid.NewGuid().ToString("N"));
        var initialPages = CreatePages(root, "Initial");
        var candidatePages = CreatePages(Path.Combine(root, "candidate"), "Candidate");
        try
        {
            var loader = new ContentSnapshotLoader();
            var initial = await loader.LoadAsync(initialPages);
            var store = new ContentSnapshotStore(initial, loader);
            Exception? maintenanceFailure = null;

            var diff = await store.ActivateAsync(
                candidatePages,
                "candidate-release",
                persist: () => { },
                afterCommit: () => throw new IOException("simulated cleanup failure"),
                maintenanceFailure: exception => maintenanceFailure = exception);

            Assert.NotSame(initial, store.Current);
            Assert.Equal(store.Current.Version, diff.ToVersion);
            Assert.IsType<IOException>(maintenanceFailure);
            Assert.Equal("simulated cleanup failure", maintenanceFailure.Message);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task PreviewWaitsUntilPostCommitActivationMaintenanceReleasesTheStoreLock()
    {
        var root = Path.Combine(Path.GetTempPath(), "portfolio-snapshot-serialization-" + Guid.NewGuid().ToString("N"));
        var initialPages = CreatePages(root, "Initial");
        var candidatePages = CreatePages(Path.Combine(root, "candidate"), "Candidate");
        try
        {
            var loader = new ContentSnapshotLoader();
            var initial = await loader.LoadAsync(initialPages);
            var store = new ContentSnapshotStore(initial, loader);
            var maintenanceEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var allowMaintenanceToFinish = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var activation = store.ActivateAsync(
                candidatePages,
                "candidate-release",
                persist: () => { },
                afterCommit: async () =>
                {
                    maintenanceEntered.SetResult();
                    await allowMaintenanceToFinish.Task;
                });

            await maintenanceEntered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            var preview = store.PreviewAsync(initialPages);
            Assert.False(preview.IsCompleted);
            allowMaintenanceToFinish.SetResult();

            var activationDiff = await activation;
            var previewDiff = await preview;
            Assert.Equal(store.Current.Version, activationDiff.ToVersion);
            Assert.Equal(store.Current.Version, previewDiff.FromVersion);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task LoadAsyncReadsTechGroupsFromSiteSettings()
    {
        var root = Path.Combine(Path.GetTempPath(), "portfolio-snapshot-techgroups-" + Guid.NewGuid().ToString("N"));
        var pages = CreatePages(root, "Synthetic");
        try
        {
            await File.WriteAllTextAsync(Path.Combine(root, "site.json"),
                "{\"supportedLocales\":[\"sv-SE\"],\"siteName\":\"Synthetic\",\"techGroups\":[{\"name\":\" Core \",\"items\":[\".NET\",\" C# \"]}]}");

            var snapshot = await new ContentSnapshotLoader().LoadAsync(pages);

            var group = Assert.Single(snapshot.Identity.TechGroups!);
            Assert.Equal("Core", group.Name);
            Assert.Equal([".NET", "C#"], group.Items);
        }
        finally
        {
            Directory.Delete(root, true);
        }
    }

    [Theory]
    [InlineData("[{\"name\":\"\",\"items\":[\"A\"]}]")]
    [InlineData("[{\"name\":\"Core\",\"items\":[]}]")]
    [InlineData("[{\"name\":\"Core\",\"items\":[\"A\",\" \"]}]")]
    [InlineData("[{\"name\":\"Core\",\"items\":[\"A\"]},{\"name\":\"Data\",\"items\":[\"a\"]}]")]
    public async Task LoadAsyncRejectsInvalidTechGroups(string techGroups)
    {
        var root = Path.Combine(Path.GetTempPath(), "portfolio-snapshot-techgroups-invalid-" + Guid.NewGuid().ToString("N"));
        var pages = CreatePages(root, "Synthetic");
        try
        {
            await File.WriteAllTextAsync(Path.Combine(root, "site.json"),
                $"{{\"supportedLocales\":[\"sv-SE\"],\"siteName\":\"Synthetic\",\"techGroups\":{techGroups}}}");

            await Assert.ThrowsAsync<InvalidOperationException>(() => new ContentSnapshotLoader().LoadAsync(pages));
        }
        finally
        {
            Directory.Delete(root, true);
        }
    }

    private static string CreatePages(string parent, string siteName)
    {
        var pages = Path.Combine(parent, "pages");
        Directory.CreateDirectory(pages);
        File.WriteAllText(Path.Combine(parent, "site.json"), $"{{\"supportedLocales\":[\"sv-SE\"],\"siteName\":\"{siteName}\"}}");
        File.WriteAllText(Path.Combine(pages, "home.md"), $"---\ntitle: {siteName}\ndescription: Welcome\nlocale: sv-SE\nstatus: published\ntype: page\n---\n# {siteName}");
        return pages;
    }

}
