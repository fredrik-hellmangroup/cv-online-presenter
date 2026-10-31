using Portfolio.Content;
using Portfolio.Experience;
using Portfolio.Publishing;

namespace Portfolio.Web;

public sealed class SiteContent(ContentSnapshotStore store, IHttpContextAccessor accessor, MarkdownContentService renderer)
{
    public ContentSnapshot Snapshot => accessor.HttpContext?.Items[typeof(ContentSnapshot)] as ContentSnapshot ?? store.Current;

    public static IReadOnlyDictionary<string, string> CoreRoutes => PortfolioRoutes.CorePages;
    public SiteIdentity Settings => Snapshot.Identity;
    public string? SiteUrl => Snapshot.Identity.SiteUrl;
    public string Version => Snapshot.Version;
    public IEnumerable<ContentDocument> PublishedProjects => Snapshot.Documents.Where(item => item.Type == "project" && IsPublished(item));

    public ContentDocument? FindByPath(string path)
    {
        if (CoreRoutes.TryGetValue(path, out var slug))
            return Snapshot.Documents.FirstOrDefault(item => item.Slug.Equals(slug, StringComparison.OrdinalIgnoreCase) && IsPublished(item));
        if (path.StartsWith("/projects/", StringComparison.OrdinalIgnoreCase))
            return PublishedProjects.FirstOrDefault(item => item.Slug.Equals(path.TrimStart('/'), StringComparison.OrdinalIgnoreCase));
        return null;
    }

    public string Render(ContentDocument document) => renderer.Render(document.Markdown);

    // The CV view is derived from the rendered CV page, so it is cached per content snapshot.
    private static readonly Lock CvLock = new();
    private static string? cachedCvVersion;
    private static CvView? cachedCv;

    public CvView? Cv
    {
        get
        {
            var snapshot = Snapshot;
            lock (CvLock)
            {
                if (cachedCvVersion == snapshot.Version) return cachedCv;
            }
            var document = FindByPath("/cv");
            var view = document is null ? null : CvPresenter.Build(Render(document));
            lock (CvLock)
            {
                cachedCvVersion = snapshot.Version;
                cachedCv = view;
            }
            return view;
        }
    }

    public IReadOnlyList<SearchResult> Search(string? query) => PortfolioSearch.Find(
        Snapshot, query, new PublicationPolicy(Snapshot.Identity.SupportedLocales.ToHashSet(StringComparer.OrdinalIgnoreCase)));

    private bool IsPublished(ContentDocument document) =>
        new PublicationPolicy(Snapshot.Identity.SupportedLocales.ToHashSet(StringComparer.OrdinalIgnoreCase))
            .IsPublished(document.Status, document.Locale);
}
