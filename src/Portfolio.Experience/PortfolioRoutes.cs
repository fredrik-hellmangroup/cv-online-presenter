namespace Portfolio.Experience;

public static class PortfolioRoutes
{
    public static IReadOnlyDictionary<string, string> CorePages { get; } = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["/"] = "home",
        ["/profile"] = "profile",
        ["/services"] = "services",
        ["/contact"] = "contact",
        ["/projects"] = "projects",
        ["/cv"] = "cv"
    };
}
