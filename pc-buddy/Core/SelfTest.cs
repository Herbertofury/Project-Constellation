using System.Text.Json;

namespace PCBuddy.Core;

public static class SelfTest
{
    public static async Task<int> RunAsync()
    {
        var results = new List<object>();
        var failures = new List<string>();
        var settings = new AppSettings
        {
            AllowDesktop = false,
            AllowDocuments = true,
            AllowDownloads = false,
            AllowProcessInspection = true,
            AllowIdentity = true,
            AllowHostname = true,
            AllowIpConfig = false,
            AllowSystemInfo = false,
            EmergencyLocked = false
        };

        void Activity(string tool, string detail, bool ok) => results.Add(new { kind = "activity", tool, detail, ok });
        var broker = new ToolBroker(() => settings, Activity);
        string? testFile = null;
        string? secretDir = null;

        try
        {
            var status = await broker.ExecuteAsync("pc_status", Args("{}"), CancellationToken.None);
            Require(status.Contains("\"ok\":true", StringComparison.Ordinal), "pc_status did not return success", failures);
            results.Add(new { test = "pc_status", ok = !failures.Any(x => x.Contains("pc_status", StringComparison.Ordinal)) });

            var docs = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            Directory.CreateDirectory(docs);
            testFile = Path.Combine(docs, $"pc-buddy-self-test-{Guid.NewGuid():N}.txt");
            var marker = $"PC_BUDDY_SELF_TEST_{Guid.NewGuid():N}";
            await File.WriteAllTextAsync(testFile, marker);
            var readArgs = JsonSerializer.Serialize(new { path = testFile, max_bytes = 4096 });
            var read = await broker.ExecuteAsync("fs_read_text", Args(readArgs), CancellationToken.None);
            Require(read.Contains(marker, StringComparison.Ordinal), "fs_read_text did not return the real fixture content", failures);
            results.Add(new { test = "fs_read_text", ok = read.Contains(marker, StringComparison.Ordinal) });

            var hostname = await broker.ExecuteAsync("pc_run_allowed", Args("{\"id\":\"hostname\"}"), CancellationToken.None);
            Require(hostname.Contains("\"ok\":true", StringComparison.Ordinal), "hostname diagnostic did not execute successfully", failures);
            results.Add(new { test = "pc_run_allowed.hostname", ok = hostname.Contains("\"ok\":true", StringComparison.Ordinal) });

            settings.EmergencyLocked = true;
            var locked = await broker.ExecuteAsync("pc_status", Args("{}"), CancellationToken.None);
            Require(locked.Contains("PC_BUDDY_LOCKED", StringComparison.Ordinal), "emergency lock did not deny local tools", failures);
            results.Add(new { test = "emergency_lock", ok = locked.Contains("PC_BUDDY_LOCKED", StringComparison.Ordinal) });
            settings.EmergencyLocked = false;

            secretDir = Path.Combine(Path.GetTempPath(), $"pc-buddy-secret-test-{Guid.NewGuid():N}");
            Directory.CreateDirectory(secretDir);
            var secrets = new SecretStore(secretDir);
            const string secret = "self-test-secret-not-an-api-key";
            secrets.SaveApiKey(secret);
            var loaded = secrets.LoadApiKey();
            var secretOk = string.Equals(secret, loaded, StringComparison.Ordinal);
            Require(secretOk, "Windows DPAPI secret round-trip failed", failures);
            secrets.ForgetApiKey();
            results.Add(new { test = "dpapi_round_trip", ok = secretOk });
        }
        catch (Exception ex)
        {
            failures.Add($"Unhandled self-test failure: {ex}");
        }
        finally
        {
            try { if (testFile is not null && File.Exists(testFile)) File.Delete(testFile); } catch { }
            try { if (secretDir is not null && Directory.Exists(secretDir)) Directory.Delete(secretDir, true); } catch { }
        }

        var receipt = new
        {
            app = "PC Buddy Portable",
            version = "0.2.0-alpha",
            timestampUtc = DateTimeOffset.UtcNow,
            passed = failures.Count == 0,
            failures,
            results
        };
        var receiptPath = Path.Combine(AppContext.BaseDirectory, "pc-buddy-self-test.json");
        await File.WriteAllTextAsync(receiptPath, JsonSerializer.Serialize(receipt, new JsonSerializerOptions { WriteIndented = true }));
        return failures.Count == 0 ? 0 : 1;
    }

    private static JsonElement Args(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static void Require(bool condition, string message, List<string> failures)
    {
        if (!condition) failures.Add(message);
    }
}
