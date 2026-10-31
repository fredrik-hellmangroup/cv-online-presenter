using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Portfolio.Contracts;

namespace Portfolio.Infrastructure;

public sealed class TurnstileOptions
{
    public const string SectionName = "Contact:Turnstile";
    public string? SiteKey { get; set; }
    public string? SecretKey { get; set; }
    public bool IsConfigured => !string.IsNullOrWhiteSpace(SiteKey) && !string.IsNullOrWhiteSpace(SecretKey);
}

public sealed class TurnstileCaptchaVerifier(HttpClient client, TurnstileOptions options) : ICaptchaVerifier
{
    public const string VerifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

    public async Task<bool> VerifyAsync(string? token, string? remoteIp, CancellationToken cancellationToken)
    {
        if (!options.IsConfigured || string.IsNullOrWhiteSpace(token)) return false;

        var fields = new List<KeyValuePair<string, string>>
        {
            new("secret", options.SecretKey!),
            new("response", token)
        };
        if (!string.IsNullOrWhiteSpace(remoteIp)) fields.Add(new("remoteip", remoteIp));

        using var response = await client.PostAsync(VerifyUrl, new FormUrlEncodedContent(fields), cancellationToken);
        if (!response.IsSuccessStatusCode) return false;
        var result = await response.Content.ReadFromJsonAsync<SiteVerifyResponse>(cancellationToken);
        return result?.Success == true;
    }

    private sealed record SiteVerifyResponse([property: JsonPropertyName("success")] bool Success);
}
