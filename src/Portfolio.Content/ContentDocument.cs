namespace Portfolio.Content;

public sealed record ContentDocument(
    string Slug,
    string Title,
    string Description,
    string Locale,
    string Status,
    string Type,
    IReadOnlyDictionary<string, object> Metadata,
    string Markdown,
    string SourcePath);

public sealed record ContentValidationError(string File, string Message);

public sealed class ContentValidationException(IReadOnlyList<ContentValidationError> errors)
    : Exception(string.Join(Environment.NewLine, errors.Select(error => $"{error.File}: {error.Message}")))
{
    public IReadOnlyList<ContentValidationError> Errors { get; } = errors;
}
