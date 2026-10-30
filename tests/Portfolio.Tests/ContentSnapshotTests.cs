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
            await Assert.ThrowsAsync<ContentValidationException>(() => store.ActivateAsync(pages));
            Assert.Same(initial, store.Current);
            await File.WriteAllTextAsync(page, "---\ntitle: Home\ndescription: Welcome\nlocale: sv-SE\nstatus: published\ntype: page\n---\n# Updated");
            var diff = await store.ActivateAsync(pages);
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
}
