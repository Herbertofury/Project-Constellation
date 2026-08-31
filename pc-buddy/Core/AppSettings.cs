using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Serialization;

namespace PCBuddy.Core;

public sealed class AppSettings
{
    public bool AllowDesktop { get; set; } = true;
    public bool AllowDocuments { get; set; } = true;
    public bool AllowDownloads { get; set; } = false;
    public bool AllowFileMutations { get; set; } = true;
    public bool AllowDeveloperCommands { get; set; } = true;
    public bool AllowProcessInspection { get; set; } = true;
    public bool AllowBrowserCompanion { get; set; } = true;
    public bool AllowIdentity { get; set; } = true;
    public bool AllowHostname { get; set; } = true;
    public bool AllowIpConfig { get; set; } = true;
    public bool AllowSystemInfo { get; set; } = false;
    public bool AutoStart { get; set; } = false;
    public bool EmergencyLocked { get; set; } = false;
    public int MaxReadBytes { get; set; } = 262_144;
    public int MaxWriteBytes { get; set; } = 2_097_152;
    public int MaxListEntries { get; set; } = 300;
    public int MaxCommandSeconds { get; set; } = 180;
    public List<string> CustomRoots { get; set; } = new();

    [JsonIgnore]
    public IEnumerable<string> AllowedRoots
    {
        get
        {
            if (AllowDesktop)
                yield return Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            if (AllowDocuments)
                yield return Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            if (AllowDownloads)
                yield return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");

            foreach (var root in CustomRoots.Where(root => !string.IsNullOrWhiteSpace(root)))
            {
                string? full = null;
                try { full = Path.GetFullPath(Environment.ExpandEnvironmentVariables(root)); } catch { }
                if (!string.IsNullOrWhiteSpace(full)) yield return full;
            }
        }
    }

    [JsonIgnore]
    public IEnumerable<string> AllowedCommandIds
    {
        get
        {
            if (AllowIdentity) yield return "identity";
            if (AllowHostname) yield return "hostname";
            if (AllowIpConfig) yield return "ipconfig";
            if (AllowSystemInfo) yield return "systeminfo";
        }
    }

    [JsonIgnore]
    public IReadOnlySet<string> AllowedDeveloperExecutables { get; } = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "git", "git.exe",
        "dotnet", "dotnet.exe",
        "npm", "npm.cmd",
        "npx", "npx.cmd",
        "pnpm", "pnpm.cmd",
        "yarn", "yarn.cmd",
        "cargo", "cargo.exe",
        "rustc", "rustc.exe",
        "gradle", "gradle.bat",
        "gradlew", "gradlew.bat",
        "mvn", "mvn.cmd",
        "mvnw", "mvnw.cmd",
        "java", "java.exe",
        "javac", "javac.exe"
    };
}
