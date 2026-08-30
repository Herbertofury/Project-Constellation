using System.Text.Json.Serialization;

namespace PCBuddy.Core;

public sealed class AppSettings
{
    public string Model { get; set; } = "gpt-5.6-sol";
    public string ReasoningEffort { get; set; } = "medium";
    public bool WebSearchEnabled { get; set; } = true;
    public bool AllowDesktop { get; set; } = true;
    public bool AllowDocuments { get; set; } = true;
    public bool AllowDownloads { get; set; } = false;
    public bool AllowProcessInspection { get; set; } = true;
    public bool AllowIdentity { get; set; } = true;
    public bool AllowHostname { get; set; } = true;
    public bool AllowIpConfig { get; set; } = true;
    public bool AllowSystemInfo { get; set; } = false;
    public bool AutoStart { get; set; } = false;
    public bool EmergencyLocked { get; set; } = false;
    public int MaxReadBytes { get; set; } = 262_144;
    public int MaxListEntries { get; set; } = 300;
    public string? LastResponseId { get; set; }

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
}
