using Microsoft.Win32;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace PCBuddy.Core;

public sealed class PortableStore
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public string DataDirectory { get; }
    public string SettingsPath => Path.Combine(DataDirectory, "settings.json");
    public string ActivityPath => Path.Combine(DataDirectory, "activity.jsonl");
    public bool IsPortable { get; }

    public PortableStore()
    {
        var besideExe = Path.Combine(AppContext.BaseDirectory, "data");
        try
        {
            Directory.CreateDirectory(besideExe);
            var probe = Path.Combine(besideExe, ".write-test");
            File.WriteAllText(probe, "ok");
            File.Delete(probe);
            DataDirectory = besideExe;
            IsPortable = true;
        }
        catch
        {
            DataDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "PCBuddyPortable", "data");
            Directory.CreateDirectory(DataDirectory);
            IsPortable = false;
        }
    }

    public AppSettings LoadSettings()
    {
        try
        {
            if (File.Exists(SettingsPath))
                return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(SettingsPath)) ?? new AppSettings();
        }
        catch { }
        return new AppSettings();
    }

    public void SaveSettings(AppSettings settings)
    {
        Directory.CreateDirectory(DataDirectory);
        var temp = SettingsPath + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(settings, JsonOptions), Encoding.UTF8);
        File.Move(temp, SettingsPath, true);
    }

    public void AppendActivity(object entry)
    {
        try
        {
            Directory.CreateDirectory(DataDirectory);
            File.AppendAllText(ActivityPath, JsonSerializer.Serialize(entry) + Environment.NewLine, Encoding.UTF8);
        }
        catch { }
    }

    public void OpenDataFolder()
    {
        Directory.CreateDirectory(DataDirectory);
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{DataDirectory}\"") { UseShellExecute = true });
    }

    public void SetAutoStart(bool enabled)
    {
        using var runKey = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", writable: true)
                          ?? Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
        if (enabled)
            runKey.SetValue("PC Buddy", $"\"{Environment.ProcessPath}\"");
        else
            runKey.DeleteValue("PC Buddy", throwOnMissingValue: false);
    }
}
