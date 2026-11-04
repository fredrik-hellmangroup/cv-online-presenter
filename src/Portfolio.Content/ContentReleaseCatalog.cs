using System.Globalization;
using System.Security;
using System.Text.RegularExpressions;

namespace Portfolio.Content;

/// <summary>
/// Named content releases on disk plus a persisted pointer to the active one, so an activation
/// survives app restarts and app redeployments. The release root must live outside the app directory.
/// </summary>
public sealed class ContentReleaseCatalog
{
    public const string ActiveReleaseFileName = "active-release.txt";
    public const string ActivationTokenFileName = "activation-token.txt";
    public const int MinimumActivationTokenLength = 32;
    public const int RetainedInactiveReleaseCount = 10;
    private const string WorkflowTimestampFormat = "yyyyMMdd-HHmmss";
    private static readonly Regex WorkflowReleaseIdPattern = new(@"\A[0-9]{8}-[0-9]{6}-[0-9a-f]{7}\z", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private readonly Action<string> deleteDirectory;

    public ContentReleaseCatalog(string releasesRoot, Action<string>? deleteDirectory = null)
    {
        if (string.IsNullOrWhiteSpace(releasesRoot)) throw new ArgumentException("A releases root is required.", nameof(releasesRoot));
        Root = Path.GetFullPath(releasesRoot);
        this.deleteDirectory = deleteDirectory ?? DeleteReleaseTreeWithoutFollowingReparsePoints;
    }

    public string Root { get; }

    public static string ValidateReleasesRoot(string releasesRoot, string appContentRoot)
    {
        if (string.IsNullOrWhiteSpace(releasesRoot)) throw new ArgumentException("A releases root is required.", nameof(releasesRoot));
        if (string.IsNullOrWhiteSpace(appContentRoot)) throw new ArgumentException("An app content root is required.", nameof(appContentRoot));

        ContentPathGuard.EnsureNoReparsePointsInExistingPath(releasesRoot, "content releases root");
        ContentPathGuard.EnsureNoReparsePointsInExistingPath(appContentRoot, "app content root");
        var root = Path.GetFullPath(releasesRoot);
        var appRoot = Path.GetFullPath(appContentRoot);
        var appDataPath = Path.Combine(appRoot, "App_Data");
        ContentPathGuard.EnsureNoReparsePointsInExistingPath(appDataPath, "app data root");
        var appDataRoot = Path.GetFullPath(appDataPath);
        if (IsSameOrWithin(root, appRoot) && !IsSameOrWithin(root, appDataRoot))
            throw new InvalidOperationException("Content:ReleasesRoot must be outside the app directory except for its documented App_Data location.");
        return root;
    }

    private static bool IsSameOrWithin(string path, string directory)
    {
        var fullPath = Path.GetFullPath(path);
        var fullDirectory = Path.GetFullPath(directory);
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        var directoryPrefix = fullDirectory.EndsWith(Path.DirectorySeparatorChar) || fullDirectory.EndsWith(Path.AltDirectorySeparatorChar)
            ? fullDirectory
            : fullDirectory + Path.DirectorySeparatorChar;
        return fullPath.Equals(fullDirectory, comparison) || fullPath.StartsWith(directoryPrefix, comparison);
    }

    public static bool IsValidReleaseId(string? releaseId) => !string.IsNullOrEmpty(releaseId)
        && releaseId.Length <= 100
        && releaseId.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_');

    public static bool TryParseWorkflowReleaseId(string? releaseId, out DateTimeOffset timestamp)
    {
        timestamp = default;
        if (releaseId is null || !WorkflowReleaseIdPattern.IsMatch(releaseId)) return false;
        return DateTimeOffset.TryParseExact(
            releaseId[..WorkflowTimestampFormat.Length],
            WorkflowTimestampFormat,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out timestamp);
    }

    public string PagesPath(string releaseId)
    {
        if (!IsValidReleaseId(releaseId)) throw new ArgumentException("The release id is invalid.", nameof(releaseId));
        return Path.Combine(Root, releaseId, "pages");
    }

    public string? ReadActivationToken()
    {
        try
        {
            var token = File.ReadAllText(Path.Combine(Root, ActivationTokenFileName)).Trim();
            return token.Length >= MinimumActivationTokenLength ? token : null;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    public string? ReadActiveReleaseId()
    {
        var pointer = Path.Combine(Root, ActiveReleaseFileName);
        string content;
        try
        {
            content = File.ReadAllText(pointer);
        }
        catch (Exception exception) when (exception is FileNotFoundException or DirectoryNotFoundException)
        {
            return null;
        }

        var releaseId = content.Trim();
        return IsValidReleaseId(releaseId) ? releaseId : throw new InvalidOperationException($"{ActiveReleaseFileName} does not contain a valid release id.");
    }

    public void WriteActiveReleaseId(string releaseId)
    {
        if (!IsValidReleaseId(releaseId)) throw new ArgumentException("The release id is invalid.", nameof(releaseId));
        Directory.CreateDirectory(Root);
        var temporary = Path.Combine(Root, $".{ActiveReleaseFileName}.{Guid.NewGuid():N}.tmp");
        try
        {
            File.WriteAllText(temporary, releaseId);
            File.Move(temporary, Path.Combine(Root, ActiveReleaseFileName), overwrite: true);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    public async Task<ContentReleasePruneResult> PruneInactiveReleasesAsync(
        string expectedActiveReleaseId,
        ContentSnapshotLoader loader,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(loader);
        if (!TryParseWorkflowReleaseId(expectedActiveReleaseId, out _))
            return ContentReleasePruneResult.Abort("The committed active release id is not a recognized workflow id.");

        if (!TryValidateRoot(out var rootError)) return ContentReleasePruneResult.Abort(rootError!);
        if (!PointerMatches(expectedActiveReleaseId, out var pointerError)) return ContentReleasePruneResult.Abort(pointerError!);

        string[] releaseDirectories;
        try
        {
            releaseDirectories = Directory.EnumerateDirectories(Root, "*", SearchOption.TopDirectoryOnly).ToArray();
        }
        catch (Exception exception) when (IsFilesystemException(exception))
        {
            return ContentReleasePruneResult.Abort($"Could not enumerate the release root: {exception.Message}");
        }

        var issues = new List<ContentReleasePruneIssue>();
        var eligible = new List<EligibleRelease>();
        foreach (var directory in releaseDirectories)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var releaseId = Path.GetFileName(directory);
            if (!IsWithinRoot(directory))
            {
                issues.Add(new(releaseId, "Directory path is outside the configured release root."));
                continue;
            }
            if (!TryParseWorkflowReleaseId(releaseId, out var timestamp))
            {
                issues.Add(new(releaseId, "Directory name is not a recognized workflow release id; preserved."));
                continue;
            }
            if (!TryValidateReleaseTree(directory, out var treeError))
            {
                issues.Add(new(releaseId, treeError!));
                continue;
            }

            try
            {
                await loader.LoadAsync(Path.Combine(directory, "pages"), cancellationToken);
                // Recheck after the loader has traversed the tree, so links and layout changes are not eligible.
                if (!TryValidateReleaseTree(directory, out treeError))
                {
                    issues.Add(new(releaseId, treeError!));
                    continue;
                }
                eligible.Add(new(releaseId, timestamp, directory));
            }
            catch (Exception exception) when (IsFilesystemException(exception) || exception is ContentValidationException or InvalidOperationException or System.Text.Json.JsonException)
            {
                issues.Add(new(releaseId, $"Release is incomplete, unreadable, or invalid; preserved: {exception.Message}"));
            }
        }

        var inactive = eligible.Where(item => !item.Id.Equals(expectedActiveReleaseId, StringComparison.Ordinal))
            .OrderByDescending(item => item.Timestamp)
            .ThenBy(item => item.Id, StringComparer.Ordinal)
            .ToArray();
        var candidates = inactive.Skip(RetainedInactiveReleaseCount).ToArray();

        var retainedInactiveCount = Math.Min(inactive.Length, RetainedInactiveReleaseCount);
        if (!PointerMatches(expectedActiveReleaseId, out pointerError))
            return new(true, pointerError, eligible.Count, inactive.Length, retainedInactiveCount, [], issues);

        var deleted = new List<string>();
        foreach (var candidate in candidates)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!TryValidateRoot(out rootError) || !IsWithinRoot(candidate.Path))
            {
                issues.Add(new(candidate.Id, rootError ?? "Candidate path is outside the configured release root; preserved."));
                continue;
            }
            if (!PointerMatches(expectedActiveReleaseId, out pointerError))
                return new(true, pointerError, eligible.Count, inactive.Length, retainedInactiveCount, deleted, issues);
            if (!TryValidateReleaseTree(candidate.Path, out var treeError))
            {
                issues.Add(new(candidate.Id, $"Candidate changed or is unsafe before deletion; no deletion attempted: {treeError}"));
                continue;
            }

            string? beforeDeleteState = null;
            try
            {
                await loader.LoadAsync(Path.Combine(candidate.Path, "pages"), cancellationToken);
                if (!TryValidateRoot(out rootError) || !IsWithinRoot(candidate.Path)
                    || !TryValidateReleaseTree(candidate.Path, out treeError))
                {
                    issues.Add(new(candidate.Id, $"Candidate changed or is unsafe before deletion; no deletion attempted: {rootError ?? treeError ?? "path boundary check failed"}"));
                    continue;
                }
                if (!PointerMatches(expectedActiveReleaseId, out pointerError))
                    return new(true, pointerError, eligible.Count, inactive.Length, retainedInactiveCount, deleted, issues);

                beforeDeleteState = CaptureReleaseTreeState(candidate.Path);
                // Repeat boundary and reparse checks immediately before path-based deletion. This relies
                // on the deployment workflow and app worker remaining the only serialized release-tree writers.
                if (!TryValidateRoot(out rootError) || !IsWithinRoot(candidate.Path)
                    || !TryValidateReleaseTree(candidate.Path, out treeError))
                {
                    issues.Add(new(candidate.Id, $"Candidate changed or is unsafe at deletion boundary; no deletion attempted: {rootError ?? treeError ?? "path boundary check failed"}"));
                    continue;
                }
                if (!PointerMatches(expectedActiveReleaseId, out pointerError))
                    return new(true, pointerError, eligible.Count, inactive.Length, retainedInactiveCount, deleted, issues);

                deleteDirectory(candidate.Path);
                EnsureReleaseDirectoryRemoved(candidate.Path);
                deleted.Add(candidate.Id);
            }
            catch (Exception exception) when (IsFilesystemException(exception) || exception is ContentValidationException or InvalidOperationException or System.Text.Json.JsonException)
            {
                var outcome = DescribeDeletionOutcome(candidate.Path, beforeDeleteState);
                issues.Add(new(candidate.Id, $"Release deletion failed: {outcome} Error: {exception.Message}"));
            }
        }

        return new(false, null, eligible.Count, inactive.Length, retainedInactiveCount, deleted, issues);
    }


    // Path-based deletion is safe only while filesystem writers under Root remain restricted to
    // additive, serialized deploy-content uploads and this app's single Plesk activation worker. Every observed
    // reparse point is rejected and directory removals are non-recursive, but path APIs cannot bind
    // validation and use to one handle against an untrusted concurrent filesystem writer.
    private void DeleteReleaseTreeWithoutFollowingReparsePoints(string releasePath)
    {
        EnsureSafeDirectory(releasePath, mustBeDirectChild: true);
        DeleteDirectoryContents(releasePath, releasePath);
        EnsureSafeDirectory(releasePath, mustBeDirectChild: true);
        Directory.Delete(releasePath, recursive: false);
    }

    private void DeleteDirectoryContents(string directory, string releaseRootPath)
    {
        var isReleaseRoot = Path.GetFullPath(directory).Equals(Path.GetFullPath(releaseRootPath),
            OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);
        EnsureSafeDirectory(directory, mustBeDirectChild: isReleaseRoot);
        foreach (var entry in Directory.EnumerateFileSystemEntries(directory).ToArray())
        {
            EnsureSafeDirectory(directory, mustBeDirectChild: isReleaseRoot);
            var fullEntry = Path.GetFullPath(entry);
            if (!IsWithinRoot(fullEntry)) throw new IOException("Release entry is outside the configured release root.");
            var attributes = File.GetAttributes(fullEntry);
            if ((attributes & FileAttributes.ReparsePoint) != 0)
                throw new IOException("Release entry became a reparse point; refusing to traverse or delete it.");

            if ((attributes & FileAttributes.Directory) != 0)
            {
                DeleteDirectoryContents(fullEntry, releaseRootPath);
                EnsureSafeDirectory(directory, mustBeDirectChild: isReleaseRoot);
                EnsureSafeDirectory(fullEntry, mustBeDirectChild: false);
                Directory.Delete(fullEntry, recursive: false);
            }
            else
            {
                EnsureSafeDirectory(directory, mustBeDirectChild: isReleaseRoot);
                attributes = File.GetAttributes(fullEntry);
                if ((attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0)
                    throw new IOException("Release file changed type or became a reparse point; refusing to delete it.");
                File.Delete(fullEntry);
            }
        }

        // The caller removes child directories only after this method has returned.
    }

    private static void EnsureReleaseDirectoryRemoved(string releasePath)
    {
        try
        {
            _ = File.GetAttributes(releasePath);
            throw new IOException("Delete operation returned while the release path still exists.");
        }
        catch (FileNotFoundException)
        {
            // Confirmed absent.
        }
        catch (DirectoryNotFoundException)
        {
            // Confirmed absent.
        }
    }

    private void EnsureSafeDirectory(string path, bool mustBeDirectChild)
    {
        if (!TryValidateRoot(out var rootError)) throw new IOException(rootError);
        var fullPath = Path.GetFullPath(path);
        if (!IsWithinRoot(fullPath)) throw new IOException("Release directory is outside the configured release root.");
        if (mustBeDirectChild && !Path.GetDirectoryName(fullPath)!.Equals(Root,
            OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
            throw new IOException("Release directory is not a direct child of the configured root.");
        var attributes = File.GetAttributes(fullPath);
        if ((attributes & FileAttributes.Directory) == 0 || (attributes & FileAttributes.ReparsePoint) != 0)
            throw new IOException("Release directory is not a plain directory; refusing to traverse or delete it.");
    }

    private string CaptureReleaseTreeState(string releasePath)
    {
        var entries = new List<string>();
        var pending = new Stack<string>();
        pending.Push(Path.GetFullPath(releasePath));
        while (pending.TryPop(out var directory))
        {
            EnsureSafeDirectory(directory, mustBeDirectChild: directory.Equals(releasePath,
                OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal));
            foreach (var entry in Directory.EnumerateFileSystemEntries(directory).ToArray())
            {
                var fullEntry = Path.GetFullPath(entry);
                if (!IsWithinRoot(fullEntry)) throw new IOException("Release entry is outside the configured release root.");
                var attributes = File.GetAttributes(fullEntry);
                if ((attributes & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("Release tree contains a reparse point; state cannot be safely inspected.");
                var relative = Path.GetRelativePath(releasePath, fullEntry);
                var modified = File.GetLastWriteTimeUtc(fullEntry).Ticks;
                if ((attributes & FileAttributes.Directory) != 0)
                {
                    entries.Add($"D|{relative}|{modified}");
                    pending.Push(fullEntry);
                }
                else
                {
                    entries.Add($"F|{relative}|{new FileInfo(fullEntry).Length}|{modified}");
                }
            }
        }
        entries.Sort(StringComparer.Ordinal);
        return string.Join("\n", entries);
    }

    private string DescribeDeletionOutcome(string releasePath, string? beforeDeleteState)
    {
        try
        {
            var attributes = File.GetAttributes(releasePath);
            if ((attributes & FileAttributes.ReparsePoint) != 0)
                return "The release path remains as a reparse point; its state is changed or unsafe, not preserved.";
            if ((attributes & FileAttributes.Directory) == 0)
                return "The release path remains but is no longer a directory; its state is changed, not preserved.";
            var afterDeleteState = CaptureReleaseTreeState(releasePath);
            if (beforeDeleteState is null)
                return "The release directory remains; its state could not be compared and may be partial.";
            return beforeDeleteState.Equals(afterDeleteState, StringComparison.Ordinal)
                ? "The release directory remains unchanged based on its filesystem inventory."
                : "The release directory remains but has changed; deletion may be partial.";
        }
        catch (Exception exception) when (exception is FileNotFoundException or DirectoryNotFoundException)
        {
            return "The release directory no longer exists; deletion may have completed despite the reported failure.";
        }
        catch (Exception exception) when (IsFilesystemException(exception))
        {
            return $"The release directory state could not be determined and may be partial: {exception.Message}";
        }
    }

    private bool PointerMatches(string expectedActiveReleaseId, out string? error)
    {
        try
        {
            var actual = ReadActiveReleaseId();
            if (actual is not null && TryParseWorkflowReleaseId(actual, out _) && actual.Equals(expectedActiveReleaseId, StringComparison.Ordinal))
            {
                error = null;
                return true;
            }
            error = actual is null
                ? $"{ActiveReleaseFileName} is missing; cleanup aborted."
                : $"{ActiveReleaseFileName} is invalid or does not match the committed active release; cleanup aborted.";
            return false;
        }
        catch (Exception exception) when (IsFilesystemException(exception) || exception is InvalidOperationException)
        {
            error = $"Could not read a valid {ActiveReleaseFileName}; cleanup aborted: {exception.Message}";
            return false;
        }
    }

    private bool TryValidateRoot(out string? error)
    {
        error = null;
        try
        {
            if (!Directory.Exists(Root))
            {
                error = "The configured release root is missing or inaccessible; cleanup aborted.";
                return false;
            }
            for (DirectoryInfo? current = new(Root); current is not null; current = current.Parent)
            {
                var attributes = File.GetAttributes(current.FullName);
                if ((attributes & FileAttributes.ReparsePoint) != 0)
                {
                    error = $"Release root or ancestor '{current.FullName}' is a reparse point; cleanup aborted.";
                    return false;
                }
                if ((attributes & FileAttributes.Directory) == 0)
                {
                    error = $"Release root or ancestor '{current.FullName}' is not a directory; cleanup aborted.";
                    return false;
                }
            }
            return true;
        }
        catch (Exception exception) when (IsFilesystemException(exception))
        {
            error = $"Could not verify the release root or its ancestors; cleanup aborted: {exception.Message}";
            return false;
        }
    }

    private bool TryValidateReleaseTree(string releasePath, out string? error)
    {
        error = null;
        try
        {
            var fullReleasePath = Path.GetFullPath(releasePath);
            var releaseParent = Path.GetDirectoryName(fullReleasePath);
            var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
            if (!IsWithinRoot(fullReleasePath) || releaseParent is null
                || !Path.GetFullPath(releaseParent).Equals(Root, comparison))
            {
                error = "Release path is not a direct child within the configured root; preserved.";
                return false;
            }
            var rootAttributes = File.GetAttributes(fullReleasePath);
            if ((rootAttributes & FileAttributes.Directory) == 0 || (rootAttributes & FileAttributes.ReparsePoint) != 0)
            {
                error = "Release directory is not a plain directory or is a reparse point; preserved.";
                return false;
            }

            var rootEntries = Directory.EnumerateFileSystemEntries(fullReleasePath).ToArray();
            if (rootEntries.Length != 2
                || !rootEntries.Any(path => Path.GetFileName(path).Equals("site.json", StringComparison.Ordinal))
                || !rootEntries.Any(path => Path.GetFileName(path).Equals("pages", StringComparison.Ordinal)))
            {
                error = "Release layout is incomplete or contains unexpected root entries; preserved.";
                return false;
            }
            var settingsPath = Path.Combine(fullReleasePath, "site.json");
            var settingsAttributes = File.GetAttributes(settingsPath);
            if ((settingsAttributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0)
            {
                error = "site.json is not a plain file; preserved.";
                return false;
            }
            var pagesPath = Path.Combine(fullReleasePath, "pages");
            if (!IsWithinRoot(pagesPath))
            {
                error = "Pages path is outside the configured release root; preserved.";
                return false;
            }
            var pagesAttributes = File.GetAttributes(pagesPath);
            if ((pagesAttributes & FileAttributes.Directory) == 0 || (pagesAttributes & FileAttributes.ReparsePoint) != 0)
            {
                error = "pages is not a plain directory; preserved.";
                return false;
            }

            var pendingDirectories = new Stack<string>();
            pendingDirectories.Push(pagesPath);
            while (pendingDirectories.TryPop(out var directory))
            {
                if (!IsWithinRoot(directory))
                {
                    error = "Release tree contains a path outside the configured root; preserved.";
                    return false;
                }
                var attributes = File.GetAttributes(directory);
                if ((attributes & FileAttributes.Directory) == 0 || (attributes & FileAttributes.ReparsePoint) != 0)
                {
                    error = "Release tree contains a non-directory or reparse-point directory; preserved.";
                    return false;
                }
                foreach (var entry in Directory.EnumerateFileSystemEntries(directory))
                {
                    if (!IsWithinRoot(entry))
                    {
                        error = "Release tree contains a path outside the configured root; preserved.";
                        return false;
                    }
                    var entryAttributes = File.GetAttributes(entry);
                    if ((entryAttributes & FileAttributes.ReparsePoint) != 0)
                    {
                        error = "Release tree contains a reparse point; preserved.";
                        return false;
                    }
                    if ((entryAttributes & FileAttributes.Directory) != 0) pendingDirectories.Push(entry);
                    else if (!Path.GetExtension(entry).Equals(".md", StringComparison.Ordinal))
                    {
                        error = "Release pages tree contains an unexpected non-Markdown file; preserved.";
                        return false;
                    }
                }
            }
            return true;
        }
        catch (Exception exception) when (IsFilesystemException(exception))
        {
            error = $"Release tree is unreadable or incomplete; preserved: {exception.Message}";
            return false;
        }
    }

    private bool IsWithinRoot(string path)
    {
        var fullPath = Path.GetFullPath(path);
        var rootPrefix = Root.EndsWith(Path.DirectorySeparatorChar) || Root.EndsWith(Path.AltDirectorySeparatorChar)
            ? Root
            : Root + Path.DirectorySeparatorChar;
        return fullPath.StartsWith(rootPrefix, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);
    }

    private static bool IsFilesystemException(Exception exception) => exception is IOException or UnauthorizedAccessException or SecurityException or ArgumentException or NotSupportedException;

    private sealed record EligibleRelease(string Id, DateTimeOffset Timestamp, string Path);
}

public sealed record ContentReleasePruneIssue(string ReleaseId, string Reason);

public sealed record ContentReleasePruneResult(
    bool Aborted,
    string? AbortReason,
    int EligibleReleaseCount,
    int EligibleInactiveReleaseCount,
    int RetainedInactiveReleaseCount,
    IReadOnlyList<string> DeletedReleaseIds,
    IReadOnlyList<ContentReleasePruneIssue> Issues)
{
    public static ContentReleasePruneResult Abort(string reason) => new(true, reason, 0, 0, 0, [], []);
}
