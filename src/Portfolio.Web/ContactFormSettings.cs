using Microsoft.Extensions.Options;
using Portfolio.Infrastructure;

namespace Portfolio.Web;

// The form is only offered when both the captcha and the mail delivery are configured.
public sealed class ContactFormSettings(IOptions<TurnstileOptions> turnstile, IOptions<SmtpOptions> smtp)
{
    public const string TurnstileOrigin = "https://challenges.cloudflare.com";

    public string? SiteKey => turnstile.Value.SiteKey;
    public bool IsEnabled => turnstile.Value.IsConfigured && smtp.Value.IsConfigured;
}

public sealed class ContactInput
{
    public string? Name { get; set; }
    public string? Email { get; set; }
    public string? Message { get; set; }
}
