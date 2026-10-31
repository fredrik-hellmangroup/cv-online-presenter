using System.Net;
using System.Net.Mail;
using System.Text;
using Portfolio.Contracts;

namespace Portfolio.Infrastructure;

public sealed class SmtpOptions
{
    public const string SectionName = "Contact:Smtp";
    public string? Host { get; set; }
    public int Port { get; set; } = 587;
    public bool EnableSsl { get; set; } = true;
    public string? UserName { get; set; }
    public string? Password { get; set; }
    public string? From { get; set; }
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(Host) && !string.IsNullOrWhiteSpace(From)
        && MailAddress.TryCreate(From, out _);
}

public sealed class SmtpContactSender(SmtpOptions options) : IContactSender
{
    public async Task SendAsync(ContactMessage message, CancellationToken cancellationToken)
    {
        using var mail = new MailMessage(new MailAddress(options.From!, "Kontaktformulär"), new MailAddress(message.Recipient))
        {
            Subject = $"Kontaktformulär: {message.Name}",
            Body = Compose(message),
            BodyEncoding = Encoding.UTF8,
            SubjectEncoding = Encoding.UTF8
        };
        mail.ReplyToList.Add(new MailAddress(message.Email, message.Name));

        using var client = new SmtpClient(options.Host!, options.Port) { EnableSsl = options.EnableSsl };
        if (!string.IsNullOrWhiteSpace(options.UserName))
            client.Credentials = new NetworkCredential(options.UserName, options.Password);
        await client.SendMailAsync(mail, cancellationToken);
    }

    private static string Compose(ContactMessage message) =>
        $"Från: {message.Name} <{message.Email}>\n\n{message.Body}\n";
}
