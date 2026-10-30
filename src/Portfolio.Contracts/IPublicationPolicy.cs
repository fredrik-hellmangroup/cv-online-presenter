namespace Portfolio.Contracts;

public interface IPublicationPolicy
{
    bool IsPublished(string status, string locale);
}
