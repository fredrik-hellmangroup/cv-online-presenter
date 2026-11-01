using System.Net;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Portfolio.Contracts;

namespace Portfolio.Tests;

[Collection(WebHostCollection.Name)]
public sealed class ContactFormRouteTests
{
    private sealed class FakeCaptcha(bool result) : ICaptchaVerifier
    {
        public Task<bool> VerifyAsync(string? token, string? remoteIp, CancellationToken cancellationToken) =>
            Task.FromResult(result && !string.IsNullOrEmpty(token));
    }

    private sealed class FakeSender : IContactSender
    {
        public List<ContactMessage> Sent { get; } = [];

        public Task SendAsync(ContactMessage message, CancellationToken cancellationToken)
        {
            Sent.Add(message);
            return Task.CompletedTask;
        }
    }

    private static WebApplicationFactory<Program> Factory(bool turnstile, bool smtp, FakeSender? sender = null, bool captchaResult = true) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            if (turnstile)
            {
                builder.UseSetting("Contact:Turnstile:SiteKey", "test-site-key");
                builder.UseSetting("Contact:Turnstile:SecretKey", "test-secret");
            }
            if (smtp)
            {
                builder.UseSetting("Contact:Smtp:Host", "smtp.example.com");
                builder.UseSetting("Contact:Smtp:From", "noreply@example.com");
            }
            builder.ConfigureTestServices(services =>
            {
                services.AddSingleton<ICaptchaVerifier>(new FakeCaptcha(captchaResult));
                services.AddSingleton<IContactSender>(sender ?? new FakeSender());
            });
        });

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task WithoutCompleteConfigurationTheMailtoCardIsShownInsteadOfTheForm(bool turnstile, bool smtp)
    {
        using var factory = Factory(turnstile, smtp);
        using var client = factory.CreateClient();
        var response = await client.GetAsync("/contact");
        var html = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("class=\"contact-card\"", html);
        Assert.Contains("href=\"mailto:demo@example.com?subject=Kaffe%20och%20en%20.NET-fr%C3%A5ga%3F&amp;body=", html);
        Assert.DoesNotContain("<form", html);
        Assert.DoesNotContain("challenges.cloudflare.com", html);
        var csp = response.Headers.GetValues("Content-Security-Policy").Single();
        Assert.DoesNotContain("challenges.cloudflare.com", csp);
    }

    [Fact]
    public async Task WithCompleteConfigurationTheFormAndTurnstileAreShownOnlyOnTheContactPage()
    {
        using var factory = Factory(true, true);
        using var client = factory.CreateClient();
        var response = await client.GetAsync("/contact");
        var html = await response.Content.ReadAsStringAsync();

        Assert.Contains("<form", html);
        Assert.Contains("data-sitekey=\"test-site-key\"", html);
        Assert.Contains("https://challenges.cloudflare.com/turnstile/v0/api.js", html);
        Assert.DoesNotContain("test-secret", html);
        Assert.Contains("__RequestVerificationToken", html);
        var csp = response.Headers.GetValues("Content-Security-Policy").Single();
        Assert.Contains("script-src 'self' https://challenges.cloudflare.com", csp);
        Assert.Contains("frame-src https://challenges.cloudflare.com", csp);

        var cv = await client.GetAsync("/cv");
        Assert.DoesNotContain("challenges.cloudflare.com", cv.Headers.GetValues("Content-Security-Policy").Single());
        Assert.DoesNotContain("<form", await cv.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ValidSubmissionSendsMailAndRedirectsToConfirmation()
    {
        var sender = new FakeSender();
        using var factory = Factory(true, true, sender);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var response = await client.PostAsync("/contact", await FormAsync(client,
            name: "Anna Andersson", email: "anna@example.com", message: "Hej, jag vill gärna prata om ett uppdrag.", token: "ok"));

        Assert.True(response.StatusCode is HttpStatusCode.Found or HttpStatusCode.SeeOther, response.StatusCode.ToString());
        Assert.Contains("sent=1", response.Headers.Location?.OriginalString);
        var message = Assert.Single(sender.Sent);
        Assert.Equal("demo@example.com", message.Recipient);
        Assert.Equal("anna@example.com", message.Email);

        var confirmation = await (await client.GetAsync("/contact?sent=1")).Content.ReadAsStringAsync();
        Assert.Contains("Ditt meddelande är skickat", confirmation);
        Assert.DoesNotContain("<form", confirmation);
    }

    [Fact]
    public async Task MissingCaptchaTokenDoesNotSend()
    {
        var sender = new FakeSender();
        using var factory = Factory(true, true, sender);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var response = await client.PostAsync("/contact", await FormAsync(client,
            name: "Anna", email: "anna@example.com", message: "Ett tillräckligt långt meddelande", token: null));
        var html = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("Verifieringen misslyckades", html);
        Assert.Contains("Anna", html);
        Assert.Empty(sender.Sent);
    }

    [Fact]
    public async Task InvalidInputShowsFieldErrorsAndKeepsValues()
    {
        var sender = new FakeSender();
        using var factory = Factory(true, true, sender);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var response = await client.PostAsync("/contact", await FormAsync(client,
            name: "Anna", email: "inte-en-epost", message: "Ett tillräckligt långt meddelande", token: "ok"));
        var html = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("id=\"contact-email-error\"", html);
        Assert.Contains("aria-invalid=\"true\"", html);
        Assert.Contains("inte-en-epost", html);
        Assert.Empty(sender.Sent);
    }

    [Fact]
    public async Task FilledHoneypotSendsNothing()
    {
        var sender = new FakeSender();
        using var factory = Factory(true, true, sender);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var response = await client.PostAsync("/contact", await FormAsync(client,
            name: "Bot", email: "bot@example.com", message: "Köp billiga klockor här nu", token: "ok", honeypot: "spam"));

        Assert.True(response.StatusCode is HttpStatusCode.Found or HttpStatusCode.SeeOther, response.StatusCode.ToString());
        Assert.Empty(sender.Sent);
    }

    [Fact]
    public async Task PostWithoutAntiforgeryTokenIsRejected()
    {
        var sender = new FakeSender();
        using var factory = Factory(true, true, sender);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var response = await client.PostAsync("/contact", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["_handler"] = "contact",
            ["cf-turnstile-response"] = "ok"
        }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(sender.Sent);
    }

    [Fact]
    public async Task SixthSubmissionWithinTheWindowIsRateLimited()
    {
        using var factory = Factory(true, true);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        HttpStatusCode last = default;
        for (var attempt = 0; attempt < 6; attempt++)
        {
            var response = await client.PostAsync("/contact", await FormAsync(client,
                name: "Anna", email: "anna@example.com", message: "Ett tillräckligt långt meddelande", token: "ok"));
            last = response.StatusCode;
        }

        Assert.Equal(HttpStatusCode.TooManyRequests, last);
    }

    private static async Task<FormUrlEncodedContent> FormAsync(HttpClient client, string name, string email, string message, string? token, string? honeypot = null)
    {
        var html = await client.GetStringAsync("/contact");
        var fields = new Dictionary<string, string>
        {
            ["__RequestVerificationToken"] = Value(html, "__RequestVerificationToken"),
            ["_handler"] = "contact",
            [FieldName(html, "contact-name")] = name,
            [FieldName(html, "contact-email")] = email,
            [FieldName(html, "contact-message")] = message,
            ["website"] = honeypot ?? string.Empty
        };
        if (token is not null) fields["cf-turnstile-response"] = token;
        return new FormUrlEncodedContent(fields);
    }

    private static string Value(string html, string name) =>
        WebUtility.HtmlDecode(Regex.Match(html, $"name=\"{name}\"[^>]*value=\"([^\"]*)\"").Groups[1].Value);

    private static string FieldName(string html, string id) =>
        Regex.Match(html, $"<(?:input|textarea)[^>]*id=\"{id}\"[^>]*>").Value is { Length: > 0 } tag
            ? Regex.Match(tag, "name=\"([^\"]+)\"").Groups[1].Value
            : throw new InvalidOperationException($"Field {id} not found");
}
