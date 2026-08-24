# Contributing

Start with [Development](docs/DEVELOPMENT.md) and [Architecture](docs/ARCHITECTURE.md). Keep changes bounded, preserve mounted conversation content, and add regression coverage for behavior changes.

Pull requests should include:

- the user-visible problem and intended behavior;
- tests covering the success and failure path;
- performance impact for content-script/observer work;
- permission or data-handling impact;
- documentation updates where behavior changed;
- `npm run verify` results.

Do not submit credentials, captured private conversations, browser profiles, generated `build/` or `logs/` contents, or ProjectDump-wide changes.
