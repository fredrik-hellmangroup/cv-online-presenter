using Portfolio.Content;

if (args.Length != 2 || args[0] != "--content" || string.IsNullOrWhiteSpace(args[1]))
{
    Console.Error.WriteLine("Usage: dotnet run --project tools/Portfolio.Content.Validator -- --content <directory>");
    return 2;
}

var contentRoot = Path.GetFullPath(args[1]);
var configPath = Path.Combine(contentRoot, "..", "site.json");
if (!File.Exists(configPath))
{
    Console.Error.WriteLine($"Content configuration is missing: {configPath}");
    return 2;
}

try
{
    using var config = System.Text.Json.JsonDocument.Parse(await File.ReadAllTextAsync(configPath));
    var locales = config.RootElement.GetProperty("supportedLocales")
        .EnumerateArray().Select(item => item.GetString() ?? "")
        .Where(locale => locale.Length > 0).ToHashSet(StringComparer.OrdinalIgnoreCase);

    var service = new MarkdownContentService();
    var documents = await service.LoadDirectoryAsync(contentRoot);
    var errors = service.Validate(documents, locales);
    if (errors.Count > 0)
    {
        foreach (var error in errors) Console.Error.WriteLine($"{error.File}: {error.Message}");
        return 1;
    }

    Console.WriteLine($"Validated {documents.Count} Markdown document(s); {documents.Count(document => document.Status == "published")} published.");
    return 0;
}
catch (ContentValidationException exception)
{
    Console.Error.WriteLine(exception.Message);
    return 1;
}
catch (Exception exception) when (exception is IOException or System.Text.Json.JsonException or KeyNotFoundException)
{
    Console.Error.WriteLine($"Content validation could not run: {exception.Message}");
    return 2;
}
