namespace Portfolio.Content;

public enum GitRowKind
{
    Head,
    Merge,
    Branch
}

/// <param name="Lane">Lane of the commit dot; lane 0 is the trunk.</param>
/// <param name="ThroughLanes">Lanes (other than the dot's own lane) whose line passes through the whole row.</param>
public sealed record GitGraphRow(GitRowKind Kind, int Year, int AssignmentIndex, int Lane, IReadOnlyList<int> ThroughLanes);

public sealed record GitGraph(IReadOnlyList<GitGraphRow> Rows, int LaneCount);

/// <summary>
/// Lays assignments out like <c>git log --graph</c>: every assignment is a branch that is merged
/// into the trunk when it ends and branched off when it starts. Newest events come first, and
/// ongoing assignments run from the HEAD row downwards.
/// </summary>
public static class GitGraphLayout
{
    public static GitGraph Build(IReadOnlyList<CvAssignment> assignments)
    {
        var laneOf = new int[assignments.Count];
        var occupied = new HashSet<int>();
        var rows = new List<GitGraphRow>();
        var maxLane = 0;

        int Allocate()
        {
            var lane = 1;
            while (occupied.Contains(lane)) lane++;
            occupied.Add(lane);
            maxLane = Math.Max(maxLane, lane);
            return lane;
        }

        for (var index = 0; index < assignments.Count; index++)
            if (assignments[index].Ongoing) laneOf[index] = Allocate();
        rows.Add(new GitGraphRow(GitRowKind.Head, 0, -1, 0, occupied.Order().ToArray()));

        var events = new List<(int Year, GitRowKind Kind, int Index)>();
        for (var index = 0; index < assignments.Count; index++)
        {
            var assignment = assignments[index];
            if (!assignment.Ongoing) events.Add((assignment.EndYear ?? assignment.StartYear, GitRowKind.Merge, index));
            events.Add((assignment.StartYear, GitRowKind.Branch, index));
        }

        var ordered = events
            .OrderByDescending(item => item.Year)
            .ThenBy(item => item.Kind == GitRowKind.Merge ? 0 : 1)
            .ThenBy(item => item.Index);

        foreach (var (year, kind, index) in ordered)
        {
            if (kind == GitRowKind.Merge)
            {
                var through = occupied.Order().ToArray();
                laneOf[index] = Allocate();
                rows.Add(new GitGraphRow(kind, year, index, laneOf[index], through));
            }
            else
            {
                var lane = laneOf[index];
                var through = occupied.Where(other => other != lane).Order().ToArray();
                rows.Add(new GitGraphRow(kind, year, index, lane, through));
                occupied.Remove(lane);
            }
        }
        return new GitGraph(rows, maxLane + 1);
    }
}
