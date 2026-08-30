using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;

namespace PCBuddy.Core;

public static class BridgeDomSmoke
{
    public static async Task<int> RunAsync()
    {
        var failures = new List<string>();
        var siteDirectory = Path.Combine(Path.GetTempPath(), $"pc-buddy-dom-site-{Guid.NewGuid():N}");
        var profileDirectory = Path.Combine(Path.GetTempPath(), $"pc-buddy-dom-profile-{Guid.NewGuid():N}");
        var receiptPath = Path.Combine(AppContext.BaseDirectory, "pc-buddy-bridge-dom-smoke.json");
        Window? window = null;
        WebView2? webView = null;
        var sessionStateObserved = false;
        var toolCallObserved = false;
        var sendInjected = false;
        var internalHidden = false;

        try
        {
            Directory.CreateDirectory(siteDirectory);
            Directory.CreateDirectory(profileDirectory);
            await File.WriteAllTextAsync(Path.Combine(siteDirectory, "index.html"), FixtureHtml);

            webView = new WebView2();
            window = new Window
            {
                Width = 800,
                Height = 600,
                Content = webView,
                ShowInTaskbar = false,
                Opacity = 0.02,
                WindowStartupLocation = WindowStartupLocation.Manual,
                Left = -10000,
                Top = -10000
            };
            window.Show();

            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: profileDirectory);
            await webView.EnsureCoreWebView2Async(environment);
            var core = webView.CoreWebView2;
            var bridgeReady = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

            core.WebMessageReceived += (_, e) =>
            {
                try
                {
                    using var doc = JsonDocument.Parse(e.WebMessageAsJson);
                    var root = doc.RootElement;
                    if (!root.TryGetProperty("type", out var typeValue)) return;
                    var type = typeValue.GetString();
                    if (type == "session_state" && root.TryGetProperty("ready", out var ready) && ready.ValueKind == JsonValueKind.True)
                        sessionStateObserved = true;
                    if (type == "tool_call" && root.TryGetProperty("call", out var call)
                        && call.TryGetProperty("id", out var id) && id.GetString() == "dom-smoke-call")
                        toolCallObserved = true;
                    if (sessionStateObserved && toolCallObserved) bridgeReady.TrySetResult(true);
                }
                catch { }
            };

            await core.AddScriptToExecuteOnDocumentCreatedAsync(ChatGptSessionHost.BridgeScriptForTesting);
            core.SetVirtualHostNameToFolderMapping("chatgpt.com", siteDirectory, CoreWebView2HostResourceAccessKind.Allow);
            core.Navigate("https://chatgpt.com/index.html");

            try
            {
                await bridgeReady.Task.WaitAsync(TimeSpan.FromSeconds(15));
            }
            catch (TimeoutException)
            {
                failures.Add("Bridge script did not report both a ready chat surface and the fixture assistant tool call.");
            }

            var sendResult = await core.ExecuteScriptAsync("window.__pcBuddySend && window.__pcBuddySend('PC_BUDDY_DOM_SMOKE_TEXT')");
            if (!string.Equals(sendResult, "true", StringComparison.OrdinalIgnoreCase))
                failures.Add("Bridge send function was not installed or rejected the fixture prompt.");

            await Task.Delay(450);
            var sentRaw = await core.ExecuteScriptAsync("document.body.dataset.sent || ''");
            var sent = JsonSerializer.Deserialize<string>(sentRaw) ?? string.Empty;
            sendInjected = sent.Contains("PC_BUDDY_DOM_SMOKE_TEXT", StringComparison.Ordinal);
            if (!sendInjected) failures.Add("Bridge send function did not drive the fixture prompt/send button.");

            var hiddenRaw = await core.ExecuteScriptAsync("getComputedStyle(document.querySelector('[data-message-author-role=\"user\"]')).display");
            var hidden = JsonSerializer.Deserialize<string>(hiddenRaw) ?? string.Empty;
            internalHidden = string.Equals(hidden, "none", StringComparison.OrdinalIgnoreCase);
            if (!internalHidden) failures.Add("Internal PC Buddy bootstrap chatter was not hidden by the bridge script.");
        }
        catch (Exception ex)
        {
            failures.Add(ex.ToString());
        }
        finally
        {
            try { webView?.Dispose(); } catch { }
            try { window?.Close(); } catch { }
            try { if (Directory.Exists(siteDirectory)) Directory.Delete(siteDirectory, true); } catch { }
            try { if (Directory.Exists(profileDirectory)) Directory.Delete(profileDirectory, true); } catch { }
        }

        var receipt = new
        {
            app = "PC Buddy Portable",
            version = "0.3.0-session",
            timestampUtc = DateTimeOffset.UtcNow,
            passed = failures.Count == 0,
            sessionStateObserved,
            toolCallObserved,
            sendInjected,
            internalHidden,
            failures
        };
        await File.WriteAllTextAsync(receiptPath, JsonSerializer.Serialize(receipt, new JsonSerializerOptions { WriteIndented = true }));
        return failures.Count == 0 ? 0 : 1;
    }

    private const string FixtureHtml = """
<!doctype html>
<html>
<head><meta charset="utf-8"><title>PC Buddy DOM fixture</title></head>
<body>
  <main>
    <div id="prompt-textarea" contenteditable="true"></div>
    <button data-testid="send-button" onclick="document.body.dataset.sent = document.getElementById('prompt-textarea').innerText">Send</button>
    <div data-message-author-role="user">[PC BUDDY BOOTSTRAP] hidden fixture</div>
    <div data-message-author-role="assistant"><pc-buddy-call>{"nonce":"fixture","id":"dom-smoke-call","tool":"pc_status","args":{}}</pc-buddy-call></div>
  </main>
</body>
</html>
""";
}
