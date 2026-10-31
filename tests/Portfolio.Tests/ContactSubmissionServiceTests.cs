using Portfolio.Contracts;
using Portfolio.Experience;

namespace Portfolio.Tests;

public sealed class ContactSubmissionServiceTests
{
    private sealed class FakeCaptcha(bool result) : ICaptchaVerifier
    {
        public int Calls { get; private set; }
        public string? LastToken { get; private set; }

        public Task<bool> VerifyAsync(string? token, string? remoteIp, CancellationToken cancellationToken)
        {
            Calls++;
            LastToken = token;
            return Task.FromResult(result);
        }
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

    private static ContactSubmission Valid(string? honeypot = null, string? token = "token") =>
        new("Anna Andersson", "anna@example.com", "Hej, jag vill gärna prata om ett uppdrag.", honeypot, token, "203.0.113.5");

    [Fact]
    public async Task ValidSubmissionIsVerifiedAndSent()
    {
        var captcha = new FakeCaptcha(true);
        var sender = new FakeSender();
        var result = await new ContactSubmissionService(captcha, sender).SubmitAsync("owner@example.com", Valid(), default);

        Assert.Equal(ContactOutcome.Sent, result.Outcome);
        var message = Assert.Single(sender.Sent);
        Assert.Equal("owner@example.com", message.Recipient);
        Assert.Equal("anna@example.com", message.Email);
        Assert.Equal("token", captcha.LastToken);
    }

    [Fact]
    public async Task FailedCaptchaDoesNotSend()
    {
        var sender = new FakeSender();
        var result = await new ContactSubmissionService(new FakeCaptcha(false), sender).SubmitAsync("owner@example.com", Valid(), default);

        Assert.Equal(ContactOutcome.CaptchaFailed, result.Outcome);
        Assert.Empty(sender.Sent);
    }

    [Fact]
    public async Task FilledHoneypotPretendsSuccessWithoutVerifyingOrSending()
    {
        var captcha = new FakeCaptcha(true);
        var sender = new FakeSender();
        var result = await new ContactSubmissionService(captcha, sender).SubmitAsync("owner@example.com", Valid(honeypot: "http://spam.example"), default);

        Assert.Equal(ContactOutcome.Sent, result.Outcome);
        Assert.Equal(0, captcha.Calls);
        Assert.Empty(sender.Sent);
    }

    [Theory]
    [InlineData("", "anna@example.com", "Ett tillräckligt långt meddelande", ContactField.Name)]
    [InlineData("Anna", "inte-en-epost", "Ett tillräckligt långt meddelande", ContactField.Email)]
    [InlineData("Anna", "anna@example.com\r\nBcc: x@example.com", "Ett tillräckligt långt meddelande", ContactField.Email)]
    [InlineData("Anna", "anna@example.com", "kort", ContactField.Message)]
    public async Task InvalidFieldsAreReportedAndNothingIsVerifiedOrSent(string name, string email, string message, ContactField expected)
    {
        var captcha = new FakeCaptcha(true);
        var sender = new FakeSender();
        var submission = new ContactSubmission(name, email, message, null, "token", null);
        var result = await new ContactSubmissionService(captcha, sender).SubmitAsync("owner@example.com", submission, default);

        Assert.Equal(ContactOutcome.Invalid, result.Outcome);
        Assert.Contains(expected, result.InvalidFields);
        Assert.Equal(0, captcha.Calls);
        Assert.Empty(sender.Sent);
    }

    [Fact]
    public async Task OverlongMessageIsRejected()
    {
        var submission = Valid() with { Message = new string('x', ContactSubmissionService.MaxMessageLength + 1) };
        var result = await new ContactSubmissionService(new FakeCaptcha(true), new FakeSender()).SubmitAsync("owner@example.com", submission, default);

        Assert.Contains(ContactField.Message, result.InvalidFields);
    }

    [Fact]
    public async Task ControlCharactersInNameCannotInjectHeaders()
    {
        var sender = new FakeSender();
        var submission = Valid() with { Name = "Anna\r\nBcc: evil@example.com" };
        await new ContactSubmissionService(new FakeCaptcha(true), sender).SubmitAsync("owner@example.com", submission, default);

        var message = Assert.Single(sender.Sent);
        Assert.DoesNotContain('\r', message.Name);
        Assert.DoesNotContain('\n', message.Name);
    }
}
