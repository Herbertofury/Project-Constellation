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
            AllowDesktop = false,
            AllowDocuments = true,
            AllowDownloads = false,
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
        string? testFile = null;

        try
        {
            var status = await broker.ExecuteAsync("pc_status", Args("{}"), CancellationToken.None);
            Require(status.Contains("\"ok\":true", StringComparison.Ordinal), "pc_status did not return success", failures);
            Require(status.Contains("Project Constellation", StringComparison.Ordinal), "pc_status has stale product identity", failures);
            results.Add(new { test = "pc_status", ok = status.Contains("\"ok\":true", StringComparison.Ordinal) });

            var docs = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            Directory.CreateDirectory(docs);
            testFile = Path.Combine(docs, $"project-constellation-self-test-{Guid.NewGuid():N}.txt");
            var marker = $"PROJECT_CONSTELLATION_SELF_TEST_{Guid.NewGuid():N}";
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

            var nonce = ChatGptBridgeProtocol.CreateNonce();
            using var validDoc = JsonDocument.Parse(JsonSerializer.Serialize(new
            {
                nonce,
                id = "self-test-call",
                tool = "pc_status",
                args = new { }
            }));
            var valid = ChatGptBridgeProtocol.TryParseToolCall(validDoc.RootElement, nonce, out var parsedCall, out _);
            Require(valid && parsedCall?.Tool == "pc_status", "ChatGPT bridge protocol rejected a valid local tool request", failures);
            results.Add(new { test = "chatgpt_bridge.valid_call", ok = valid && parsedCall?.Tool == "pc_status" });

            var wrongNonce = ChatGptBridgeProtocol.TryParseToolCall(validDoc.RootElement, nonce + "x", out _, out _);
            Require(!wrongNonce, "ChatGPT bridge protocol accepted a call from the wrong session nonce", failures);
            results.Add(new { test = "chatgpt_bridge.nonce_rejection", ok = !wrongNonce });

            var bootstrap = ChatGptBridgeProtocol.BuildBootstrap(nonce, broker.GetToolDefinitions());
            var bootstrapOk = bootstrap.Contains("normal ChatGPT account/session", StringComparison.OrdinalIgnoreCase)
                              && bootstrap.Contains("Do not ask for or use an OpenAI API key", StringComparison.OrdinalIgnoreCase)
                              && bootstrap.Contains("Project Constellation", StringComparison.Ordinal)
                              && bootstrap.Contains(nonce, StringComparison.Ordinal);
            Require(bootstrapOk, "ChatGPT bootstrap did not preserve the Project Constellation no-API session contract", failures);
            results.Add(new { test = "chatgpt_bridge.no_api_contract", ok = bootstrapOk });

            localServer = new LocalCompanionServer(broker, () => settings, Activity, port:17343);
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
            var hasToken = sessionRoot.TryGetProperty("sessionToken", out var tokenValue);
            var hasNonce = sessionRoot.TryGetProperty("nonce", out var nonceValue);
            var hasContext = sessionRoot.TryGetProperty("context", out var contextValue);
            var sessionToken = hasToken && tokenValue.ValueKind == JsonValueKind.String ? tokenValue.GetString() : null;
            var browserNonce = hasNonce && nonceValue.ValueKind == JsonValueKind.String ? nonceValue.GetString() : null;
            var contextText = hasContext && contextValue.ValueKind == JsonValueKind.String ? contextValue.GetString() : null;
            var sessionOk = sessionResponse.IsSuccessStatusCode
                            && !string.IsNullOrWhiteSpace(sessionToken)
                            && !string.IsNullOrWhiteSpace(browserNonce)
                            && contextText?.Contains("PROJECT CONSTELLATION LOCAL CONTEXT", StringComparison.Ordinal) == true;
            Require(sessionOk, "loopback browser companion session handshake failed", failures);
            results.Add(new { test = "browser_companion.handshake", ok = sessionOk });

            if (sessionOk)
            {
                var toolBody = JsonSerializer.Serialize(new
                {
                    call = new { nonce = browserNonce!, id = "browser-self-test-call", tool = "pc_status", args = new { } }
                });
                using var toolRequest = new HttpRequestMessage(HttpMethod.Post, "/v1/tool")
                {
                    Content = new StringContent(toolBody, Encoding.UTF8, "application/json")
                };
                toolRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", sessionToken!);
                var toolResponse = await http.SendAsync(toolRequest);
                var toolText = await toolResponse.Content.ReadAsStringAsync();
                var toolOk = toolResponse.IsSuccessStatusCode
                             && toolText.Contains("browser-self-test-call", StringComparison.Ordinal)
                             && toolText.Contains("Project Constellation", StringComparison.Ordinal)
                             && toolText.Contains("PC BUDDY TOOL RESULT", StringComparison.Ordinal);
                Require(toolOk, "loopback browser companion did not execute and return a real tool result", failures);
                results.Add(new { test = "browser_companion.tool_roundtrip", ok = toolOk });
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
            try { if (testFile is not null && File.Exists(testFile)) File.Delete(testFile); } catch { }
        }

        var receipt = new
        {
            app = "Project Constellation",
            version = "0.4.0-constellation",
            timestampUtc = DateTimeOffset.UtcNow,
            transport = "chatgpt_web_session",
            browserCompanion = "loopback_tokenized",
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
