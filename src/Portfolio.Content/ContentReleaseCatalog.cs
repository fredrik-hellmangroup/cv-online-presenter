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

    public ContentReleaseCatalog(string releasesRoot)
    {
        if (string.IsNullOrWhiteSpace(releasesRoot)) throw new ArgumentException("A releases root is required.", nameof(releasesRoot));
        Root = Path.GetFullPath(releasesRoot);
    }

    public string Root { get; }

    public static bool IsValidReleaseId(string? releaseId) => !string.IsNullOrEmpty(releaseId)
        && releaseId.Length <= 100
        && releaseId.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_');

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
}
