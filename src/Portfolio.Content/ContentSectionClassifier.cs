using System.Text;
using Markdig;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace Portfolio.Content;

public sealed record ClassifiedSection(string Kind, string Heading, string Markdown);

public sealed class ContentSectionClassifier
{
    public IReadOnlyList<ClassifiedSection> Classify(ContentDocument document)
    {
        var syntax = Markdown.Parse(document.Markdown);
        var headings = syntax.OfType<HeadingBlock>().Where(heading => heading.Level == 2).ToArray();
        var sections = new List<ClassifiedSection>();
        var start = 0;
        var previousHeading = string.Empty;
        for (var index = 0; index < headings.Length; index++)
        {
            var heading = headings[index];
            if (heading.Span.Start > start)
                AddSection(previousHeading, document.Markdown[start..heading.Span.Start]);
            previousHeading = ExtractText(heading.Inline);
            start = heading.Span.Start;
        }
        if (start < document.Markdown.Length)
            AddSection(previousHeading, document.Markdown[start..]);
        return sections;

        void AddSection(string heading, string markdown)
        {
            if (string.IsNullOrWhiteSpace(markdown)) return;
            var explicitKind = document.Metadata.TryGetValue("sectionType", out var value) ? value?.ToString() : null;
            var kind = string.IsNullOrWhiteSpace(explicitKind) ? InferKind(heading) : explicitKind.Trim().ToLowerInvariant();
            sections.Add(new(kind, heading, markdown.Trim()));
        }
    }

    private static string InferKind(string heading)
    {
        var normalized = heading.Trim().ToLowerInvariant();
        if (normalized.Contains("erfarenhet") || normalized.Contains("experience")) return "experience";
        if (normalized.Contains("projekt") || normalized.Contains("project")) return "project";
        if (normalized.Contains("kompetens") || normalized.Contains("skill")) return "skill";
        if (normalized.Contains("utbildning") || normalized.Contains("education")) return "education";
        if (normalized.Contains("profil") || normalized.Contains("profile")) return "profile";
        return "generic";
    }

    private static string ExtractText(ContainerInline? inline)
    {
        var result = new StringBuilder();
        if (inline is null) return string.Empty;
        AppendChildren(inline);
        return result.ToString().Trim();

        void AppendChildren(ContainerInline container)
        {
            for (var child = container.FirstChild; child is not null; child = child.NextSibling)
            {
                if (child is LiteralInline literal) result.Append(literal.Content.ToString());
                else if (child is CodeInline code) result.Append(code.Content);
                else if (child is ContainerInline nested) AppendChildren(nested);
            }
        }
    }
}
