namespace Portfolio.Content;

internal static class ContentPathGuard
{
    public static void EnsureNoReparsePointsInExistingPath(string path, string description)
    {
        var fullPath = Path.GetFullPath(path);
        var pathRoot = Path.GetPathRoot(fullPath)
            ?? throw new InvalidOperationException($"Could not determine the root of {description} '{fullPath}'.");
        var current = pathRoot;
        var components = new[] { pathRoot }.Concat(fullPath[pathRoot.Length..].Split(
            [Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar],
            StringSplitOptions.RemoveEmptyEntries));

        foreach (var component in components)
        {
            current = component == pathRoot ? pathRoot : Path.Combine(current, component);
            FileAttributes attributes;
            try
            {
                attributes = File.GetAttributes(current);
            }
            catch (FileNotFoundException)
            {
                continue;
            }
            catch (DirectoryNotFoundException)
            {
                continue;
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or System.Security.SecurityException)
            {
                throw new InvalidOperationException($"Could not verify {description} path component '{current}'.", exception);
            }

            if ((attributes & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException($"The {description} path must not contain reparse points: '{current}'.");
        }
    }

    public static string CanonicalizeExistingPath(string path)
    {
        var fullPath = Path.GetFullPath(path);
        var current = Path.GetPathRoot(fullPath)
            ?? throw new InvalidOperationException($"Content path '{path}' is not rooted.");

        foreach (var segment in fullPath[Path.GetPathRoot(fullPath)!.Length..]
                     .Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar], StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, segment);
            var attributes = File.GetAttributes(current);
            if ((attributes & FileAttributes.ReparsePoint) != 0)
            {
                var info = (attributes & FileAttributes.Directory) != 0
                    ? (FileSystemInfo)new DirectoryInfo(current)
                    : new FileInfo(current);
                current = Path.GetFullPath(info.ResolveLinkTarget(returnFinalTarget: true)?.FullName
                    ?? throw new InvalidOperationException($"Could not resolve content reparse point '{current}'."));
            }
        }

        return Path.GetFullPath(current);
    }

    public static void EnsureOrdinaryDirectory(string path, string description)
    {
        EnsureNoReparsePointsInExistingPath(path, description);
        if (new DirectoryInfo(path).LinkTarget is not null)
            throw new InvalidOperationException($"The {description} '{path}' must not be a reparse point.");
        var attributes = File.GetAttributes(path);
        if ((attributes & FileAttributes.Directory) == 0)
            throw new InvalidOperationException($"The {description} '{path}' is not a directory.");
        if ((attributes & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException($"The {description} '{path}' must not be a reparse point.");
    }

    public static void EnsureOrdinaryFile(string path, string description)
    {
        EnsureNoReparsePointsInExistingPath(path, description);
        if (new FileInfo(path).LinkTarget is not null)
            throw new InvalidOperationException($"The {description} '{path}' must not be a reparse point.");
        var attributes = File.GetAttributes(path);
        if ((attributes & FileAttributes.Directory) != 0)
            throw new InvalidOperationException($"The {description} '{path}' is not a file.");
        if ((attributes & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException($"The {description} '{path}' must not be a reparse point.");
    }

    public static void EnsureWithinRoot(string trustedRoot, string candidate, string description)
    {
        var root = Path.GetFullPath(trustedRoot);
        var path = Path.GetFullPath(candidate);
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        var rootWithSeparator = root.EndsWith(Path.DirectorySeparatorChar) || root.EndsWith(Path.AltDirectorySeparatorChar)
            ? root
            : root + Path.DirectorySeparatorChar;
        if (!path.Equals(root, comparison) && !path.StartsWith(rootWithSeparator, comparison))
            throw new InvalidOperationException($"The {description} '{candidate}' resolves outside the trusted content root.");
    }
}
