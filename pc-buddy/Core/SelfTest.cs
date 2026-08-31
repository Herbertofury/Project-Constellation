using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace PCBuddy.Core;

public static class SelfTest
{
    public static async Task<int> RunAsync()
    {
        var results = new List<object>();
        var failures = new List<string>();
        var settings = new AppSettings
        {
            AllowDesktop = true,
            AllowDocuments = true,
            AllowDownloads = false,
            AllowFileMutations = true,
            AllowDeveloperCommands = true,
            AllowProcessInspection = true,
            AllowBrowserCompanion = true,
            AllowIdentity = true,
            AllowHostname = true,
            AllowIpConfig = false,
            AllowSystemInfo = false,
            EmergencyLocked = false
        };

        void Activity(string tool, string detail, bool ok) => results.Add(new { kind = "activity", tool, detail, ok });
        var broker = new ToolBroker(() => settings, Activity);
        LocalCompanionServer? localServer = null;
        string? desktopTestFile = null;
        string? browserWriteFile = null;
        string? copiedFile = null;
        string? movedFile = null;
        string? projectTestDirectory = null;
        string? customWorkspace = null;

        try
        {
            var status = await broker.ExecuteAsync("pc_status", Args("{}"), CancellationToken.None);
            Require(status.Contains("\"ok\":true", StringComparison.Ordinal), "pc_status did not return success", failures);
            Require(status.Contains("Project Constellation", StringComparison.Ordinal), "pc_status has stale product identity", failures);
            Require(status.Contains("\"fileMutations\":true", StringComparison.Ordinal), "pc_status did not expose file mutation capability", failures);
            Require(status.Contains("\"developerCommands\":true", StringComparison.Ordinal), "pc_status did not expose developer command capability", failures);
            results.Add(new { test = "pc_status.work_agent", ok = failures.Count == 0 });

            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            var docs = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            Directory.CreateDirectory(desktop);
            Directory.CreateDirectory(docs);

            var marker = $"PROJECT_CONSTELLATION_DESKTOP_WRITE_{Guid.NewGuid():N}";
            desktopTestFile = Path.Combine(desktop, $"Project-Constellation-Self-Test-{Guid.NewGuid():N}.txt");
            var write = await broker.ExecuteAsync("fs_write_text", Args(JsonSerializer.Serialize(new { path = desktopTestFile, text = marker, mode = "create_new" })), CancellationToken.None);
            var writeOk = write.Contains("\"ok\":true", StringComparison.Ordinal) && File.Exists(desktopTestFile) && await File.ReadAllTextAsync(desktopTestFile) == marker;
            Require(writeOk, "fs_write_text did not create the real Desktop text file", failures);
            results.Add(new { test = "fs_write_text.desktop_create", ok = writeOk });

            var editedMarker = marker + "_EDITED";
            var replace = await broker.ExecuteAsync("fs_replace_text", Args(JsonSerializer.Serialize(new { path = desktopTestFile, find = marker, replace = editedMarker, replace_all = false })), CancellationToken.None);
            var replaceOk = replace.Contains("\"ok\":true", StringComparison.Ordinal) && await File.ReadAllTextAsync(desktopTestFile) == editedMarker;
            Require(replaceOk, "fs_replace_text did not edit the real Desktop file", failures);
            results.Add(new { test = "fs_replace_text.desktop_edit", ok = replaceOk });

            var read = await broker.ExecuteAsync("fs_read_text", Args(JsonSerializer.Serialize(new { path = desktopTestFile, max_bytes = 4096 })), CancellationToken.None);
            Require(read.Contains(editedMarker, StringComparison.Ordinal), "fs_read_text did not return the edited Desktop fixture", failures);
            results.Add(new { test = "fs_read_text.desktop_verify", ok = read.Contains(editedMarker, StringComparison.Ordinal) });

            copiedFile = Path.Combine(desktop, $"Project-Constellation-Copy-{Guid.NewGuid():N}.txt");
            var copy = await broker.ExecuteAsync("fs_copy", Args(JsonSerializer.Serialize(new { source = desktopTestFile, destination = copiedFile, overwrite = false })), CancellationToken.None);
            var copyOk = copy.Contains("\"ok\":true", StringComparison.Ordinal) && File.Exists(copiedFile) && await File.ReadAllTextAsync(copiedFile) == editedMarker;
            Require(copyOk, "fs_copy did not copy the Desktop fixture", failures);
            results.Add(new { test = "fs_copy.desktop", ok = copyOk });

            movedFile = Path.Combine(desktop, $"Project-Constellation-Moved-{Guid.NewGuid():N}.txt");
            var move = await broker.ExecuteAsync("fs_move", Args(JsonSerializer.Serialize(new { source = copiedFile, destination = movedFile, overwrite = false })), CancellationToken.None);
            var moveOk = move.Contains("\"ok\":true", StringComparison.Ordinal) && !File.Exists(copiedFile) && File.Exists(movedFile);
            Require(moveOk, "fs_move did not move/rename the Desktop fixture", failures);
            results.Add(new { test = "fs_move.desktop", ok = moveOk });
            copiedFile = null;

            customWorkspace = Path.Combine(Path.GetTempPath(), $"project-constellation-workspace-{Guid.NewGuid():N}");
            Directory.CreateDirectory(customWorkspace);
            settings.CustomRoots.Add(customWorkspace);
            var customFile = Path.Combine(customWorkspace, "hello.cs");
            var customWrite = await broker.ExecuteAsync("fs_write_text", Args(JsonSerializer.Serialize(new { path = customFile, text = "public static class Hello { public static string Value => \"ok\"; }", mode = "create_new" })), CancellationToken.None);
            var customOk = customWrite.Contains("\"ok\":true", StringComparison.Ordinal) && File.Exists(customFile);
            Require(customOk, "linked custom project workspace was not writable through guarded tools", failures);
            results.Add(new { test = "workspace.custom_root_write", ok = customOk });

            var dotnet = await broker.ExecuteAsync("project_run", Args(JsonSerializer.Serialize(new { cwd = customWorkspace, executable = "dotnet", args = new[] { "--version" }, timeout_seconds = 30 })), CancellationToken.None);
            var dotnetOk = dotnet.Contains("\"ok\":true", StringComparison.Ordinal) && dotnet.Contains("\"exitCode\":0", StringComparison.Ordinal);
            Require(dotnetOk, "project_run did not execute the approved dotnet developer command", failures);
            results.Add(new { test = "project_run.dotnet", ok = dotnetOk });

            var hostname = await broker.ExecuteAsync("pc_run_allowed", Args("{\"id\":\"hostname\"}"), CancellationToken.None);
            Require(hostname.Contains("\"ok\":true", StringComparison.Ordinal), "hostname diagnostic did not execute successfully", failures);
            results.Add(new { test = "pc_run_allowed.hostname", ok = hostname.Contains("\"ok\":true", StringComparison.Ordinal) });

            settings.EmergencyLocked = true;
            var locked = await broker.ExecuteAsync("fs_write_text", Args(JsonSerializer.Serialize(new { path = desktopTestFile, text = "blocked", mode = "overwrite" })), CancellationToken.None);
            Require(locked.Contains("PC_BUDDY_LOCKED", StringComparison.Ordinal), "emergency lock did not deny file mutation", failures);
            results.Add(new { test = "emergency_lock.blocks_writes", ok = locked.Contains("PC_BUDDY_LOCKED", StringComparison.Ordinal) });
            settings.EmergencyLocked = false;

            var nonce = ChatGptBridgeProtocol.CreateNonce();
            using var validDoc = JsonDocument.Parse(JsonSerializer.Serialize(new
            {
                nonce,
                id = "self-test-call",
                tool = "fs_write_text",
                args = new { path = desktopTestFile, text = editedMarker, mode = "overwrite" }
            }));
            var valid = ChatGptBridgeProtocol.TryParseToolCall(validDoc.RootElement, nonce, out var parsedCall, out _);
            Require(valid && parsedCall?.Tool == "fs_write_text", "ChatGPT bridge protocol rejected a valid file-write request", failures);
            results.Add(new { test = "chatgpt_bridge.valid_write_call", ok = valid && parsedCall?.Tool == "fs_write_text" });

            var wrongNonce = ChatGptBridgeProtocol.TryParseToolCall(validDoc.RootElement, nonce + "x", out _, out _);
            Require(!wrongNonce, "ChatGPT bridge protocol accepted a write call from the wrong session nonce", failures);
            results.Add(new { test = "chatgpt_bridge.nonce_rejection", ok = !wrongNonce });

            var bootstrap = ChatGptBridgeProtocol.BuildBootstrap(nonce, broker.GetToolDefinitions());
            var bootstrapOk = bootstrap.Contains("normal ChatGPT account/session", StringComparison.OrdinalIgnoreCase)
                              && bootstrap.Contains("Do not ask for or use an OpenAI API key", StringComparison.OrdinalIgnoreCase)
                              && bootstrap.Contains("Project Constellation", StringComparison.Ordinal)
                              && bootstrap.Contains("fs_write_text", StringComparison.Ordinal)
                              && bootstrap.Contains("project_run", StringComparison.Ordinal)
                              && bootstrap.Contains(nonce, StringComparison.Ordinal);
            Require(bootstrapOk, "ChatGPT bootstrap did not advertise the no-API Work-agent tool surface", failures);
            results.Add(new { test = "chatgpt_bridge.work_agent_contract", ok = bootstrapOk });

            projectTestDirectory = Path.Combine(Path.GetTempPath(), $"project-constellation-project-store-{Guid.NewGuid():N}");
            Directory.CreateDirectory(projectTestDirectory);
            var projectStore = new ProjectWorkspaceStore(projectTestDirectory);
            var project = new ProjectWorkspace
            {
                Name = "Project Store Self Test",
                ChatUrl = "https://chatgpt.com/c/project-constellation-self-test",
                RelatedChatUrls = "https://chatgpt.com/c/related-self-test",
                LocalRoot = customWorkspace,
                GitHubUrl = "https://github.com/Herbertofury/Project-Constellation",
                DriveUrl = "https://drive.google.com/drive/my-drive",
                Checkpoint = marker,
                Blocker = "none",
                NextAction = "verify persistence",
                Notes = "Project Constellation self-test"
            };
            projectStore.Save(new[] { project });
            var reloaded = projectStore.Load();
            var projectOk = reloaded.Count == 1
                            && reloaded[0].Name == project.Name
                            && reloaded[0].ChatUrl == project.ChatUrl
                            && reloaded[0].LocalRoot == project.LocalRoot
                            && reloaded[0].GitHubUrl == project.GitHubUrl
                            && reloaded[0].DriveUrl == project.DriveUrl
                            && reloaded[0].Checkpoint == marker
                            && reloaded[0].NextAction == project.NextAction;
            Require(projectOk, "project workspace metadata did not survive an atomic save/reload round trip", failures);
            results.Add(new { test = "projects.persistence_roundtrip", ok = projectOk });

            localServer = new LocalCompanionServer(broker, () => settings, Activity, port: 17343);
            await localServer.StartAsync();
            using var http = new HttpClient { BaseAddress = new Uri("http://127.0.0.1:17343"), Timeout = TimeSpan.FromSeconds(10) };
            http.DefaultRequestHeaders.Add("X-Project-Constellation-Client", LocalCompanionServer.ExtensionId);

            var healthResponse = await http.GetAsync("/v1/health");
            var healthText = await healthResponse.Content.ReadAsStringAsync();
            var healthOk = healthResponse.IsSuccessStatusCode && healthText.Contains("loopback_browser_companion", StringComparison.Ordinal);
            Require(healthOk, "loopback browser companion health check failed", failures);
            results.Add(new { test = "browser_companion.health", ok = healthOk });

            var sessionResponse = await http.PostAsync("/v1/session",
                new StringContent(JsonSerializer.Serialize(new { conversationKey = "/c/self-test", tabKey = "ci" }), Encoding.UTF8, "application/json"));
            var sessionText = await sessionResponse.Content.ReadAsStringAsync();
            using var sessionDoc = JsonDocument.Parse(sessionText);
            var sessionRoot = sessionDoc.RootElement;
            var sessionToken = sessionRoot.TryGetProperty("sessionToken", out var tokenValue) && tokenValue.ValueKind == JsonValueKind.String ? tokenValue.GetString() : null;
            var browserNonce = sessionRoot.TryGetProperty("nonce", out var nonceValue) && nonceValue.ValueKind == JsonValueKind.String ? nonceValue.GetString() : null;
            var contextText = sessionRoot.TryGetProperty("context", out var contextValue) && contextValue.ValueKind == JsonValueKind.String ? contextValue.GetString() : null;
            var sessionOk = sessionResponse.IsSuccessStatusCode
                            && !string.IsNullOrWhiteSpace(sessionToken)
                            && !string.IsNullOrWhiteSpace(browserNonce)
                            && contextText?.Contains("PROJECT CONSTELLATION LOCAL CONTEXT", StringComparison.Ordinal) == true
                            && contextText.Contains("fs_write_text", StringComparison.Ordinal);
            Require(sessionOk, "loopback browser companion session handshake did not expose the Work-agent tools", failures);
            results.Add(new { test = "browser_companion.handshake", ok = sessionOk });

            if (sessionOk)
            {
                browserWriteFile = Path.Combine(desktop, $"Project-Constellation-Browser-Write-{Guid.NewGuid():N}.txt");
                var browserMarker = $"BROWSER_CHAT_DESKTOP_WRITE_{Guid.NewGuid():N}";
                var toolBody = JsonSerializer.Serialize(new
                {
                    call = new { nonce = browserNonce!, id = "browser-write-self-test", tool = "fs_write_text", args = new { path = browserWriteFile, text = browserMarker, mode = "create_new" } }
                });
                using var toolRequest = new HttpRequestMessage(HttpMethod.Post, "/v1/tool")
                {
                    Content = new StringContent(toolBody, Encoding.UTF8, "application/json")
                };
                toolRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", sessionToken!);
                var toolResponse = await http.SendAsync(toolRequest);
                var toolText = await toolResponse.Content.ReadAsStringAsync();
                var toolOk = toolResponse.IsSuccessStatusCode
                             && toolText.Contains("browser-write-self-test", StringComparison.Ordinal)
                             && toolText.Contains("PC BUDDY TOOL RESULT", StringComparison.Ordinal)
                             && File.Exists(browserWriteFile)
                             && await File.ReadAllTextAsync(browserWriteFile) == browserMarker;
                Require(toolOk, "normal-browser companion did not create a real Desktop file through fs_write_text", failures);
                results.Add(new { test = "browser_companion.desktop_write_roundtrip", ok = toolOk });
            }
        }
        catch (Exception ex)
        {
            failures.Add($"Unhandled self-test failure: {ex}");
        }
        finally
        {
            if (localServer is not null)
            {
                try { await localServer.DisposeAsync(); } catch { }
            }
            foreach (var file in new[] { desktopTestFile, browserWriteFile, copiedFile, movedFile })
            {
                try { if (file is not null && File.Exists(file)) File.Delete(file); } catch { }
            }
            try { if (projectTestDirectory is not null && Directory.Exists(projectTestDirectory)) Directory.Delete(projectTestDirectory, true); } catch { }
            try { if (customWorkspace is not null && Directory.Exists(customWorkspace)) Directory.Delete(customWorkspace, true); } catch { }
        }

        var receipt = new
        {
            app = "Project Constellation",
            version = "0.5.0-work-agent",
            timestampUtc = DateTimeOffset.UtcNow,
            transport = "chatgpt_web_session",
            browserCompanion = "loopback_tokenized",
            projectWorkspaces = "persistent_atomic_json",
            fileWorkspace = "read_write_guarded",
            developerCommands = "allowlisted_no_shell",
            apiKeyRequired = false,
            passed = failures.Count == 0,
            failures,
            results
        };
        var receiptPath = Path.Combine(AppContext.BaseDirectory, "project-constellation-self-test.json");
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
