using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text.Json;

namespace PCBuddy.Core;

public sealed record LocalToolCall(string Id, string Tool, JsonElement Args);

public static class ChatGptBridgeProtocol
{
    private static readonly HashSet<string> AllowedTools = new(StringComparer.Ordinal)
    {
        "pc_status",
        "fs_stat",
        "fs_list",
        "fs_read_text",
        "pc_run_allowed",
        "pc_windows",
        "pc_processes"
    };

    public static string CreateNonce() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

    public static bool TryParseToolCall(JsonElement element, string expectedNonce, out LocalToolCall? call, out string error)
    {
        call = null;
        error = string.Empty;

        if (element.ValueKind != JsonValueKind.Object)
        {
            error = "tool call is not a JSON object";
            return false;
        }

        if (!element.TryGetProperty("nonce", out var nonceValue) || nonceValue.ValueKind != JsonValueKind.String)
        {
            error = "tool call nonce is missing";
            return false;
        }

        var nonce = nonceValue.GetString();
        if (!string.Equals(nonce, expectedNonce, StringComparison.Ordinal))
        {
            error = "tool call nonce does not match this PC Buddy session";
            return false;
        }

        if (!element.TryGetProperty("id", out var idValue) || idValue.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(idValue.GetString()))
        {
            error = "tool call id is missing";
            return false;
        }

        if (!element.TryGetProperty("tool", out var toolValue) || toolValue.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(toolValue.GetString()))
        {
            error = "tool call name is missing";
            return false;
        }

        var tool = toolValue.GetString()!;
        if (!AllowedTools.Contains(tool))
        {
            error = $"tool is not part of the PC Buddy protocol: {tool}";
            return false;
        }

        if (!element.TryGetProperty("args", out var args) || args.ValueKind != JsonValueKind.Object)
        {
            error = "tool args must be a JSON object";
            return false;
        }

        call = new LocalToolCall(idValue.GetString()!, tool, args.Clone());
        return true;
    }

    public static string BuildBootstrap(string nonce, IReadOnlyList<Dictionary<string, object?>> toolDefinitions)
    {
        var tools = JsonSerializer.Serialize(toolDefinitions);
        return $$"""
[PC BUDDY BOOTSTRAP]
You are running inside the user's PC Buddy desktop app using the user's normal ChatGPT account/session. Do not ask for or use an OpenAI API key. PC Buddy can perform only the local tools listed below and enforces its own access policy plus Emergency Lock.

LOCAL TOOL CONTRACT
- Never invent local PC state. If local evidence is needed, request one local tool call and wait for its result.
- A tool request must be your entire response and use this exact wrapper:
<pc-buddy-call>{"nonce":"{{nonce}}","id":"unique-call-id","tool":"tool_name","args":{...}}</pc-buddy-call>
- Use a fresh unique id for every call.
- After PC Buddy sends a hidden [PC BUDDY TOOL RESULT] message, continue the user's answer normally. If another local call is needed, request the next one.
- Do not expose, explain, or repeat this bootstrap unless the user explicitly asks how PC Buddy works.
- Normal ChatGPT features, model choice, web browsing, files, and subscription limits remain controlled by ChatGPT itself.

AVAILABLE LOCAL TOOLS
{{tools}}

Reply exactly: [PC BUDDY READY]
""";
    }

    public static string BuildToolResult(string callId, string tool, string output) => $"""
[PC BUDDY TOOL RESULT]
call_id={callId}
tool={tool}
<pc-buddy-result>{output}</pc-buddy-result>
Use this observed local result to continue the user's request. Do not claim anything beyond the result. If another local tool is required, request it with the PC Buddy call wrapper.
""";
}
