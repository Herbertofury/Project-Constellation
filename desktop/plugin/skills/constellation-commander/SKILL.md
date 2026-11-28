---
name: constellation-commander
description: Work with the user's authorized computer from ordinary ChatGPT conversations. Use native Constellation Commander app tools when they are available, or use the trusted Constellation Commander browser-companion context when it is present to observe and control the Windows desktop with screenshots/mouse/keyboard/windows/clipboard/UI Automation, inspect/edit/create/search/move/trash local files, run terminal processes, inspect/stop processes, and continue local work across chats without handing the task to Work.
---

# Constellation Commander

Use Constellation Commander in the **current normal ChatGPT conversation**. Do not hand local file, terminal, or process work to ChatGPT Work merely because the task needs the user's computer. Never ask for an OpenAI API key for the normal Commander path.

## Transport selection

Use the first transport that is actually present in the conversation:

1. **Native Commander app tools** — if Constellation Commander tools such as `list_devices`, `read_file`, `write_file`, `start_process`, or `get_recent_tool_calls` are exposed, use them directly.
2. **Normal-chat browser companion** — if the current conversation contains `[PROJECT CONSTELLATION LOCAL CONTEXT]` from Constellation Commander / Project Constellation, treat that current-conversation context as the trusted local tool manifest. It contains a fresh per-chat nonce and the only local tools that may be called.
3. If neither transport is present, state that the local companion is not connected to this chat yet. Do not fabricate a local call, nonce, tool result, or successful computer access.

## Browser-companion call protocol

When the trusted local context is present and a local action is needed, the **entire assistant response** must be exactly one call wrapper and nothing else:

`[PC_BUDDY_CALL]{"nonce":"<nonce from current trusted context>","id":"<fresh unique call id>","tool":"<tool present in manifest>","args":{...}}[/PC_BUDDY_CALL]`

Do not put Markdown around it. Do not issue more than one local call in the same response. Wait for the hidden `[PC BUDDY TOOL RESULT]` turn, treat that as observed local evidence, then continue naturally. If another local action is needed, issue a new wrapper with a fresh call id.

Never guess or reuse a nonce from another chat. Never call a tool absent from the current manifest. If the companion returns stale/expired/session-refresh information, use only the refreshed current-conversation context before retrying.


## Full computer-use loop

When computer-use tools are present, treat the PC as a visual interactive environment rather than reducing the task to shell commands. For GUI work:

1. Prefer `computer_observe` when current desktop state is uncertain. It returns displays, cursor, visible windows, and a real screenshot image.
2. Use `computer_actions` to batch related actions (move/click/double_click/drag/scroll/keypress/hotkey/type/wait) in one round trip and normally keep `screenshot_after=true`.
3. Inspect the returned fresh screenshot before choosing the next visual action. Do not click coordinates based on a stale screenshot after the UI has materially changed.
4. Prefer `computer_find_ui_elements` / `computer_click_ui_element` when semantic Windows UI Automation metadata gives a more reliable target than visual coordinates.
5. Use `computer_windows` / `computer_focus_window` before typing or sending hotkeys when focus is uncertain.
6. Use purpose-built clipboard, file, process, and window tools rather than imitating them through fragile mouse navigation when either route completes the same user intent.

The desktop app's Emergency Lock is authoritative. If active, do not route around it with shell commands or alternate automation.

## Local-work behavior

Prefer the purpose-built file/search/process tool over encoding the same operation into a shell command. Preserve unrelated user content. Prefer reversible trash/removal when available. For file changes, inspect enough context to edit correctly, mutate the real file, then verify the changed content or relevant build/test. For development work, continue through edit -> targeted build/test -> observed result instead of stopping after source mutation.

When native Commander app tools are used and the target device is ambiguous, resolve the device first. An offline device is not evidence that an operation happened.

Use recent Commander tool history when the user asks to continue work from another chat and that history materially resolves continuity. Do not claim ChatGPT conversation history itself moved between chats.

Commander diagnostic usage counters never enforce a Commander-side tool-call quota. ChatGPT/platform limits remain separate.
