using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace PCBuddy.Core;

public sealed class ChatGptSessionHost : IDisposable
{
    private readonly WebView2 _webView;
    private readonly ToolBroker _tools;
    private readonly string _profileDirectory;
    private readonly Action<string, bool> _status;
    private readonly Action<string, string, bool> _activity;
    private readonly HashSet<string> _completedCalls = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim _primeGate = new(1, 1);
    private CancellationTokenSource _sessionCts = new();
    private string _nonce = ChatGptBridgeProtocol.CreateNonce();
    private string _conversationKey = string.Empty;
    private bool _primed;
    private bool _ready;
    private bool _disposed;

    public ChatGptSessionHost(WebView2 webView, ToolBroker tools, string dataDirectory,
        Action<string, bool> status, Action<string, string, bool> activity)
    {
        _webView = webView;
        _tools = tools;
        _profileDirectory = Path.Combine(dataDirectory, "chatgpt-session");
        _status = status;
        _activity = activity;
    }

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(_profileDirectory);
        _status("Starting ChatGPT session…", false);

        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: _profileDirectory);
        await _webView.EnsureCoreWebView2Async(environment);
        var core = _webView.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreDefaultScriptDialogsEnabled = true;
        core.WebMessageReceived += Core_WebMessageReceived;
        core.NavigationCompleted += Core_NavigationCompleted;
        await core.AddScriptToExecuteOnDocumentCreatedAsync(BridgeScript);
        core.Navigate("https://chatgpt.com/");
    }

    public void Reload() => _webView.CoreWebView2?.Reload();

    public void NewBuddyChat()
    {
        ResetConversationState();
        _ready = false;
        _conversationKey = string.Empty;
        _status("Opening a fresh ChatGPT conversation…", false);
        _webView.CoreWebView2?.Navigate("https://chatgpt.com/");
    }

    private void ResetConversationState()
    {
        _sessionCts.Cancel();
        _sessionCts.Dispose();
        _sessionCts = new CancellationTokenSource();
        _nonce = ChatGptBridgeProtocol.CreateNonce();
        _primed = false;
        _completedCalls.Clear();
    }

    private void Core_NavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (!e.IsSuccess)
            _status($"ChatGPT page failed to load ({e.WebErrorStatus}).", false);
    }

    private async void Core_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (_disposed) return;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            if (!root.TryGetProperty("type", out var typeValue) || typeValue.ValueKind != JsonValueKind.String) return;
            var type = typeValue.GetString();

            if (type == "session_state")
            {
                _ready = root.TryGetProperty("ready", out var readyValue) && readyValue.ValueKind == JsonValueKind.True;
                var url = root.TryGetProperty("url", out var urlValue) ? urlValue.GetString() ?? string.Empty : string.Empty;
                var key = root.TryGetProperty("conversationKey", out var keyValue) && keyValue.ValueKind == JsonValueKind.String
                    ? keyValue.GetString() ?? string.Empty
                    : string.Empty;

                ObserveConversationKey(key);

                if (_ready)
                {
                    _status(_primed ? "ChatGPT + local bridge ready" : "ChatGPT signed in — arming local bridge…", true);
                    if (!_primed) await EnsurePrimedAsync();
                }
                else
                {
                    _status(url.Contains("chatgpt.com", StringComparison.OrdinalIgnoreCase)
                        ? "Sign in to ChatGPT in this window once. No API credits are used."
                        : "Complete ChatGPT sign-in in this window.", false);
                }
                return;
            }

            if (type != "tool_call" || !root.TryGetProperty("call", out var callElement)) return;
            if (!_primed)
            {
                _activity("chatgpt_bridge", "ignored a tool marker before this conversation was armed", false);
                return;
            }

            if (!ChatGptBridgeProtocol.TryParseToolCall(callElement, _nonce, out var call, out var error) || call is null)
            {
                _activity("chatgpt_bridge", error, false);
                return;
            }

            if (!_completedCalls.Add(call.Id)) return;
            _activity(call.Tool, $"requested by ChatGPT session ({call.Id})", true);

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(_sessionCts.Token);
            timeout.CancelAfter(TimeSpan.FromSeconds(60));
            var output = await _tools.ExecuteAsync(call.Tool, call.Args, timeout.Token);
            var resultMessage = ChatGptBridgeProtocol.BuildToolResult(call.Id, call.Tool, output);
            var delivered = await SendTextAsync(resultMessage);
            _activity(call.Tool, delivered ? "result returned to ChatGPT" : "could not return result to ChatGPT", delivered);
            if (!delivered) _status("Local tool ran, but ChatGPT's message box could not be controlled. Reload ChatGPT.", false);
        }
        catch (OperationCanceledException)
        {
            _activity("chatgpt_bridge", "local bridge operation cancelled", false);
        }
        catch (Exception ex)
        {
            _activity("chatgpt_bridge", ex.Message, false);
            _status($"ChatGPT bridge error: {ex.Message}", false);
        }
    }

    private void ObserveConversationKey(string key)
    {
        if (string.IsNullOrWhiteSpace(key)) return;
        if (string.IsNullOrWhiteSpace(_conversationKey))
        {
            _conversationKey = key;
            return;
        }

        if (string.Equals(_conversationKey, key, StringComparison.Ordinal)) return;

        // The first bootstrap message turns the blank '/' route into '/c/<id>'.
        // That is the same conversation, not a reason to inject a second bootstrap.
        if (_primed && _conversationKey == "/" && key.StartsWith("/c/", StringComparison.Ordinal))
        {
            _conversationKey = key;
            return;
        }

        _conversationKey = key;
        if (_primed)
        {
            ResetConversationState();
            _activity("chatgpt_session", "conversation changed; local bridge nonce rotated", true);
        }
    }

    private async Task EnsurePrimedAsync()
    {
        if (_primed || !_ready) return;
        await _primeGate.WaitAsync();
        try
        {
            if (_primed || !_ready) return;
            var bootstrap = ChatGptBridgeProtocol.BuildBootstrap(_nonce, _tools.GetToolDefinitions());
            if (await SendTextAsync(bootstrap))
            {
                _primed = true;
                _activity("chatgpt_session", "local bridge armed for this conversation", true);
                _status("ChatGPT + local bridge ready", true);
            }
            else
            {
                _status("ChatGPT is open, but Buddy could not arm the local bridge. Click Reload ChatGPT.", false);
            }
        }
        finally
        {
            _primeGate.Release();
        }
    }

    private async Task<bool> SendTextAsync(string text)
    {
        if (_webView.CoreWebView2 is null) return false;
        var arg = JsonSerializer.Serialize(text);
        var raw = await _webView.CoreWebView2.ExecuteScriptAsync($"window.__pcBuddySend && window.__pcBuddySend({arg})");
        return string.Equals(raw, "true", StringComparison.OrdinalIgnoreCase);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _sessionCts.Cancel();
        _sessionCts.Dispose();
        _primeGate.Dispose();
        if (_webView.CoreWebView2 is not null)
        {
            _webView.CoreWebView2.WebMessageReceived -= Core_WebMessageReceived;
            _webView.CoreWebView2.NavigationCompleted -= Core_NavigationCompleted;
        }
        _webView.Dispose();
    }

    internal static string BridgeScriptForTesting => BridgeScript;

    private const string BridgeScript = """
(() => {
  if (location.hostname !== 'chatgpt.com' || window.__pcBuddyInstalled) return;
  window.__pcBuddyInstalled = true;
  const postedCalls = new Set();
  let scanTimer = 0;

  function promptElement() {
    return document.querySelector('#prompt-textarea') ||
           document.querySelector('textarea[data-testid="prompt-textarea"]') ||
           document.querySelector('[contenteditable="true"][data-virtualkeyboard="true"]') ||
           document.querySelector('main [contenteditable="true"]');
  }

  function sendButton() {
    return document.querySelector('button[data-testid="send-button"]') ||
           document.querySelector('button[aria-label*="Send"]') ||
           document.querySelector('button[aria-label*="send"]');
  }

  function setPromptText(el, text) {
    el.focus();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, text); else el.value = text;
    } else {
      el.replaceChildren();
      const p = document.createElement('p');
      p.textContent = text;
      el.appendChild(p);
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  window.__pcBuddySend = function(text) {
    const el = promptElement();
    if (!el) return false;
    setPromptText(el, text);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const button = sendButton();
      if (button && !button.disabled) {
        button.click();
      } else {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
    }));
    return true;
  };

  function hideInternalMessages() {
    document.querySelectorAll('[data-message-author-role="user"]').forEach(node => {
      const text = node.innerText || '';
      if (text.includes('[PC BUDDY BOOTSTRAP]') || text.includes('[PC BUDDY TOOL RESULT]')) node.style.display = 'none';
    });
    document.querySelectorAll('[data-message-author-role="assistant"]').forEach(node => {
      const text = node.innerText || '';
      if (text.includes('[PC BUDDY READY]') || text.includes('[PC_BUDDY_CALL]') || node.querySelector('pc-buddy-call')) node.style.display = 'none';
    });
  }

  function postCall(raw) {
    try {
      const call = JSON.parse(raw);
      const key = String(call.id || '') + '|' + String(call.nonce || '');
      if (!key || postedCalls.has(key)) return;
      postedCalls.add(key);
      chrome.webview.postMessage({ type: 'tool_call', call });
    } catch (_) { }
  }

  function scanAssistantCalls() {
    document.querySelectorAll('[data-message-author-role="assistant"]').forEach(node => {
      const text = node.innerText || '';
      const regex = /\[PC_BUDDY_CALL\]([\s\S]*?)\[\/PC_BUDDY_CALL\]/gi;
      let match;
      while ((match = regex.exec(text)) !== null) postCall(match[1]);

      // Fallback for renderers that materialize a custom element instead of visible sentinel text.
      node.querySelectorAll('pc-buddy-call').forEach(element => postCall(element.textContent || ''));
    });
  }

  function postState() {
    try {
      chrome.webview.postMessage({
        type: 'session_state',
        ready: !!promptElement(),
        url: location.href,
        title: document.title,
        conversationKey: location.pathname
      });
    } catch (_) { }
  }

  function scan() {
    hideInternalMessages();
    scanAssistantCalls();
    postState();
  }

  const observer = new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 180);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setInterval(postState, 2500);
  scan();
})();
""";
}
