using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;

namespace PCBuddy.Core;

public sealed record LegacyBuildGuardResult(
    IReadOnlyList<string> StoppedProcesses,
    IReadOnlyList<string> DisabledExecutables,
    IReadOnlyList<string> Warnings)
{
    public bool ChangedAnything => StoppedProcesses.Count > 0 || DisabledExecutables.Count > 0;
}

public static class LegacyBuildGuard
{
    private static readonly string[] LegacyProcessNames = { "PCBuddy", "PC Buddy" };
    private static readonly string[] LegacyExecutableNames = { "PC Buddy.exe", "PCBuddy.exe" };

    public static LegacyBuildGuardResult DisableLegacyBuilds()
    {
        var stopped = new List<string>();
        var disabled = new List<string>();
        var warnings = new List<string>();

        foreach (var processName in LegacyProcessNames)
        {
            Process[] processes;
            try { processes = Process.GetProcessesByName(processName); }
            catch (Exception ex)
            {
                warnings.Add($"Could not enumerate legacy process '{processName}': {ex.Message}");
                continue;
            }

            foreach (var process in processes.Where(p => p.Id != Environment.ProcessId))
            {
                try
                {
                    var label = $"{process.ProcessName} ({process.Id})";
                    try { process.CloseMainWindow(); } catch { }
                    if (!process.WaitForExit(1200)) process.Kill(entireProcessTree: true);
                    stopped.Add(label);
                }
                catch (Exception ex)
                {
                    warnings.Add($"Could not stop legacy PC Buddy process {process.Id}: {ex.Message}");
                }
                finally
                {
                    process.Dispose();
                }
            }
        }

        var baseDirectory = AppContext.BaseDirectory;
        foreach (var fileName in LegacyExecutableNames)
        {
            var path = Path.Combine(baseDirectory, fileName);
            if (!File.Exists(path)) continue;
            try
            {
                var disabledPath = path + ".legacy-disabled";
                if (File.Exists(disabledPath)) File.Delete(disabledPath);
                File.Move(path, disabledPath);
                disabled.Add(Path.GetFileName(disabledPath));
            }
            catch (Exception ex)
            {
                warnings.Add($"Could not disable stale executable '{fileName}': {ex.Message}");
            }
        }

        return new LegacyBuildGuardResult(stopped, disabled, warnings);
    }
}
