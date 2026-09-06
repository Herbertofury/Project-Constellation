#!/usr/bin/env python3
"""Deterministic real-Chromium acceptance for Project Constellation.

This launches the actual unpacked MV3 extension in Playwright Chromium. Provider
network/login variability is deliberately removed by fulfilling a ChatGPT-origin
fixture inside Chromium while preserving the real https://chatgpt.com/c/... URL,
so Chrome still applies the extension's real manifest host matches and automatic
content scripts.

This is a browser/runtime acceptance gate, not a claim that a user's signed-in
provider profile was exercised.
"""

from __future__ import annotations

import base64
import hashlib
import json
import tempfile
import time
import traceback
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
EXTENSION_DIR = ROOT / "extension"
MANIFEST = json.loads((EXTENSION_DIR / "manifest.json").read_text(encoding="utf-8"))
CHAT_URL = "https://chatgpt.com/c/11111111-1111-4111-8111-111111111111"
FIXTURE_HTML = """<!doctype html>
<html>
<head><meta charset='utf-8'><title>Project Constellation Acceptance Chat</title></head>
<body>
  <nav aria-label='Chat history'>
    <a href='/c/11111111-1111-4111-8111-111111111111'>Acceptance Chat</a>
  </nav>
  <main>
    <article data-message-author-role='user'>acceptance request</article>
    <article data-message-author-role='assistant'>acceptance response</article>
    <textarea aria-label='Message'></textarea>
    <button data-testid='send-button' type='button'>Send</button>
  </main>
</body>
</html>"""


def extension_id_from_key(key: str) -> str:
    raw = base64.b64decode(key)
    digest = hashlib.sha256(raw).digest()[:16]
    alphabet = "abcdefghijklmnop"
    return "".join(alphabet[b >> 4] + alphabet[b & 0x0F] for b in digest)


def wait_until(predicate, timeout_ms: int = 15000, interval_ms: int = 100):
    deadline = time.monotonic() + timeout_ms / 1000
    last_error = None
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except Exception as exc:  # diagnostics retain last transient failure
            last_error = exc
        time.sleep(interval_ms / 1000)
    if last_error:
        raise AssertionError(f"timed out; last transient error: {last_error}")
    raise AssertionError("timed out waiting for browser condition")


def assert_true(value, message: str):
    if not value:
        raise AssertionError(message)


def main() -> int:
    extension_id = extension_id_from_key(MANIFEST["key"])
    expected_version = MANIFEST["version"]
    extension_origin = f"chrome-extension://{extension_id}"
    print(f"acceptance_extension_id={extension_id}")
    print(f"acceptance_manifest_version={expected_version}")

    with tempfile.TemporaryDirectory(prefix="pc-live-browser-") as profile_dir:
        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                user_data_dir=profile_dir,
                headless=False,
                args=[
                    f"--disable-extensions-except={EXTENSION_DIR}",
                    f"--load-extension={EXTENSION_DIR}",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-background-networking",
                ],
            )
            try:
                # Deterministic provider-origin document: no CDN/login/network gate,
                # while the URL still matches the real ChatGPT manifest patterns.
                context.route(
                    "https://chatgpt.com/**",
                    lambda route: route.fulfill(
                        status=200,
                        content_type="text/html; charset=utf-8",
                        body=FIXTURE_HTML,
                    ),
                )

                chat = context.new_page()
                chat.goto(CHAT_URL, wait_until="domcontentloaded", timeout=15000)
                assert_true(chat.url.startswith(CHAT_URL), f"fixture URL mismatch: {chat.url}")
                print("stage=chatgpt_origin_fixture_loaded")

                popup = context.new_page()
                popup.goto(f"{extension_origin}/popup.html", wait_until="domcontentloaded", timeout=15000)
                popup.wait_for_selector("#openConstellation", state="attached", timeout=10000)

                runtime_manifest = popup.evaluate("() => chrome.runtime.getManifest()")
                assert_true(runtime_manifest.get("version") == expected_version, "runtime manifest version mismatch")
                assert_true(runtime_manifest.get("background", {}).get("service_worker") == "background-entry.js", "wrong MV3 worker entrypoint")
                print("stage=extension_popup_loaded")

                # Worker may be lazily started; extension-page runtime access plus a
                # bounded wait should make it observable without a one-shot timeout bug.
                def worker_url():
                    workers = [w for w in context.service_workers if w.url.startswith(extension_origin)]
                    return workers[0].url if workers else ""

                try:
                    context.wait_for_event("serviceworker", timeout=1000)
                except PlaywrightTimeoutError:
                    pass
                observed_worker = wait_until(worker_url, timeout_ms=15000)
                assert_true(observed_worker.endswith("/background-entry.js"), f"unexpected service worker: {observed_worker}")
                print("stage=mv3_worker_observed")

                # Prove the manifest's automatic ChatGPT content scripts are alive by
                # using the same message the production popup uses.
                status_probe = popup.evaluate(
                    """async (url) => {
                      const tabs = await chrome.tabs.query({});
                      const tab = tabs.find((row) => row.url === url);
                      if (!tab?.id) return { ok:false, error:'fixture tab not visible to extension' };
                      try {
                        const value = await chrome.tabs.sendMessage(tab.id,{type:'PC_GET_STATUS'});
                        return { ok:true, value };
                      } catch (error) {
                        return { ok:false, error:String(error?.message || error) };
                      }
                    }""",
                    CHAT_URL,
                )
                assert_true(status_probe.get("ok"), f"automatic content script did not answer PC_GET_STATUS: {status_probe}")
                assert_true(isinstance(status_probe.get("value"), dict), f"PC_GET_STATUS returned no state: {status_probe}")
                print("stage=automatic_content_script_messaging_ok")

                # Also prove host permission + scripting API can act on the provider
                # origin from the installed extension runtime.
                injection = popup.evaluate(
                    """async (url) => {
                      const tabs = await chrome.tabs.query({});
                      const tab = tabs.find((row) => row.url === url);
                      if (!tab?.id) return {ok:false,error:'fixture tab missing'};
                      try {
                        const rows = await chrome.scripting.executeScript({
                          target:{tabId:tab.id},
                          func:() => {
                            document.documentElement.dataset.pcAcceptanceInjected='yes';
                            return document.documentElement.dataset.pcAcceptanceInjected;
                          }
                        });
                        return {ok:true,value:rows?.[0]?.result || ''};
                      } catch (error) {
                        return {ok:false,error:String(error?.message || error)};
                      }
                    }""",
                    CHAT_URL,
                )
                assert_true(injection.get("ok") and injection.get("value") == "yes", f"provider-origin scripting failed: {injection}")
                assert_true(chat.evaluate("() => document.documentElement.dataset.pcAcceptanceInjected") == "yes", "injected provider marker not visible")
                print("stage=provider_host_permission_and_scripting_ok")

                pulse = popup.evaluate(
                    """async () => {
                      try { await chrome.runtime.sendMessage({type:'PC_TAB_BEACON_REFRESH'}); } catch (_) {}
                      await new Promise((resolve) => setTimeout(resolve,300));
                      try { return await chrome.runtime.sendMessage({type:'PC_LIVE_CHAT_PULSE',force:true}); }
                      catch (error) { return {ok:false,error:String(error?.message || error)}; }
                    }"""
                )
                assert_true(isinstance(pulse, dict) and pulse.get("ok"), f"Live Chat Pulse failed: {pulse}")
                assert_true(int(pulse.get("openChatTabs", 0)) >= 1, f"fixture chat missing from Live Chat Pulse: {pulse}")
                print("stage=live_chat_pulse_ok")

                # Exercise the previously broken alert control end-to-end.
                attention = popup.locator("#attentionNotificationsEnabled")
                attention.wait_for(state="attached", timeout=10000)
                initial_attention = attention.is_checked()
                attention.click(force=True)
                desired_attention = not initial_attention

                def stored_attention_matches():
                    return popup.evaluate(
                        """async (desired) => {
                          const row = await chrome.storage.local.get('projectConstellationPulseUxSettings');
                          return row?.projectConstellationPulseUxSettings?.attentionNotificationsEnabled === desired;
                        }""",
                        desired_attention,
                    )

                wait_until(stored_attention_matches, timeout_ms=5000)
                assert_true(attention.is_checked() == desired_attention, "alert toggle UI reverted after persistence")
                print("stage=stall_runway_alert_toggle_persisted")

                # Unsupported actions must present as unavailable rather than dead.
                wait_until(lambda: popup.locator("#applyTabTag").is_disabled(), timeout_ms=5000)
                wait_until(lambda: popup.locator("#resetMetrics").is_disabled(), timeout_ms=5000)
                print("stage=popup_unavailable_controls_are_visibly_disabled")

                quick = popup.evaluate(
                    """async () => {
                      try { return await chrome.runtime.sendMessage({type:'PC_COMMAND_CENTER_GET_QUICK_ACTION'}); }
                      catch (error) { return {ok:false,error:String(error?.message || error)}; }
                    }"""
                )
                assert_true(isinstance(quick, dict) and quick.get("ok"), f"quick-action runtime message failed: {quick}")
                print("stage=command_center_runtime_message_ok")

                # Click the production Popup button and assert the real Command Center
                # route opens; do not navigate there directly for this ownership test.
                popup.locator("#openConstellation").click(force=True)

                def command_center_page():
                    for page in context.pages:
                        if page.url.startswith(f"{extension_origin}/chat-vault.html"):
                            return page
                    return None

                center = wait_until(command_center_page, timeout_ms=10000)
                center.wait_for_selector("#gatherOpenChats", state="attached", timeout=10000)
                center.wait_for_selector("#newProject", state="attached", timeout=10000)
                print("stage=popup_to_command_center_route_ok")

                # Real dialog ownership / no-dead-button checks.
                center.locator("#newProject").click(force=True)
                project_dialog = center.locator("#projectDialog")
                wait_until(lambda: bool(project_dialog.evaluate("el => el.open")), timeout_ms=3000)
                center.locator('[data-dialog-close="projectDialog"]').click(force=True)
                wait_until(lambda: not bool(project_dialog.evaluate("el => el.open")), timeout_ms=3000)

                center.locator("#importChats").click(force=True)
                import_dialog = center.locator("#importDialog")
                wait_until(lambda: bool(import_dialog.evaluate("el => el.open")), timeout_ms=3000)
                center.locator('[data-dialog-close="importDialog"]').click(force=True)
                wait_until(lambda: not bool(import_dialog.evaluate("el => el.open")), timeout_ms=3000)
                print("stage=command_center_dialog_cancel_ownership_ok")

                # Verify core local storage is writable/readable from this installed
                # extension instance, then leave the ephemeral profile to cleanup.
                storage_roundtrip = center.evaluate(
                    """async () => {
                      await chrome.storage.local.set({pcAcceptanceRoundtrip:'ok'});
                      const row = await chrome.storage.local.get('pcAcceptanceRoundtrip');
                      return row?.pcAcceptanceRoundtrip;
                    }"""
                )
                assert_true(storage_roundtrip == "ok", "extension storage roundtrip failed")
                print("stage=extension_storage_roundtrip_ok")

                print("LIVE_BROWSER_ACCEPTANCE_OK")
                return 0
            except Exception:
                print("LIVE_BROWSER_ACCEPTANCE_FAILED")
                traceback.print_exc()
                for index, page in enumerate(context.pages):
                    try:
                        print(f"page[{index}]={page.url}")
                    except Exception:
                        pass
                return 1
            finally:
                context.close()


if __name__ == "__main__":
    raise SystemExit(main())
