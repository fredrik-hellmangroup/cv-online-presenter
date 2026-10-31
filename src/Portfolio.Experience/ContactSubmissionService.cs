using System.Net.Mail;
using Portfolio.Contracts;

namespace Portfolio.Experience;

public enum ContactOutcome { Sent, Invalid, CaptchaFailed }

public enum ContactField { Name, Email, Message }

public sealed record ContactSubmission(
    string? Name,
    string? Email,
    string? Message,
    string? Honeypot,
    string? CaptchaToken,
    string? RemoteIp);

public sealed record ContactResult(ContactOutcome Outcome, IReadOnlyList<ContactField> InvalidFields)
{
    public static ContactResult Of(ContactOutcome outcome) => new(outcome, []);
}

public sealed class ContactSubmissionService(ICaptchaVerifier captcha, IContactSender sender)
{
    public const int MaxNameLength = 100;
    public const int MaxEmailLength = 254;
    public const int MinMessageLength = 10;
    public const int MaxMessageLength = 5000;

    // Transport failures from the captcha verifier or sender propagate so the host can log them.
    public async Task<ContactResult> SubmitAsync(string recipient, ContactSubmission submission, CancellationToken cancellationToken)
    {
        // A filled honeypot is reported as success so bots get no signal to adapt to.
        if (!string.IsNullOrWhiteSpace(submission.Honeypot)) return ContactResult.Of(ContactOutcome.Sent);

        var name = Normalize(submission.Name);
        var email = submission.Email?.Trim() ?? string.Empty;
        var body = submission.Message?.Replace("\r\n", "\n").Trim() ?? string.Empty;

        var invalid = new List<ContactField>();
        if (name.Length == 0 || name.Length > MaxNameLength) invalid.Add(ContactField.Name);
        if (!IsValidEmail(email)) invalid.Add(ContactField.Email);
        if (body.Length < MinMessageLength || body.Length > MaxMessageLength) invalid.Add(ContactField.Message);
        if (invalid.Count > 0) return new ContactResult(ContactOutcome.Invalid, invalid);

        if (!await captcha.VerifyAsync(submission.CaptchaToken, submission.RemoteIp, cancellationToken))
            return ContactResult.Of(ContactOutcome.CaptchaFailed);

        await sender.SendAsync(new ContactMessage(recipient, name, email, body), cancellationToken);
        return ContactResult.Of(ContactOutcome.Sent);
    }

    // Control characters (including CR/LF) are replaced so the name is safe in a mail header.
    private static string Normalize(string? value) =>
        string.Concat((value ?? string.Empty).Select(character => char.IsControl(character) ? ' ' : character)).Trim();

    private static bool IsValidEmail(string value) =>
        value.Length is > 0 and <= MaxEmailLength
        && !value.Any(char.IsControl)
        && MailAddress.TryCreate(value, out var address)
        && address.Address == value;
}
