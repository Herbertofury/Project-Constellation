using Microsoft.Win32.SafeHandles;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace PCBuddy.Core;

public sealed class ToolBroker
{
    private readonly Func<AppSettings> _settings;
    private readonly Action<string, string, bool> _activity;
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = false };

    public ToolBroker(Func<AppSettings> settings, Action<string, string, bool> activity)
    {
        _settings = settings;
        _activity = activity;
    }

    public List<Dictionary<string, object?>> GetToolDefinitions()
    {
        var tools = new List<Dictionary<string, object?>>
        {
            Function("pc_status", "Read PC Buddy health, Windows identity, allowed folders, and enabled local capabilities.",
                Schema(new Dictionary<string, object?>(), Array.Empty<string>())),
            Function("fs_stat", "Read metadata for one existing file or folder inside an allowed root.",
                Schema(new Dictionary<string, object?> { ["path"] = new { type = "string" } }, ["path"])),
            Function("fs_list", "List an allowed directory. Read-only.",
                Schema(new Dictionary<string, object?> { ["path"] = new { type = "string" }, ["limit"] = new { type = "integer", minimum = 1, maximum = 300 } }, ["path", "limit"])),
            Function("fs_read_text", "Read a bounded UTF-8 prefix from a text file inside an allowed root. Read-only.",
                Schema(new Dictionary<string, object?> { ["path"] = new { type = "string" }, ["max_bytes"] = new { type = "integer", minimum = 1, maximum = 262144 } }, ["path", "max_bytes"])),
            Function("pc_run_allowed", "Run one explicitly enabled safe diagnostic command by ID. Arbitrary command lines are not accepted.",
                Schema(new Dictionary<string, object?> { ["id"] = new { type = "string", @enum = new[] { "identity", "hostname", "ipconfig", "systeminfo" } } }, ["id"]))
        };

        if (_settings().AllowProcessInspection)
        {
            tools.Add(Function("pc_windows", "List visible top-level application window titles and process names.",
                Schema(new Dictionary<string, object?>(), Array.Empty<string>())));
            tools.Add(Function("pc_processes", "List a bounded summary of running processes for diagnosis.",
                Schema(new Dictionary<string, object?> { ["limit"] = new { type = "integer", minimum = 1, maximum = 100 } }, ["limit"])));
        }
        return tools;
    }

    public async Task<string> ExecuteAsync(string name, JsonElement args, CancellationToken cancellationToken)
    {
        var settings = _settings();
        if (settings.EmergencyLocked)
            return Failure(name, "PC Buddy emergency lock is active; local tools are disabled.", "PC_BUDDY_LOCKED");

        try
        {
            object result = name switch
            {
                "pc_status" => Status(settings),
                "fs_stat" => Stat(RequireString(args, "path"), settings),
                "fs_list" => ListDirectory(RequireString(args, "path"), RequireInt(args, "limit"), settings),
                "fs_read_text" => await ReadTextAsync(RequireString(args, "path"), RequireInt(args, "max_bytes"), settings, cancellationToken),
                "pc_run_allowed" => await RunAllowedAsync(RequireString(args, "id"), settings, cancellationToken),
                "pc_windows" when settings.AllowProcessInspection => VisibleWindows(),
                "pc_processes" when settings.AllowProcessInspection => Processes(RequireInt(args, "limit")),
                _ => throw new InvalidOperationException($"Tool is unavailable: {name}")
            };
            var output = JsonSerializer.Serialize(new { ok = true, tool = name, result }, Json);
            _activity(name, "completed", true);
            return output;
        }
        catch (Exception ex)
        {
            _activity(name, ex.Message, false);
            return Failure(name, ex.Message, ex is UnauthorizedAccessException ? "ACCESS_DENIED" : "TOOL_ERROR");
        }
    }

    private static Dictionary<string, object?> Function(string name, string description, Dictionary<string, object?> parameters) => new()
    {
        ["type"] = "function",
        ["name"] = name,
        ["description"] = description,
        ["parameters"] = parameters,
        ["strict"] = true
    };

    private static Dictionary<string, object?> Schema(Dictionary<string, object?> properties, string[] required) => new()
    {
        ["type"] = "object",
        ["properties"] = properties,
        ["required"] = required,
        ["additionalProperties"] = false
    };

    private static string RequireString(JsonElement args, string name)
    {
        if (!args.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(value.GetString()))
            throw new ArgumentException($"Missing or invalid {name}.");
        return value.GetString()!;
    }

    private static int RequireInt(JsonElement args, string name)
    {
        if (!args.TryGetProperty(name, out var value) || !value.TryGetInt32(out var number))
            throw new ArgumentException($"Missing or invalid {name}.");
        return number;
    }

    private static object Status(AppSettings s) => new
    {
        app = "PC Buddy Portable",
        version = "0.2.0-alpha",
        machine = Environment.MachineName,
        user = Environment.UserName,
        os = Environment.OSVersion.VersionString,
        locked = s.EmergencyLocked,
        roots = s.AllowedRoots.ToArray(),
        commands = s.AllowedCommandIds.ToArray(),
        processInspection = s.AllowProcessInspection
    };

    private static object Stat(string input, AppSettings settings)
    {
        var path = RequireAllowedExistingPath(input, settings);
        if (Directory.Exists(path))
        {
            var d = new DirectoryInfo(path);
            return new { path, type = "directory", modified = d.LastWriteTimeUtc };
        }
        var f = new FileInfo(path);
        return new { path, type = "file", bytes = f.Length, modified = f.LastWriteTimeUtc };
    }

    private static object ListDirectory(string input, int requestedLimit, AppSettings settings)
    {
        var path = RequireAllowedExistingPath(input, settings);
        if (!Directory.Exists(path)) throw new IOException("Path is not a directory.");
        var limit = Math.Clamp(requestedLimit, 1, Math.Min(settings.MaxListEntries, 300));
        var all = new DirectoryInfo(path).EnumerateFileSystemInfos().Take(limit + 1).ToArray();
        var entries = all.Take(limit).Select(x => new
        {
            name = x.Name,
            type = x is DirectoryInfo ? "directory" : "file",
            bytes = x is FileInfo file ? file.Length : (long?)null,
            modified = x.LastWriteTimeUtc
        }).ToArray();
        return new { path, entries, truncated = all.Length > limit };
    }

    private static async Task<object> ReadTextAsync(string input, int requestedMax, AppSettings settings, CancellationToken ct)
    {
        var path = RequireAllowedExistingPath(input, settings);
        if (!File.Exists(path)) throw new IOException("Path is not a file.");
        var max = Math.Clamp(requestedMax, 1, Math.Min(settings.MaxReadBytes, 262_144));
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 16_384, useAsync: true);
        var buffer = new byte[Math.Min(max, (int)Math.Min(stream.Length, int.MaxValue))];
        var read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), ct);
        return new { path, bytesRead = read, truncated = stream.Length > read, text = Encoding.UTF8.GetString(buffer, 0, read) };
    }

    private static object VisibleWindows()
    {
        var rows = new List<object>();
        foreach (var p in Process.GetProcesses())
        {
            try
            {
                if (!string.IsNullOrWhiteSpace(p.MainWindowTitle))
                    rows.Add(new { pid = p.Id, process = p.ProcessName, title = p.MainWindowTitle });
            }
            catch { }
            finally { p.Dispose(); }
        }
        return rows.OrderBy(x => JsonSerializer.Serialize(x)).Take(100).ToArray();
    }

    private static object Processes(int requestedLimit)
    {
        var limit = Math.Clamp(requestedLimit, 1, 100);
        var rows = new List<(int pid, string name, long workingSet)>();
        foreach (var p in Process.GetProcesses())
        {
            try { rows.Add((p.Id, p.ProcessName, p.WorkingSet64)); }
            catch { }
            finally { p.Dispose(); }
        }
        return rows.OrderByDescending(x => x.workingSet).Take(limit)
            .Select(x => new { x.pid, x.name, workingSetBytes = x.workingSet }).ToArray();
    }

    private static async Task<object> RunAllowedAsync(string id, AppSettings settings, CancellationToken ct)
    {
        if (!settings.AllowedCommandIds.Contains(id, StringComparer.OrdinalIgnoreCase))
            throw new UnauthorizedAccessException($"Command ID is not enabled: {id}");

        var spec = id.ToLowerInvariant() switch
        {
            "identity" => ("whoami.exe", Array.Empty<string>()),
            "hostname" => ("hostname.exe", Array.Empty<string>()),
            "ipconfig" => ("ipconfig.exe", new[] { "/all" }),
            "systeminfo" => ("systeminfo.exe", Array.Empty<string>()),
            _ => throw new UnauthorizedAccessException($"Unknown command ID: {id}")
        };

        var psi = new ProcessStartInfo(spec.Item1)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        foreach (var arg in spec.Item2) psi.ArgumentList.Add(arg);
        using var process = Process.Start(psi) ?? throw new InvalidOperationException("Could not start diagnostic command.");
        var stdoutTask = process.StandardOutput.ReadToEndAsync(ct);
        var stderrTask = process.StandardError.ReadToEndAsync(ct);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(id.Equals("systeminfo", StringComparison.OrdinalIgnoreCase) ? 45 : 20));
        try
        {
            await process.WaitForExitAsync(timeout.Token);
            var stdout = await stdoutTask;
            var stderr = await stderrTask;
            return new { id, exitCode = process.ExitCode, stdout = Truncate(stdout, 1_000_000), stderr = Truncate(stderr, 200_000) };
        }
        catch
        {
            try { process.Kill(entireProcessTree: true); } catch { }
            throw;
        }
    }

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max] + "\n[truncated]";

    private static string Failure(string tool, string message, string code) =>
        JsonSerializer.Serialize(new { ok = false, tool, error = new { code, message } }, Json);

    private static string RequireAllowedExistingPath(string input, AppSettings settings)
    {
        if (string.IsNullOrWhiteSpace(input)) throw new ArgumentException("Path is empty.");
        var candidate = Path.GetFullPath(Environment.ExpandEnvironmentVariables(input));
        if (!File.Exists(candidate) && !Directory.Exists(candidate)) throw new FileNotFoundException("Path does not exist.", candidate);
        var realCandidate = ResolveFinalPath(candidate);
        foreach (var configuredRoot in settings.AllowedRoots.Where(x => !string.IsNullOrWhiteSpace(x)))
        {
            var root = Path.GetFullPath(configuredRoot);
            if (!Directory.Exists(root)) continue;
            var realRoot = ResolveFinalPath(root);
            var relative = Path.GetRelativePath(realRoot, realCandidate);
            if (relative == "." || (!relative.StartsWith(".." + Path.DirectorySeparatorChar) && relative != ".." && !Path.IsPathRooted(relative)))
                return realCandidate;
        }
        throw new UnauthorizedAccessException("Path is outside the folders enabled in PC Buddy > Access.");
    }

    private static string ResolveFinalPath(string path)
    {
        using SafeFileHandle handle = CreateFile(path, 0, FileShare.ReadWrite | FileShare.Delete, IntPtr.Zero,
            FileMode.Open, 0x02000000, IntPtr.Zero);
        if (handle.IsInvalid) throw new IOException($"Could not resolve path: {path} (Win32 {Marshal.GetLastWin32Error()})");
        var sb = new StringBuilder(4096);
        var length = GetFinalPathNameByHandle(handle, sb, (uint)sb.Capacity, 0);
        if (length == 0 || length >= (uint)sb.Capacity) throw new IOException("Could not resolve the final Windows path.");
        var final = sb.ToString();
        if (final.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) return @"\\" + final[8..];
        if (final.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase)) return final[4..];
        return final;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string lpFileName, uint dwDesiredAccess, FileShare dwShareMode,
        IntPtr lpSecurityAttributes, FileMode dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle hFile, StringBuilder lpszFilePath, uint cchFilePath, uint dwFlags);
}
