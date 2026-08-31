using Microsoft.Win32.SafeHandles;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace PCBuddy.Core;

public sealed class ToolBroker
{
    private readonly Func<AppSettings> _settings;
    private readonly Action<string, string, bool> _activity;
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = false };
    private static readonly UTF8Encoding Utf8NoBom = new(false);

    public ToolBroker(Func<AppSettings> settings, Action<string, string, bool> activity)
    {
        _settings = settings;
        _activity = activity;
    }

    public List<Dictionary<string, object?>> GetToolDefinitions()
    {
        var tools = new List<Dictionary<string, object?>>
        {
            Function("pc_status", "Read Project Constellation health, Windows identity, allowed workspaces, and enabled local capabilities.",
                Schema(new Dictionary<string, object?>(), Array.Empty<string>())),
            Function("fs_stat", "Read metadata for one existing file or folder inside an allowed workspace.",
                Schema(new Dictionary<string, object?> { ["path"] = new { type = "string" } }, ["path"])),
            Function("fs_list", "List an allowed directory.",
                Schema(new Dictionary<string, object?> { ["path"] = new { type = "string" }, ["limit"] = new { type = "integer", minimum = 1, maximum = 300 } }, ["path", "limit"])),
            Function("fs_read_text", "Read a bounded UTF-8 prefix from a text/code file inside an allowed workspace.",
                Schema(new Dictionary<string, object?> { ["path"] = new { type = "string" }, ["max_bytes"] = new { type = "integer", minimum = 1, maximum = 262144 } }, ["path", "max_bytes"]))
        };

        var settings = _settings();
        if (settings.AllowFileMutations)
        {
            tools.Add(Function("fs_write_text", "Create, overwrite, or append UTF-8 text/code inside an allowed workspace. Overwrites are atomic.",
                Schema(new Dictionary<string, object?>
                {
                    ["path"] = new { type = "string" },
                    ["text"] = new { type = "string" },
                    ["mode"] = new { type = "string", @enum = new[] { "create_new", "overwrite", "append" } }
                }, ["path", "text", "mode"])));
            tools.Add(Function("fs_replace_text", "Replace exact text inside an allowed text/code file using an atomic rewrite. Fails when the search text is absent.",
                Schema(new Dictionary<string, object?>
                {
                    ["path"] = new { type = "string" },
                    ["find"] = new { type = "string" },
                    ["replace"] = new { type = "string" },
                    ["replace_all"] = new { type = "boolean" }
                }, ["path", "find", "replace", "replace_all"])));
            tools.Add(Function("fs_mkdir", "Create a directory tree inside an allowed workspace.",
                Schema(new Dictionary<string, object?> { ["path"] = new { type = "string" } }, ["path"])));
            tools.Add(Function("fs_copy", "Copy one file inside/between allowed workspaces.",
                Schema(new Dictionary<string, object?>
                {
                    ["source"] = new { type = "string" },
                    ["destination"] = new { type = "string" },
                    ["overwrite"] = new { type = "boolean" }
                }, ["source", "destination", "overwrite"])));
            tools.Add(Function("fs_move", "Move or rename one file or directory inside/between allowed workspaces.",
                Schema(new Dictionary<string, object?>
                {
                    ["source"] = new { type = "string" },
                    ["destination"] = new { type = "string" },
                    ["overwrite"] = new { type = "boolean" }
                }, ["source", "destination", "overwrite"])));
            tools.Add(Function("fs_trash", "Remove a file or directory from its original location by moving it into a reversible .project-constellation-trash folder inside the same allowed root.",
                Schema(new Dictionary<string, object?> { ["path"] = new { type = "string" } }, ["path"])));
        }

        if (settings.AllowDeveloperCommands)
        {
            tools.Add(Function("project_run", "Run an approved developer executable in an allowed workspace without invoking cmd.exe/PowerShell/a shell. Use this for builds, tests, package managers, and Git.",
                Schema(new Dictionary<string, object?>
                {
                    ["cwd"] = new { type = "string" },
                    ["executable"] = new { type = "string" },
                    ["args"] = new { type = "array", items = new { type = "string" }, maxItems = 64 },
                    ["timeout_seconds"] = new { type = "integer", minimum = 1, maximum = 600 }
                }, ["cwd", "executable", "args", "timeout_seconds"])));
        }

        tools.Add(Function("pc_run_allowed", "Run one explicitly enabled safe Windows diagnostic command by ID. Arbitrary shell command lines are not accepted.",
            Schema(new Dictionary<string, object?> { ["id"] = new { type = "string", @enum = new[] { "identity", "hostname", "ipconfig", "systeminfo" } } }, ["id"])));

        if (settings.AllowProcessInspection)
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
            return Failure(name, "Project Constellation emergency lock is active; local tools are disabled.", "PC_BUDDY_LOCKED");

        try
        {
            object result = name switch
            {
                "pc_status" => Status(settings),
                "fs_stat" => Stat(RequireString(args, "path"), settings),
                "fs_list" => ListDirectory(RequireString(args, "path"), RequireInt(args, "limit"), settings),
                "fs_read_text" => await ReadTextAsync(RequireString(args, "path"), RequireInt(args, "max_bytes"), settings, cancellationToken),
                "fs_write_text" when settings.AllowFileMutations => await WriteTextAsync(RequireString(args, "path"), RequireStringAllowEmpty(args, "text"), RequireString(args, "mode"), settings, cancellationToken),
                "fs_replace_text" when settings.AllowFileMutations => await ReplaceTextAsync(RequireString(args, "path"), RequireString(args, "find"), RequireStringAllowEmpty(args, "replace"), RequireBool(args, "replace_all"), settings, cancellationToken),
                "fs_mkdir" when settings.AllowFileMutations => MakeDirectory(RequireString(args, "path"), settings),
                "fs_copy" when settings.AllowFileMutations => CopyFile(RequireString(args, "source"), RequireString(args, "destination"), RequireBool(args, "overwrite"), settings),
                "fs_move" when settings.AllowFileMutations => MovePath(RequireString(args, "source"), RequireString(args, "destination"), RequireBool(args, "overwrite"), settings),
                "fs_trash" when settings.AllowFileMutations => TrashPath(RequireString(args, "path"), settings),
                "project_run" when settings.AllowDeveloperCommands => await RunProjectAsync(RequireString(args, "cwd"), RequireString(args, "executable"), RequireStringArray(args, "args"), RequireInt(args, "timeout_seconds"), settings, cancellationToken),
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
        var value = RequireStringAllowEmpty(args, name);
        if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException($"Missing or invalid {name}.");
        return value;
    }

    private static string RequireStringAllowEmpty(JsonElement args, string name)
    {
        if (!args.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String)
            throw new ArgumentException($"Missing or invalid {name}.");
        return value.GetString() ?? string.Empty;
    }

    private static int RequireInt(JsonElement args, string name)
    {
        if (!args.TryGetProperty(name, out var value) || !value.TryGetInt32(out var number))
            throw new ArgumentException($"Missing or invalid {name}.");
        return number;
    }

    private static bool RequireBool(JsonElement args, string name)
    {
        if (!args.TryGetProperty(name, out var value) || (value.ValueKind != JsonValueKind.True && value.ValueKind != JsonValueKind.False))
            throw new ArgumentException($"Missing or invalid {name}.");
        return value.GetBoolean();
    }

    private static string[] RequireStringArray(JsonElement args, string name)
    {
        if (!args.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array)
            throw new ArgumentException($"Missing or invalid {name}.");
        var output = new List<string>();
        foreach (var item in value.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String) throw new ArgumentException($"{name} must contain only strings.");
            var text = item.GetString() ?? string.Empty;
            if (text.Length > 4096) throw new ArgumentException($"One {name} value is too long.");
            output.Add(text);
            if (output.Count > 64) throw new ArgumentException($"Too many {name} values.");
        }
        return output.ToArray();
    }

    private static object Status(AppSettings s) => new
    {
        app = "Project Constellation",
        version = "0.5.0-work-agent",
        machine = Environment.MachineName,
        user = Environment.UserName,
        os = Environment.OSVersion.VersionString,
        locked = s.EmergencyLocked,
        roots = s.AllowedRoots.Distinct(StringComparer.OrdinalIgnoreCase).ToArray(),
        commands = s.AllowedCommandIds.ToArray(),
        fileMutations = s.AllowFileMutations,
        developerCommands = s.AllowDeveloperCommands,
        developerExecutables = s.AllowDeveloperCommands ? s.AllowedDeveloperExecutables.OrderBy(x => x).ToArray() : Array.Empty<string>(),
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

    private static async Task<object> WriteTextAsync(string input, string text, string mode, AppSettings settings, CancellationToken ct)
    {
        var bytes = Utf8NoBom.GetByteCount(text);
        if (bytes > Math.Clamp(settings.MaxWriteBytes, 1, 16 * 1024 * 1024))
            throw new IOException($"Write exceeds configured limit of {settings.MaxWriteBytes} bytes.");

        var path = RequireAllowedMutationPath(input, settings);
        var parent = Path.GetDirectoryName(path) ?? throw new IOException("Destination has no parent directory.");
        if (!Directory.Exists(parent)) throw new DirectoryNotFoundException("Destination parent directory does not exist. Use fs_mkdir first.");

        switch (mode.ToLowerInvariant())
        {
            case "create_new":
                await using (var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read, 16_384, useAsync: true))
                await using (var writer = new StreamWriter(stream, Utf8NoBom))
                {
                    await writer.WriteAsync(text.AsMemory(), ct);
                }
                break;
            case "overwrite":
                await AtomicWriteTextAsync(path, text, ct);
                break;
            case "append":
                await using (var stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read, 16_384, useAsync: true))
                await using (var writer = new StreamWriter(stream, Utf8NoBom))
                {
                    await writer.WriteAsync(text.AsMemory(), ct);
                }
                break;
            default:
                throw new ArgumentException("mode must be create_new, overwrite, or append.");
        }

        var info = new FileInfo(path);
        return new { path, mode, bytes = info.Length, modified = info.LastWriteTimeUtc };
    }

    private static async Task<object> ReplaceTextAsync(string input, string find, string replace, bool replaceAll, AppSettings settings, CancellationToken ct)
    {
        if (find.Length == 0) throw new ArgumentException("find cannot be empty.");
        var path = RequireAllowedExistingPath(input, settings);
        if (!File.Exists(path)) throw new IOException("Path is not a file.");
        var info = new FileInfo(path);
        if (info.Length > Math.Clamp(settings.MaxWriteBytes, 1, 16 * 1024 * 1024))
            throw new IOException("File is larger than the configured editable-text limit.");

        var original = await File.ReadAllTextAsync(path, ct);
        var first = original.IndexOf(find, StringComparison.Ordinal);
        if (first < 0) throw new InvalidOperationException("Exact search text was not found; file was not changed.");

        string updated;
        int replacements;
        if (replaceAll)
        {
            replacements = CountOccurrences(original, find);
            updated = original.Replace(find, replace, StringComparison.Ordinal);
        }
        else
        {
            replacements = 1;
            updated = string.Concat(original.AsSpan(0, first), replace, original.AsSpan(first + find.Length));
        }

        if (Utf8NoBom.GetByteCount(updated) > Math.Clamp(settings.MaxWriteBytes, 1, 16 * 1024 * 1024))
            throw new IOException("Edited file would exceed the configured editable-text limit.");
        await AtomicWriteTextAsync(path, updated, ct);
        return new { path, replacements, bytes = new FileInfo(path).Length };
    }

    private static object MakeDirectory(string input, AppSettings settings)
    {
        var path = RequireAllowedMutationPath(input, settings);
        Directory.CreateDirectory(path);
        var resolved = RequireAllowedExistingPath(path, settings);
        return new { path = resolved, created = true };
    }

    private static object CopyFile(string sourceInput, string destinationInput, bool overwrite, AppSettings settings)
    {
        var source = RequireAllowedExistingPath(sourceInput, settings);
        if (!File.Exists(source)) throw new IOException("fs_copy currently copies files; source is not a file.");
        var destination = RequireAllowedMutationPath(destinationInput, settings);
        var parent = Path.GetDirectoryName(destination) ?? throw new IOException("Destination has no parent directory.");
        if (!Directory.Exists(parent)) throw new DirectoryNotFoundException("Destination parent directory does not exist.");
        File.Copy(source, destination, overwrite);
        return new { source, destination = RequireAllowedExistingPath(destination, settings), bytes = new FileInfo(destination).Length };
    }

    private static object MovePath(string sourceInput, string destinationInput, bool overwrite, AppSettings settings)
    {
        var source = RequireAllowedExistingPath(sourceInput, settings);
        var destination = RequireAllowedMutationPath(destinationInput, settings);
        var parent = Path.GetDirectoryName(destination) ?? throw new IOException("Destination has no parent directory.");
        if (!Directory.Exists(parent)) throw new DirectoryNotFoundException("Destination parent directory does not exist.");

        if (File.Exists(source))
        {
            File.Move(source, destination, overwrite);
        }
        else if (Directory.Exists(source))
        {
            if (File.Exists(destination) || Directory.Exists(destination))
            {
                if (!overwrite) throw new IOException("Destination already exists.");
                throw new IOException("Directory overwrite is intentionally refused; move to an unused destination or trash it first.");
            }
            Directory.Move(source, destination);
        }
        else throw new FileNotFoundException("Source no longer exists.");

        return new { source, destination, moved = true };
    }

    private static object TrashPath(string input, AppSettings settings)
    {
        var path = RequireAllowedExistingPath(input, settings);
        var root = FindContainingAllowedRoot(path, settings) ?? throw new UnauthorizedAccessException("Could not resolve containing allowed root.");
        if (string.Equals(path.TrimEnd(Path.DirectorySeparatorChar), root.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
            throw new UnauthorizedAccessException("Refusing to trash an allowed root itself.");

        var trashRoot = Path.Combine(root, ".project-constellation-trash");
        Directory.CreateDirectory(trashRoot);
        var name = Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar));
        var destination = Path.Combine(trashRoot, $"{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}-{name}");
        if (File.Exists(path)) File.Move(path, destination);
        else if (Directory.Exists(path)) Directory.Move(path, destination);
        else throw new FileNotFoundException("Path no longer exists.");
        return new { original = path, trashedTo = destination, reversible = true };
    }

    private static async Task<object> RunProjectAsync(string cwdInput, string executableInput, string[] args, int requestedTimeout, AppSettings settings, CancellationToken ct)
    {
        var cwd = RequireAllowedExistingPath(cwdInput, settings);
        if (!Directory.Exists(cwd)) throw new IOException("cwd is not a directory.");
        var executable = Path.GetFileName(executableInput.Trim());
        if (string.IsNullOrWhiteSpace(executable) || !settings.AllowedDeveloperExecutables.Contains(executable))
            throw new UnauthorizedAccessException($"Developer executable is not approved: {executableInput}");
        ValidateDeveloperArguments(executable, args, settings);

        var psi = new ProcessStartInfo(executable)
        {
            WorkingDirectory = cwd,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        foreach (var arg in args) psi.ArgumentList.Add(arg);

        using var process = Process.Start(psi) ?? throw new InvalidOperationException($"Could not start developer command: {executable}");
        var stdoutTask = process.StandardOutput.ReadToEndAsync(ct);
        var stderrTask = process.StandardError.ReadToEndAsync(ct);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(requestedTimeout, 1, Math.Min(settings.MaxCommandSeconds, 600))));
        try
        {
            await process.WaitForExitAsync(timeout.Token);
            var stdout = await stdoutTask;
            var stderr = await stderrTask;
            return new
            {
                cwd,
                executable,
                args,
                exitCode = process.ExitCode,
                stdout = Truncate(stdout, 2_000_000),
                stderr = Truncate(stderr, 1_000_000)
            };
        }
        catch
        {
            try { process.Kill(entireProcessTree: true); } catch { }
            throw;
        }
    }

    private static void ValidateDeveloperArguments(string executable, IEnumerable<string> args, AppSettings settings)
    {
        var values = args.ToArray();
        if ((executable.Equals("git", StringComparison.OrdinalIgnoreCase) || executable.Equals("git.exe", StringComparison.OrdinalIgnoreCase)) &&
            values.Any(value => value.Equals("-C", StringComparison.OrdinalIgnoreCase) || value.StartsWith("--git-dir", StringComparison.OrdinalIgnoreCase) || value.StartsWith("--work-tree", StringComparison.OrdinalIgnoreCase)))
            throw new UnauthorizedAccessException("Git path-redirection options are blocked; use the approved cwd instead.");

        foreach (var value in values)
        {
            if (value.IndexOf('\0') >= 0) throw new ArgumentException("Developer arguments cannot contain NUL characters.");
            var candidate = value;
            var equals = candidate.IndexOf('=');
            if (equals >= 0 && equals < candidate.Length - 1) candidate = candidate[(equals + 1)..];
            if (Path.IsPathRooted(candidate) && (candidate.Contains(Path.DirectorySeparatorChar) || candidate.Contains(Path.AltDirectorySeparatorChar)))
            {
                RequireAllowedMutationPath(candidate, settings);
            }
        }
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

    private static async Task AtomicWriteTextAsync(string path, string text, CancellationToken ct)
    {
        var parent = Path.GetDirectoryName(path) ?? throw new IOException("Destination has no parent directory.");
        var temp = Path.Combine(parent, $".{Path.GetFileName(path)}.constellation-{Guid.NewGuid():N}.tmp");
        try
        {
            await File.WriteAllTextAsync(temp, text, Utf8NoBom, ct);
            File.Move(temp, path, true);
        }
        finally
        {
            try { if (File.Exists(temp)) File.Delete(temp); } catch { }
        }
    }

    private static int CountOccurrences(string value, string needle)
    {
        var count = 0;
        var offset = 0;
        while (offset <= value.Length - needle.Length)
        {
            var next = value.IndexOf(needle, offset, StringComparison.Ordinal);
            if (next < 0) break;
            count++;
            offset = next + needle.Length;
        }
        return count;
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
        return EnsureInsideAllowedRoot(realCandidate, settings);
    }

    private static string RequireAllowedMutationPath(string input, AppSettings settings)
    {
        if (string.IsNullOrWhiteSpace(input)) throw new ArgumentException("Path is empty.");
        var candidate = Path.GetFullPath(Environment.ExpandEnvironmentVariables(input));
        if (File.Exists(candidate) || Directory.Exists(candidate))
            return EnsureInsideAllowedRoot(ResolveFinalPath(candidate), settings);

        var ancestor = Path.GetDirectoryName(candidate);
        while (!string.IsNullOrWhiteSpace(ancestor) && !Directory.Exists(ancestor))
            ancestor = Path.GetDirectoryName(ancestor);
        if (string.IsNullOrWhiteSpace(ancestor)) throw new DirectoryNotFoundException("Could not resolve an existing parent for the destination.");

        var realAncestor = ResolveFinalPath(ancestor);
        var suffix = Path.GetRelativePath(ancestor, candidate);
        var reconstructed = Path.GetFullPath(Path.Combine(realAncestor, suffix));
        return EnsureInsideAllowedRoot(reconstructed, settings);
    }

    private static string EnsureInsideAllowedRoot(string candidate, AppSettings settings)
    {
        foreach (var configuredRoot in settings.AllowedRoots.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var root = Path.GetFullPath(configuredRoot);
            if (!Directory.Exists(root)) continue;
            var realRoot = ResolveFinalPath(root);
            var relative = Path.GetRelativePath(realRoot, candidate);
            if (relative == "." || (!relative.StartsWith(".." + Path.DirectorySeparatorChar) && relative != ".." && !Path.IsPathRooted(relative)))
                return candidate;
        }
        throw new UnauthorizedAccessException("Path is outside the folders enabled in Project Constellation > Access or linked as a project workspace.");
    }

    private static string? FindContainingAllowedRoot(string candidate, AppSettings settings)
    {
        string? best = null;
        foreach (var configuredRoot in settings.AllowedRoots.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var root = Path.GetFullPath(configuredRoot);
            if (!Directory.Exists(root)) continue;
            var realRoot = ResolveFinalPath(root);
            var relative = Path.GetRelativePath(realRoot, candidate);
            if (relative == "." || (!relative.StartsWith(".." + Path.DirectorySeparatorChar) && relative != ".." && !Path.IsPathRooted(relative)))
            {
                if (best is null || realRoot.Length > best.Length) best = realRoot;
            }
        }
        return best;
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
