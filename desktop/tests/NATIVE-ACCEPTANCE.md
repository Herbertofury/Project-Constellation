Native Electron acceptance (Linux)
===============================
Requires Python with Playwright, Xvfb, and a real Electron binary.
Run: COMMANDER_ELECTRON_BIN=/absolute/path/to/electron python tests/native-electron-acceptance.py
Optional COMMANDER_TEST_TARGET points to resources/app.asar; COMMANDER_TEST_WORK sets a temporary evidence root.
The runner uses real main, preloads, IPC, CSP, file and process handlers. Only the ChatGPT service is an owned fixture. It does not sign into an account or test native Windows. --no-sandbox is used for this isolated Linux test host only. Do not pass it to your normal installed application.
