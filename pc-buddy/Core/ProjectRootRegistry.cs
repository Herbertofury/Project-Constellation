using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace PCBuddy.Core;

public static class ProjectRootRegistry
{
    private static readonly object Gate = new();
    private static string[] _roots = Array.Empty<string>();

    public static void Replace(IEnumerable<string?> roots)
    {
        var normalized = roots
            .Where(root => !string.IsNullOrWhiteSpace(root))
            .Select(root => Normalize(root!))
            .Where(root => root is not null)
            .Cast<string>()
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        lock (Gate) _roots = normalized;
    }

    public static string[] Snapshot()
    {
        lock (Gate) return _roots.ToArray();
    }

    private static string? Normalize(string raw)
    {
        try { return Path.GetFullPath(Environment.ExpandEnvironmentVariables(raw.Trim())); }
        catch { return null; }
    }
}
