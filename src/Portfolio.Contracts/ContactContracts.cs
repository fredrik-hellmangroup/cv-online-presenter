namespace Portfolio.Contracts;

public sealed record ContactMessage(string Recipient, string Name, string Email, string Body);

public interface ICaptchaVerifier
{
    Task<bool> VerifyAsync(string? token, string? remoteIp, CancellationToken cancellationToken);
}

public interface IContactSender
{
    Task SendAsync(ContactMessage message, CancellationToken cancellationToken);
}
