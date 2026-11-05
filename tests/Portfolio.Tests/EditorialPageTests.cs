using System.Net;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Portfolio.Web;

namespace Portfolio.Tests;

[Collection(WebHostCollection.Name)]
public sealed class EditorialPageTests : IClassFixture<EditorialWebFactory>
{
    private readonly EditorialWebFactory factory;
    private readonly HttpClient client;

    public EditorialPageTests(EditorialWebFactory factory)
    {
        this.factory = factory;
        client = factory.CreateClient();
    }

    [Fact]
    public async Task Every_published_page_route_has_one_h1_and_a_coherent_heading_hierarchy()
    {
        var content = factory.Services.GetRequiredService<SiteContent>();
        var routes = SiteContent.CoreRoutes.Keys
            .Concat(content.PublishedProjects.Select(project => $"/{project.Slug}"))
            .Distinct(StringComparer.OrdinalIgnoreCase);

        foreach (var route in routes)
        {
            var response = await client.GetAsync(route);
            var html = await response.Content.ReadAsStringAsync();
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var headings = Regex.Matches(html, "<h([1-6])(?:\\s[^>]*)?>", RegexOptions.IgnoreCase)
                .Select(match => int.Parse(match.Groups[1].Value))
                .ToArray();
            Assert.Equal(1, headings.Count(level => level == 1));
            Assert.All(headings.Skip(1).Zip(headings), pair => Assert.InRange(pair.First - pair.Second, -5, 1));
        }
    }

    [Fact]
    public async Task Home_services_and_projects_render_editorial_blocks_and_project_cards()
    {
        var home = await GetHtml("/");
        var homeHeading = Assert.Single(Regex.Matches(home, "<h1(?:\\s[^>]*)?>.*?</h1>", RegexOptions.IgnoreCase | RegexOptions.Singleline));
        Assert.DoesNotContain("class=\"h1-name\"", homeHeading.Value);
        Assert.DoesNotContain("class=\"h1-tagline\"", homeHeading.Value);
        Assert.False(Regex.IsMatch(home, "<h[2-6]\\b[^>]*>\\s*Roller\\s*</h[2-6]>", RegexOptions.IgnoreCase));
        Assert.False(Regex.IsMatch(home, "<h[2-6]\\b[^>]*>\\s*\\u00D6versikt\\s*</h[2-6]>", RegexOptions.IgnoreCase));

        var services = await GetHtml("/services");
        Assert.Contains("class=\"service-cv-cta\"", services);
        Assert.Contains("href=\"/cv\"", services);

        var projects = await GetHtml("/projects");
        var expectedProjects = factory.Services.GetRequiredService<SiteContent>().PublishedProjects.ToArray();
        Assert.NotEmpty(expectedProjects);
        Assert.Equal(expectedProjects.Length, Regex.Matches(projects, "class=\"project-card\"").Count);
        Assert.Contains("project-card-description", projects);
        Assert.Contains("/projects/", projects);
    }

    [Fact]
    public async Task Project_detail_exposes_summary_responsibilities_results_and_technologies_as_sections()
    {
        var projects = factory.Services.GetRequiredService<SiteContent>().PublishedProjects.ToArray();
        Assert.NotEmpty(projects);
        foreach (var project in projects)
        {
            var html = await GetHtml($"/{project.Slug}");
            // The summary is the lead under the heading; a separate summary card appears only when the intro says something else.
            var intro = System.Net.WebUtility.HtmlDecode(Regex.Match(html, "<div class=\"project-intro\">.*?</div>", RegexOptions.Singleline).Value);
            var summary = project.Metadata["summary"].ToString()!;
            Assert.True(
                intro.Contains(summary, StringComparison.Ordinal) || Regex.Matches(html, "class=\"project-summary\"").Count == 1,
                $"The summary of {project.Slug} should be shown once.");
            Assert.Contains("class=\"project-responsibilities\"", html);
            Assert.Contains("class=\"project-results\"", html);
            Assert.Single(Regex.Matches(html, "class=\"project-technologies\""));
            Assert.DoesNotContain("\\" + Environment.NewLine, html);
        }
    }

    private async Task<string> GetHtml(string path)
    {
        var response = await client.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadAsStringAsync();
    }
}

public sealed class EditorialWebFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
    {
        var pagesRoot = Environment.GetEnvironmentVariable("EDITORIAL_CONTENT_PAGES");
        if (string.IsNullOrWhiteSpace(pagesRoot)) return;

        builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(
            new Dictionary<string, string?> { ["Content:PagesRoot"] = Path.GetFullPath(pagesRoot) }));
    }
}
