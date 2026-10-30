namespace Portfolio.Infrastructure;

public sealed class SystemReleaseClock : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => DateTimeOffset.UtcNow;
}
