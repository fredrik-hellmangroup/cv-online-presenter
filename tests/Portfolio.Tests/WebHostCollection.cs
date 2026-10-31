namespace Portfolio.Tests;

// The telemetry test listens process-wide, so every test that hosts the web app must run serially with it.
[CollectionDefinition(Name)]
public sealed class WebHostCollection
{
    public const string Name = "Web host";
}
