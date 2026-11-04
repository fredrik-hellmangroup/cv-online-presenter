namespace Portfolio.Content;

/// <summary>Page-level heading helpers.</summary>
public static class PageHeading
{
    /// <summary>Initials of a name, for a compact brand mark ("Fredrik Hallerös" becomes "FH").</summary>
    public static string Monogram(string name)
    {
        var letters = name.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(part => char.IsLetter(part[0]))
            .Select(part => char.ToUpperInvariant(part[0]))
            .Take(3)
            .ToArray();
        return letters.Length == 0 ? name : new string(letters);
    }
}
