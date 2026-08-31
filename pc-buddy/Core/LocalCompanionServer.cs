using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace PCBuddy.Core;

public sealed class LocalCompanionServer : IAsyncDisposable
{
    public const int DefaultPort = 17342;
    public const string ExtensionId = "geljambmkfjkhodgkpjhnmfojkpcamig";
    private const int MaxHeaderBytes = 32 * 1024;
    private const int MaxBodyBytes = 1024 * 1024;
    private static readonly TimeSpan SessionLifetime = TimeSpan.FromMinutes(45);
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private readonly ToolBroker _tools;
    private readonly Func<AppSettings> _settings;
    private readonly Action<string, string, bool> _activity;
    private readonly ConcurrentDictionary<string, BrowserSession> _sessions = new(StringComparer.Ordinal);
    private readonly CancellationTokenSource _shutdown = new();
    private TcpListener? _listener;
    private Task? _acceptLoop;

    public int Port { get; }
    public bool IsRunning => _listener is not null;

    public LocalCompanionServer(ToolBroker tools, Func<AppSettings> settings, Action<string, string, bool> activity, int port = DefaultPort)
    {
        _tools = tools;
        _settings = settings;
        _activity = activity;
        Port = port;
    }

    public Task StartAsync()
    {
        if (_listener is not null) return Task.CompletedTask;
        if (!_settings().AllowBrowserCompanion)
        {
            _activity("browser_companion", "disabled by Access policy", true);
            return Task.CompletedTask;
        }

        _listener = new TcpListener(IPAddress.Loopback, Port);
        _listener.Start(32);
        _acceptLoop = AcceptLoopAsync(_shutdown.Token);
        _activity("browser_companion", $"listening on 127.0.0.1:{Port}", true);
        return Task.CompletedTask;
    }

    private async Task AcceptLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested && _listener is not null)
        {
            TcpClient? client = null;
            try
            {
                client = await _listener.AcceptTcpClientAsync(cancellationToken);
                _ = HandleClientSafelyAsync(client, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            catch (ObjectDisposedException) when (cancellationToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                client?.Dispose();
                _activity("browser_companion", $"accept failed: {ex.Message}", false);
                await Task.Delay(250, cancellationToken).ConfigureAwait(false);
            }
        }
    }

    private async Task HandleClientSafelyAsync(TcpClient client, CancellationToken cancellationToken)
    {
        using (client)
        {
            client.NoDelay = true;
            await using var stream = client.GetStream();
            try
            {
                var request = await ReadRequestAsync(stream, cancellationToken).ConfigureAwait(false);
                var response = await RouteAsync(request, cancellationToken).ConfigureAwait(false);
                await WriteResponseAsync(stream, response, cancellationToken).ConfigureAwait(false);
            }
            catch (RequestException ex)
            {
                try { await WriteResponseAsync(stream, JsonResponse(ex.StatusCode, new { ok = false, error = ex.Message }), cancellationToken).ConfigureAwait(false); } catch { }
            }
            catch (Exception ex)
            {
                _activity("browser_companion", ex.Message, false);
                try { await WriteResponseAsync(stream, JsonResponse(500, new { ok = false, error = "local companion request failed" }), cancellationToken).ConfigureAwait(false); } catch { }
            }
        }
    }

    private async Task<HttpResponse> RouteAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        if (!request.Headers.TryGetValue("x-project-constellation-client", out var clientId) ||
            !string.Equals(clientId, ExtensionId, StringComparison.Ordinal))
            throw new RequestException(403, "untrusted Project Constellation browser client");

        if (!_settings().AllowBrowserCompanion)
            throw new RequestException(403, "browser companion is disabled in Project Constellation Access settings");

        if (request.Method == "GET" && request.Path == "/v1/health")
        {
            var settings = _settings();
            return JsonResponse(200, new
            {
                ok = true,
                app = "Project Constellation",
                version = "0.4.0-constellation",
                transport = "loopback_browser_companion",
                port = Port,
                locked = settings.EmergencyLocked,
                tools = _tools.GetToolDefinitions().Select(tool => tool.TryGetValue("name", out var name) ? name : null).Where(name => name is not null).ToArray()
            });
        }

        if (request.Method == "POST" && request.Path == "/v1/session")
        {
            PruneSessions();
            using var doc = ParseJsonBody(request);
            var root = doc.RootElement;
            var conversationKey = ReadOptionalString(root, "conversationKey", 512);
            var tabKey = ReadOptionalString(root, "tabKey", 128);
            var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
            var nonce = ChatGptBridgeProtocol.CreateNonce();
            var expiresAt = DateTimeOffset.UtcNow.Add(SessionLifetime);
            var session = new BrowserSession(token, nonce, conversationKey, tabKey, expiresAt);
            _sessions[token] = session;
            var tools = _tools.GetToolDefinitions();
            var context = ChatGptBridgeProtocol.BuildExternalContext(nonce, tools);
            _activity("browser_companion", $"armed browser session {Short(token)} for {conversationKey}", true);
            return JsonResponse(200, new
            {
                ok = true,
                sessionId = Short(token, 24),
                sessionToken = token,
                nonce,
                expiresAtUtc = expiresAt,
                context,
                tools
            });
        }

        if (request.Method == "POST" && request.Path == "/v1/tool")
        {
            var token = ReadBearer(request.Headers);
            if (!_sessions.TryGetValue(token, out var session) || session.ExpiresAtUtc <= DateTimeOffset.UtcNow)
            {
                _sessions.TryRemove(token, out _);
                throw new RequestException(401, "Project Constellation browser session expired");
            }

            using var doc = ParseJsonBody(request);
            var root = doc.RootElement;
            if (!root.TryGetProperty("call", out var callElement))
                throw new RequestException(400, "missing tool call");
            if (!ChatGptBridgeProtocol.TryParseToolCall(callElement, session.Nonce, out var call, out var parseError) || call is null)
                throw new RequestException(400, parseError);
            if (!session.CompletedCalls.TryAdd(call.Id, 0))
                throw new RequestException(409, "duplicate tool call id");

            session.ExpiresAtUtc = DateTimeOffset.UtcNow.Add(SessionLifetime);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _shutdown.Token);
            timeout.CancelAfter(TimeSpan.FromSeconds(60));
            var output = await _tools.ExecuteAsync(call.Tool, call.Args, timeout.Token).ConfigureAwait(false);
            _activity(call.Tool, $"browser ChatGPT request {call.Id}", true);
            return JsonResponse(200, new
            {
                ok = true,
                callId = call.Id,
                tool = call.Tool,
                output,
                toolResultMessage = ChatGptBridgeProtocol.BuildToolResult(call.Id, call.Tool, output)
            });
        }

        throw new RequestException(404, "unknown Project Constellation local companion route");
    }

    private static JsonDocument ParseJsonBody(HttpRequest request)
    {
        if (request.Body.Length == 0) return JsonDocument.Parse("{}");
        try { return JsonDocument.Parse(request.Body); }
        catch (JsonException) { throw new RequestException(400, "invalid JSON body"); }
    }

    private static string ReadOptionalString(JsonElement root, string name, int maxLength)
    {
        if (!root.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String) return string.Empty;
        var text = value.GetString() ?? string.Empty;
        return text.Length <= maxLength ? text : text[..maxLength];
    }

    private static string ReadBearer(IReadOnlyDictionary<string, string> headers)
    {
        if (!headers.TryGetValue("authorization", out var authorization) || !authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            throw new RequestException(401, "missing browser companion session token");
        var token = authorization[7..].Trim();
        if (token.Length < 32) throw new RequestException(401, "invalid browser companion session token");
        return token;
    }

    private void PruneSessions()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var pair in _sessions)
            if (pair.Value.ExpiresAtUtc <= now) _sessions.TryRemove(pair.Key, out _);
    }

    private static string Short(string value, int length = 10) => value.Length <= length ? value : value[..length];

    private static async Task<HttpRequest> ReadRequestAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        var buffer = new byte[8192];
        using var received = new MemoryStream();
        var headerEnd = -1;
        while (headerEnd < 0)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken).ConfigureAwait(false);
            if (read <= 0) throw new RequestException(400, "empty HTTP request");
            received.Write(buffer, 0, read);
            if (received.Length > MaxHeaderBytes + MaxBodyBytes) throw new RequestException(413, "request too large");
            headerEnd = FindHeaderEnd(received.GetBuffer(), (int)received.Length);
            if (headerEnd < 0 && received.Length > MaxHeaderBytes) throw new RequestException(431, "request headers too large");
        }

        var all = received.ToArray();
        var headerText = Encoding.ASCII.GetString(all, 0, headerEnd);
        var lines = headerText.Split("\r\n", StringSplitOptions.None);
        var requestLine = lines.FirstOrDefault()?.Split(' ', StringSplitOptions.RemoveEmptyEntries) ?? Array.Empty<string>();
        if (requestLine.Length < 2) throw new RequestException(400, "invalid HTTP request line");
        var method = requestLine[0].ToUpperInvariant();
        var path = requestLine[1].Split('?', 2)[0];
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in lines.Skip(1))
        {
            var colon = line.IndexOf(':');
            if (colon <= 0) continue;
            headers[line[..colon].Trim().ToLowerInvariant()] = line[(colon + 1)..].Trim();
        }

        var contentLength = 0;
        if (headers.TryGetValue("content-length", out var rawLength) && (!int.TryParse(rawLength, out contentLength) || contentLength < 0 || contentLength > MaxBodyBytes))
            throw new RequestException(413, "invalid or oversized request body");

        var bodyOffset = headerEnd + 4;
        var body = new byte[contentLength];
        var copied = Math.Min(contentLength, all.Length - bodyOffset);
        if (copied > 0) Buffer.BlockCopy(all, bodyOffset, body, 0, copied);
        while (copied < contentLength)
        {
            var read = await stream.ReadAsync(body.AsMemory(copied, contentLength - copied), cancellationToken).ConfigureAwait(false);
            if (read <= 0) throw new RequestException(400, "request body ended early");
            copied += read;
        }
        return new HttpRequest(method, path, headers, body);
    }

    private static int FindHeaderEnd(byte[] bytes, int length)
    {
        for (var i = 0; i <= length - 4; i++)
            if (bytes[i] == 13 && bytes[i + 1] == 10 && bytes[i + 2] == 13 && bytes[i + 3] == 10) return i;
        return -1;
    }

    private static async Task WriteResponseAsync(NetworkStream stream, HttpResponse response, CancellationToken cancellationToken)
    {
        var reason = response.StatusCode switch
        {
            200 => "OK",
            400 => "Bad Request",
            401 => "Unauthorized",
            403 => "Forbidden",
            404 => "Not Found",
            409 => "Conflict",
            413 => "Payload Too Large",
            431 => "Request Header Fields Too Large",
            _ => "Internal Server Error"
        };
        var header = $"HTTP/1.1 {response.StatusCode} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {response.Body.Length}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n";
        await stream.WriteAsync(Encoding.ASCII.GetBytes(header), cancellationToken).ConfigureAwait(false);
        await stream.WriteAsync(response.Body, cancellationToken).ConfigureAwait(false);
        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    private static HttpResponse JsonResponse(int statusCode, object payload) =>
        new(statusCode, JsonSerializer.SerializeToUtf8Bytes(payload, Json));

    public async ValueTask DisposeAsync()
    {
        if (_shutdown.IsCancellationRequested) return;
        _shutdown.Cancel();
        try { _listener?.Stop(); } catch { }
        _listener = null;
        if (_acceptLoop is not null)
        {
            try { await _acceptLoop.ConfigureAwait(false); } catch { }
        }
        _sessions.Clear();
        _shutdown.Dispose();
    }

    private sealed class BrowserSession
    {
        public string Token { get; }
        public string Nonce { get; }
        public string ConversationKey { get; }
        public string TabKey { get; }
        public DateTimeOffset ExpiresAtUtc { get; set; }
        public ConcurrentDictionary<string, byte> CompletedCalls { get; } = new(StringComparer.Ordinal);

        public BrowserSession(string token, string nonce, string conversationKey, string tabKey, DateTimeOffset expiresAtUtc)
        {
            Token = token;
            Nonce = nonce;
            ConversationKey = conversationKey;
            TabKey = tabKey;
            ExpiresAtUtc = expiresAtUtc;
        }
    }

    private sealed record HttpRequest(string Method, string Path, Dictionary<string, string> Headers, byte[] Body);
    private sealed record HttpResponse(int StatusCode, byte[] Body);

    private sealed class RequestException : Exception
    {
        public int StatusCode { get; }
        public RequestException(int statusCode, string message) : base(message) => StatusCode = statusCode;
    }
}
