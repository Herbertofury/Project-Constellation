using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace PCBuddy.Core;

public sealed class OpenAiBuddyClient
{
    private static readonly Uri ResponsesUri = new("https://api.openai.com/v1/responses");
    private static readonly Uri SolModelUri = new("https://api.openai.com/v1/models/gpt-5.6-sol");
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromMinutes(5) };
    private readonly ToolBroker _tools;
    private string? _previousResponseId;

    public event Action<string?>? ConversationAdvanced;

    public OpenAiBuddyClient(ToolBroker tools, string? previousResponseId = null)
    {
        _tools = tools;
        _previousResponseId = previousResponseId;
    }

    public void ResetConversation()
    {
        _previousResponseId = null;
        ConversationAdvanced?.Invoke(null);
    }

    public async Task<(bool Ok, string Message)> ValidateKeyAsync(string key, CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, SolModelUri);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key.Trim());
        try
        {
            using var response = await _http.SendAsync(request, ct);
            if (response.IsSuccessStatusCode) return (true, "GPT-5.6 Sol is ready.");
            var body = await response.Content.ReadAsStringAsync(ct);
            return (false, FriendlyHttpError(response.StatusCode, body));
        }
        catch (Exception ex) { return (false, ex.Message); }
    }

    public async Task<string> SendAsync(string apiKey, string userText, AppSettings settings, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(apiKey)) throw new InvalidOperationException("OpenAI API key is not configured.");
        if (string.IsNullOrWhiteSpace(userText)) throw new ArgumentException("Message is empty.");

        object input = userText.Trim();
        string? previous = _previousResponseId;

        for (var round = 0; round < 8; round++)
        {
            ct.ThrowIfCancellationRequested();
            var toolDefs = new List<object>(_tools.GetToolDefinitions());
            if (settings.WebSearchEnabled)
                toolDefs.Add(new Dictionary<string, object?> { ["type"] = "web_search" });

            var payload = new Dictionary<string, object?>
            {
                ["model"] = settings.Model,
                ["reasoning"] = new Dictionary<string, object?> { ["effort"] = settings.ReasoningEffort },
                ["instructions"] = BuildInstructions(settings),
                ["input"] = input,
                ["tools"] = toolDefs,
                ["tool_choice"] = "auto",
                ["parallel_tool_calls"] = true,
                ["store"] = true,
                ["max_output_tokens"] = 8192
            };
            if (!string.IsNullOrWhiteSpace(previous)) payload["previous_response_id"] = previous;

            using var json = await PostResponseAsync(apiKey, payload, ct);
            var root = json.RootElement;
            if (root.TryGetProperty("error", out var apiError) && apiError.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined)
                throw new InvalidOperationException(apiError.TryGetProperty("message", out var msg) ? msg.GetString() : apiError.ToString());

            var responseId = root.GetProperty("id").GetString() ?? throw new InvalidOperationException("OpenAI response did not contain an id.");
            var calls = new List<(string CallId, string Name, JsonElement Args)>();
            if (root.TryGetProperty("output", out var output) && output.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in output.EnumerateArray())
                {
                    if (!item.TryGetProperty("type", out var type) || type.GetString() != "function_call") continue;
                    var callId = item.GetProperty("call_id").GetString() ?? throw new InvalidOperationException("Function call had no call_id.");
                    var name = item.GetProperty("name").GetString() ?? throw new InvalidOperationException("Function call had no name.");
                    var arguments = item.TryGetProperty("arguments", out var argText) ? argText.GetString() ?? "{}" : "{}";
                    using var argsDoc = JsonDocument.Parse(arguments);
                    calls.Add((callId, name, argsDoc.RootElement.Clone()));
                }
            }

            if (calls.Count == 0)
            {
                _previousResponseId = responseId;
                ConversationAdvanced?.Invoke(responseId);
                var text = ExtractText(root);
                return string.IsNullOrWhiteSpace(text) ? "Done." : text;
            }

            var outputs = new List<Dictionary<string, object?>>(calls.Count);
            foreach (var call in calls)
            {
                var localOutput = await _tools.ExecuteAsync(call.Name, call.Args, ct);
                outputs.Add(new Dictionary<string, object?>
                {
                    ["type"] = "function_call_output",
                    ["call_id"] = call.CallId,
                    ["output"] = localOutput
                });
            }
            previous = responseId;
            input = outputs;
        }

        throw new InvalidOperationException("The assistant exceeded the local-tool round limit. Start a new message and try again.");
    }

    private async Task<JsonDocument> PostResponseAsync(string key, Dictionary<string, object?> payload, CancellationToken ct)
    {
        var body = JsonSerializer.Serialize(payload);
        for (var attempt = 0; attempt < 2; attempt++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, ResponsesUri);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key.Trim());
            request.Content = new StringContent(body, Encoding.UTF8, "application/json");
            using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseContentRead, ct);
            var text = await response.Content.ReadAsStringAsync(ct);
            if (response.IsSuccessStatusCode) return JsonDocument.Parse(text);
            if (attempt == 0 && ((int)response.StatusCode == 429 || (int)response.StatusCode >= 500))
            {
                await Task.Delay(900, ct);
                continue;
            }
            throw new InvalidOperationException(FriendlyHttpError(response.StatusCode, text));
        }
        throw new InvalidOperationException("OpenAI request failed after retry.");
    }

    private static string BuildInstructions(AppSettings settings) =>
        "You are PC Buddy, a persistent Windows desktop companion. Be useful, concise, and technically precise. " +
        "You have explicitly bounded local tools supplied by the PC Buddy app. Use them when the user asks about this computer, files, running apps, or diagnostics. " +
        "Never claim that a local operation succeeded unless a tool result confirms it. Never invent local files, windows, processes, or command output. " +
        "Respect the app's access policy and emergency lock. Local file tools are read-only in this build. " +
        (settings.WebSearchEnabled ? "Web search is enabled when current information is useful." : "Web search is disabled by the user.");

    private static string ExtractText(JsonElement root)
    {
        if (root.TryGetProperty("output_text", out var direct) && direct.ValueKind == JsonValueKind.String)
            return direct.GetString() ?? string.Empty;
        var sb = new StringBuilder();
        if (!root.TryGetProperty("output", out var output) || output.ValueKind != JsonValueKind.Array) return string.Empty;
        foreach (var item in output.EnumerateArray())
        {
            if (!item.TryGetProperty("type", out var t) || t.GetString() != "message") continue;
            if (!item.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.Array) continue;
            foreach (var part in content.EnumerateArray())
            {
                if (part.TryGetProperty("type", out var pt) && pt.GetString() == "output_text" && part.TryGetProperty("text", out var text))
                {
                    if (sb.Length > 0) sb.AppendLine();
                    sb.Append(text.GetString());
                }
            }
        }
        return sb.ToString();
    }

    private static string FriendlyHttpError(HttpStatusCode status, string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("error", out var error) && error.TryGetProperty("message", out var message))
                return $"OpenAI {(int)status}: {message.GetString()}";
        }
        catch { }
        return $"OpenAI request failed with HTTP {(int)status} ({status}).";
    }
}
