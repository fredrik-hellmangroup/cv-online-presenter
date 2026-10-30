using Portfolio.Content;

namespace Portfolio.Tests;

public sealed class ContentSectionClassifierTests
{
    [Fact]
    public void ClassifiesAstSectionsAndFallsBackToGeneric()
    {
        var document = new ContentDocument("cv", "CV", "CV", "sv-SE", "published", "page",
            new Dictionary<string, object>(), "# CV\nIntro\n## Erfarenhet\nRoll\n## Annat\nText", "cv.md");
        var sections = new ContentSectionClassifier().Classify(document);
        Assert.Equal(["generic", "experience", "generic"], sections.Select(section => section.Kind));
        Assert.Contains("Roll", sections[1].Markdown);
    }

    [Fact]
    public void MetadataCanOverrideClassification()
    {
        var document = new ContentDocument("cv", "CV", "CV", "sv-SE", "published", "page",
            new Dictionary<string, object> { ["sectionType"] = "skill" }, "## Annat\nText", "cv.md");
        Assert.Equal("skill", Assert.Single(new ContentSectionClassifier().Classify(document)).Kind);
    }
}
