namespace Portfolio.Publishing;

public sealed class PublicationPolicy(IReadOnlySet<string> supportedLocales) : Portfolio.Contracts.IPublicationPolicy
{
    public bool IsPublished(string status, string locale) =>
        status.Equals("published", StringComparison.OrdinalIgnoreCase) && supportedLocales.Contains(locale);
}
