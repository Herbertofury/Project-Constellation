# Event-driven session completion, private draft

Paired worker posts a generation-tagged completion message after serve returns. GUI ignores stale messages, calls existing bounded cleanup and displays disconnected only after its normal cleanup succeeds; uncertain cleanup remains fenced. No polling, automatic reconnect, extra capability, endpoint, autostart or grant. Existing allow_paired API preserved as notification-free wrapper.

Actual GUI tests now require automatic disconnected after completed/refused paired requests and exact inventory read, before their explicit Disconnect. Separate stale completion message is synchronously dispatched and must not revoke a newer active grant. Prior manual Disconnect/Exit tests remain. Compile checked, Windows execution pending independent review.

Limits: notification is best effort if PostMessage fails or worker panics. Callback signals serve completion, not itself proof thread/handle shutdown; GUI confirms through existing disconnect. GUI can be blocked by its synchronous work; no hard realtime guarantee. Known file-dialog failure is untouched, no artifact publication proposed. Windows64 CI only, not 32bit generation-width acceptance. Full60second expiry and cancellation-failure GUI paths not yet separately exercised.
