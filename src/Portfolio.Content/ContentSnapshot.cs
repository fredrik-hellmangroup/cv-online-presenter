using System.Collections.Immutable;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Portfolio.Content;

// A named group of technologies from site.json "techGroups"; it only says where an assignment keyword is listed.
public sealed record TechGroup(string Name, IReadOnlyList<string> Items);

public sealed record SiteIdentity(
    IReadOnlyList<string> SupportedLocales,
    string? ContactEmail,
    string SiteName,
    string? SiteUrl,
    string? CompanyName = null,
    IReadOnlyList<TechGroup>? TechGroups = null,
    int OtherSkillsLimit = SiteIdentity.DefaultOtherSkillsLimit,
    IReadOnlyList<string>? TechConcepts = null)
{
    public const int DefaultOtherSkillsLimit = 9;
}

public sealed record ContentSnapshot(
    string Version,
    SiteIdentity Identity,
    ImmutableArray<ContentDocument> Documents,
    ImmutableDictionary<string, ImmutableArray<ClassifiedSection>> Sections);

public sealed record ContentStructuralDiff(
    string FromVersion,
    string ToVersion,
    IReadOnlyList<string> Added,
    IReadOnlyList<string> Removed,
    IReadOnlyList<string> Changed);

public sealed class ContentSnapshotLoader(IReadOnlyCollection<string>? requiredPublishedSlugs = null)
{
    private readonly MarkdownContentService contentService = new();
    private readonly ContentSectionClassifier classifier = new();

    public async Task<ContentSnapshot> LoadAsync(string pagesRoot, CancellationToken cancellationToken = default)
    {
        var fullPagesRoot = Path.GetFullPath(pagesRoot);
        ContentPathGuard.EnsureOrdinaryDirectory(fullPagesRoot, "Content pages root");
        var canonicalPagesRoot = ContentPathGuard.CanonicalizeExistingPath(fullPagesRoot);
        var releaseRoot = Directory.GetParent(fullPagesRoot)?.FullName
            ?? throw new InvalidOperationException("The content pages root must have a parent directory.");
        ContentPathGuard.EnsureOrdinaryDirectory(releaseRoot, "Content release root");
        var canonicalReleaseRoot = ContentPathGuard.CanonicalizeExistingPath(releaseRoot);
        ContentPathGuard.EnsureWithinRoot(canonicalReleaseRoot, canonicalPagesRoot, "Pages root");

        var settingsPath = Path.Combine(releaseRoot, "site.json");
        ContentPathGuard.EnsureOrdinaryFile(settingsPath, "Content site.json");
        var canonicalSettingsPath = ContentPathGuard.CanonicalizeExistingPath(settingsPath);
        ContentPathGuard.EnsureWithinRoot(canonicalReleaseRoot, canonicalSettingsPath, "Content site.json");
        var settingsJson = await File.ReadAllTextAsync(canonicalSettingsPath, cancellationToken);
        var settings = JsonSerializer.Deserialize<SiteIdentitySettings>(settingsJson, new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidOperationException("The content/site.json configuration is invalid.");
        if (settings.SupportedLocales is null || settings.SupportedLocales.Length == 0 || string.IsNullOrWhiteSpace(settings.SiteName))
            throw new InvalidOperationException("The content/site.json identity is incomplete.");

        var documents = await contentService.LoadDirectoryAsync(canonicalPagesRoot, cancellationToken);
        var locales = settings.SupportedLocales.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var errors = contentService.Validate(documents, locales).ToList();
        foreach (var slug in requiredPublishedSlugs ?? [])
        {
            if (!documents.Any(document => document.Slug.Equals(slug, StringComparison.OrdinalIgnoreCase)
                && document.Status.Equals("published", StringComparison.OrdinalIgnoreCase) && locales.Contains(document.Locale)))
                errors.Add(new(Path.Combine(pagesRoot, slug + ".md"), $"A published page '{slug}' is required."));
        }

        if (errors.Count > 0) throw new ContentValidationException(errors);

        var immutableDocuments = documents.Select(document => document with
        {
            Metadata = document.Metadata.ToImmutableDictionary(StringComparer.OrdinalIgnoreCase)
        }).ToImmutableArray();
        var sections = immutableDocuments.ToImmutableDictionary(
            document => document.Slug,
            document => classifier.Classify(document).ToImmutableArray(),
            StringComparer.OrdinalIgnoreCase);
        var source = new StringBuilder(settingsJson);
        foreach (var document in immutableDocuments.OrderBy(item => item.SourcePath, StringComparer.Ordinal))
            source.Append('\n').Append(document.SourcePath).Append('\n').Append(document.Markdown).Append('\n')
                .Append(JsonSerializer.Serialize(document.Metadata));
        var version = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(source.ToString()))).ToLowerInvariant();
        var identity = new SiteIdentity(settings.SupportedLocales.ToImmutableArray(), settings.ContactEmail, settings.SiteName, NormalizeSiteUrl(settings.SiteUrl), settings.CompanyName, NormalizeTechGroups(settings.TechGroups), NormalizeOtherLimit(settings.OtherSkills), NormalizeConcepts(settings.TechReview));
        return new(version, identity, immutableDocuments, sections);
    }

    private static int NormalizeOtherLimit(OtherSkillsSettings? settings)
    {
        var limit = settings?.Limit ?? SiteIdentity.DefaultOtherSkillsLimit;
        if (limit < 0) throw new InvalidOperationException("otherSkills.limit in site.json must not be negative.");
        return limit;
    }

    private static IReadOnlyList<string>? NormalizeConcepts(TechReviewSettings? settings)
    {
        var concepts = settings?.Concepts?.Select(item => item?.Trim() ?? string.Empty).ToArray();
        if (concepts is null || concepts.Length == 0) return null;
        if (concepts.Any(item => item.Length == 0))
            throw new InvalidOperationException("techReview.concepts in site.json must only list non-empty names.");
        return concepts;
    }

    private static IReadOnlyList<TechGroup>? NormalizeTechGroups(TechGroup[]? groups)
    {
        if (groups is null || groups.Length == 0) return null;
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var normalized = new List<TechGroup>();
        foreach (var group in groups)
        {
            var name = group?.Name?.Trim();
            var items = group?.Items?.Select(item => item?.Trim() ?? string.Empty).ToArray() ?? [];
            if (string.IsNullOrEmpty(name) || items.Length == 0 || items.Any(item => item.Length == 0))
                throw new InvalidOperationException("Every techGroups entry in site.json needs a name and non-empty items.");
            foreach (var item in items)
                if (!seen.Add(item)) throw new InvalidOperationException($"techGroups in site.json lists '{item}' more than once.");
            normalized.Add(new TechGroup(name, items));
        }
        return normalized;
    }

    private static string? NormalizeSiteUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme is not ("https" or "http"))
            throw new InvalidOperationException("siteUrl must be an absolute HTTP or HTTPS URL.");
        return uri.GetLeftPart(UriPartial.Authority).TrimEnd('/');
    }

    public static ContentStructuralDiff Compare(ContentSnapshot before, ContentSnapshot after)
    {
        var oldKeys = before.Sections.Keys.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var newKeys = after.Sections.Keys.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var added = newKeys.Except(oldKeys, StringComparer.OrdinalIgnoreCase).Order(StringComparer.Ordinal).ToArray();
        var removed = oldKeys.Except(newKeys, StringComparer.OrdinalIgnoreCase).Order(StringComparer.Ordinal).ToArray();
        var changed = oldKeys.Intersect(newKeys, StringComparer.OrdinalIgnoreCase)
            .Where(slug => !before.Sections[slug].SequenceEqual(after.Sections[slug])
                || JsonSerializer.Serialize(before.Documents.First(document => document.Slug.Equals(slug, StringComparison.OrdinalIgnoreCase)))
                    != JsonSerializer.Serialize(after.Documents.First(document => document.Slug.Equals(slug, StringComparison.OrdinalIgnoreCase))))
            .Order(StringComparer.Ordinal).ToArray();
        return new(before.Version, after.Version, added, removed, changed);
    }

    private sealed record SiteIdentitySettings(
        string[] SupportedLocales, string? ContactEmail, string SiteName, string? SiteUrl, string? CompanyName = null, TechGroup[]? TechGroups = null,
        OtherSkillsSettings? OtherSkills = null, TechReviewSettings? TechReview = null);

    private sealed record OtherSkillsSettings(int? Limit = null);

    private sealed record TechReviewSettings(string[]? Concepts = null);
}

public sealed record ContentReleaseState(string? ContentReleaseId, ContentSnapshot Snapshot);

public sealed class ContentSnapshotStore
{
    private readonly SemaphoreSlim operationLock = new(1, 1);
    private readonly ContentSnapshotLoader loader;
    private ContentReleaseState currentState;

    public ContentSnapshotStore(ContentSnapshot initial, ContentSnapshotLoader loader, string? contentReleaseId = null)
    {
        ArgumentNullException.ThrowIfNull(initial);
        this.loader = loader ?? throw new ArgumentNullException(nameof(loader));
        currentState = new(contentReleaseId, initial);
    }

    public ContentReleaseState CurrentState => Volatile.Read(ref currentState);

    public ContentSnapshot Current => CurrentState.Snapshot;

    public async Task<ContentStructuralDiff> PreviewAsync(string pagesRoot, CancellationToken cancellationToken = default)
    {
        await operationLock.WaitAsync(cancellationToken);
        try
        {
            var candidate = await loader.LoadAsync(pagesRoot, cancellationToken);
            return ContentSnapshotLoader.Compare(CurrentState.Snapshot, candidate);
        }
        finally
        {
            operationLock.Release();
        }
    }

    public async Task<ContentStructuralDiff> ActivateAsync(
        string pagesRoot,
        string? releaseId,
        CancellationToken cancellationToken = default,
        Action? persist = null,
        Func<Task>? afterCommit = null,
        Action<Exception>? maintenanceFailure = null)
    {
        await operationLock.WaitAsync(cancellationToken);
        try
        {
            var candidate = await loader.LoadAsync(pagesRoot, cancellationToken);
            var diff = ContentSnapshotLoader.Compare(CurrentState.Snapshot, candidate);
            // Persisting and swapping without an await/cancellation gap keeps the pointer and served state ordered.
            persist?.Invoke();
            Volatile.Write(ref currentState, new ContentReleaseState(releaseId, candidate));

            if (afterCommit is not null)
            {
                try
                {
                    // Post-commit maintenance is best effort and deliberately has no request cancellation token.
                    await afterCommit();
                }
                catch (Exception exception)
                {
                    try { maintenanceFailure?.Invoke(exception); }
                    catch { /* Logging must not reverse or obscure the committed activation. */ }
                }
            }
            return diff;
        }
        finally
        {
            operationLock.Release();
        }
    }
}
