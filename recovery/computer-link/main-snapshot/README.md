# Computer Link

A local-first computer tool layer for ordinary chats and compatible assistants, including a future dot integration **only where supported**. The software is deterministic: it need not run its own model or autonomous coding-agent loop. This does **not** make assistant usage free or bypass quotas.

**Stage: tested diagnostics foundation, not a working remote-control product.** No installation, Windows native acceptance, ChatGPT connector, dot integration, credentials or persistent grants have been configured.

[Project wiki](https://github.com/Herbertofury/Computer-Link/wiki) · [Research and reuse](docs/research.md) · [Architecture and roadmap](docs/architecture.md)

## Try locally

Python 3.11+; standard library only. From this checkout:

```sh
python -m unittest discover -s tests -v
python -m computer_link
```

Send a JSON object per line, e.g. `{"id":1,"method":"capabilities.list"}` or `{"id":2,"method":"system.summary"}`. Optional `--workspace /chosen/folder` enables disk capacity (not filenames/content) for that volume. EOF exits. This local JSON-line interface is **not MCP yet**. The default process has no network listener, filesystem writes, shell execution, clipboard, screenshots or input injection.

Core, transport and adapters are independent. The current read-only adapter is a small testable baseline, not a replacement for the existing tools researched below. Unknown operations fail explicitly; they are never converted into shell commands. Native Windows and actual client integration tests remain open.
