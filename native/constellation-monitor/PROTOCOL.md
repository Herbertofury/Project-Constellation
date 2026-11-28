# Constellation native protocol v1

Host name: `com.project_constellation.monitor`. All browser messages are UTF-8
JSON framed with a native-endian unsigned 32-bit byte count. Maximum frame size:
1,000,000 bytes (below the browser's 1 MiB limit). Requests contain `v: 1`, a short
string `id`, and `op`. Unknown operations
are rejected. The first request must be `hello`. Native stdout contains frames
only. Nothing in this protocol grants consent, clicks a page control, runs a shell
command, opens an arbitrary URL, or enables remote debugging.

```json
{"v":1,"id":"hello-1","op":"hello","client":{"browser":"chrome","profileId":"profile-random-id","instanceId":"browser-session-random-id","label":"Chrome · Work"}}
```

Browser values: `chrome`, `edge`, `opera_gx`, `firefox`, `chromium`. The browser
adapter saves `profileId` in local storage and `instanceId` in session storage.
The returned `clientId` is `browser:profileId:instanceId`.

The adapter sends its existing complete alert preferences in the optional
top-level `hello.alertSettings` field. The first valid hello with preferences
initializes shared policy atomically with the connection; later profiles cannot
overwrite it during connection. Invalid preferences reject the hello before it
registers a client. An older saved state without policy remains uninitialized
until a profile supplies preferences.

```json
{"v":1,"id":"event-1","op":"observe","event":{"tabId":123,"documentId":"document-1","runId":"run-1","url":"https://chatgpt.com/c/conversation-id","title":"Build the dashboard","status":"permission_required","reason":"Allow for this conversation","observedAt":1795790000000}}
```

Statuses: `running`, `idle`, `completed`, `permission_required`, `error`,
`rate_limited`, `context_limit`, `waiting_for_user`, `no_visible_progress`,
`suspended`, `closed`. A `closed` observation retires its document only when its
timestamp is current and any supplied document, run and URL identity still
matches the session. A delayed closure cannot retire a newer document. The
separate `remove` operation is authoritative tab removal and requires only the
tab ID. `reason` is short status metadata, not the chat transcript. URLs are restricted to known chat origins and
normalized to exclude query, fragment, and credentials.

Other requests:

```json
{"v":1,"id":"get-1","op":"snapshot"}
{"v":1,"id":"remove-1","op":"remove","tabId":123}
{"v":1,"id":"ack-1","op":"ack","incidentId":"incident-1"}
{"v":1,"id":"snooze-1","op":"snooze","incidentId":"incident-1","durationMs":300000}
{"v":1,"id":"policy-1","op":"alert_settings","settings":{"muteUntil":1795790300000,"volume":0.5},"initializeOnly":false}
{"v":1,"id":"focus-1","op":"focus","sessionId":"chrome:profile-random-id:browser-session-random-id:123"}
{"v":1,"id":"bye-1","op":"bye"}
```

Replies contain `v`, the original `id`, `ok`, `kind`, and `data`; errors contain
`ok:false,error:{code,message}`. A successful hello or snapshot request returns
`kind:"snapshot"`. Each connected sensor also receives unsolicited snapshots
after a state change, including changes from other browsers. These pushes have
no `id`. They contain the complete bounded state and a monotonically increasing
`revision`, so clients may drop an older snapshot safely.

An observation acknowledgement covers its durable ordering timestamp, even if
the status and incident are otherwise unchanged. Advancing only that timestamp
does not increment the public revision, broadcast a new snapshot or repeat an
alert. An exact retry of already saved evidence performs no additional write.
Storage failures reject the acknowledgement and restore the previous timestamp,
so the same observation can be retried after storage becomes available. A
provided `observedAt` must be an unsigned integer inside the accepted clock
range; omitting it retains the legacy arrival-time behavior.

```json
{
  "v":1,"id":"hello-1","ok":true,"kind":"snapshot",
  "data":{
    "clientId":"chrome:profile-random-id:browser-session-random-id",
    "revision":12,"updatedAt":1795790000000,"protocolVersion":1,
    "alertSettings":{"enabled":true,"audioEnabled":true,"notificationsEnabled":true,"completionEnabled":false,"volume":0.45,"reminderMinutes":0,"maxReminders":3,"muteUntil":0},
    "clients":[{
      "clientId":"chrome:profile-random-id:browser-session-random-id",
      "browser":"chrome","profileId":"profile-random-id",
      "instanceId":"browser-session-random-id","label":"Chrome · Work",
      "connected":true,"updatedAt":1795790000000
    }],
    "sessions":[{
      "sessionId":"chrome:profile-random-id:browser-session-random-id:123",
      "clientId":"chrome:profile-random-id:browser-session-random-id",
      "browser":"chrome","profileId":"profile-random-id",
      "tabId":123,"documentId":"document-1","runId":"run-1",
      "url":"https://chatgpt.com/c/conversation-id",
      "title":"Build the dashboard","status":"permission_required",
      "reason":"Allow for this conversation","connected":true,
      "updatedAt":1795790000000,"observedAt":1795790000000
    }],
    "incidents":[{
      "incidentId":"incident-1",
      "sessionId":"chrome:profile-random-id:browser-session-random-id:123",
      "clientId":"chrome:profile-random-id:browser-session-random-id",
      "title":"Build the dashboard","url":"https://chatgpt.com/c/conversation-id",
      "documentId":"document-1","runId":"run-1","suspended":false,
      "kind":"permission_required","reason":"Allow for this conversation",
      "firstSeenAt":1795790000000,"updatedAt":1795790000000,
      "acknowledgedAt":null,"snoozedUntil":null,"resolvedAt":null
    }],
    "limits":{"clients":16,"sessions":128,"incidents":256},
    "capabilities":{"focus":true,"sharedAlertSettings":true,"browserBoundLifecycle":true,"consentAutomation":false,"externalNetwork":false},
    "health":{"persistence":"ok","message":null,"connectedBrowsers":1,"lifecycle":{"mode":"browser_bound","state":"connected","connectedNativeHosts":1,"idleGraceMs":5000}}
  }
}
```

## Shared alert policy

`alertSettings` is `null` only before initialization; afterward every snapshot
contains the complete eight-field policy. `alert_settings` accepts a partial
`settings` object and merges only the supplied fields. Its successful reply is
a snapshot, and changes are pushed to every connected profile after the durable
write succeeds. `initializeOnly:true` initializes an empty policy once; later
initializers return the existing policy without replacing it. The check, merge,
and persistence happen under the broker's state lock. A failed write rolls back
the policy and revision in memory as well as reporting an error.

| Field | Accepted JSON value | Default |
| --- | --- | --- |
| `enabled` | Boolean | `true` |
| `audioEnabled` | Boolean | `true` |
| `notificationsEnabled` | Boolean | `true` |
| `completionEnabled` | Boolean | `false` |
| `volume` | Finite number from 0 through 1 | `0.45` |
| `reminderMinutes` | Finite number from 0 through 120 | `0` |
| `maxReminders` | Integer from 0 through 10 | `3` |
| `muteUntil` | Integer UTC milliseconds from 0 through 9007199254740991 | `0` |

Unknown fields, coercible strings, wrong types, and out-of-range values are
rejected. `muteUntil:0` removes a mute; past timestamps are expired mutes. Any
connected dashboard may patch policy, including a follower whose browser does
not currently own alert delivery. The extension exposes this only through its
UI-only `PC_MONITOR_ALERT_SETTINGS` message. Native synchronization does not feed
the resulting local preference event back into another policy write.

Adapters require `capabilities.sharedAlertSettings:true`. Before enabling an
alert owner after a policy change or ownership transfer, they apply the shared
policy and mirror existing incident acknowledgement/snooze state. Unchanged
snapshots do not toggle ownership or restart reminder alarms. Ownership uses
ascending protocol code-point order of connected `clientId` values, independent
of browser locale. A browser that disconnects first marks its mirrored remote
sessions offline before restoring standalone delivery. Its last applied mute
and other preferences remain in local storage.

## Observation and focus identity

`updatedAt` is the host's wall clock. `observedAt` is accepted from the sensor only
within a bounded range of the host clock. Neither means that a suspended or
disconnected page is still being observed. After daemon restart every persisted
client and session starts with `connected:false` until a new hello/observation.

Each incident retains its original `title`, `url`, `documentId`, and `runId` even
after that tab navigates. Older saved incidents without these fields return
empty strings rather than borrowing the identity of a newer conversation.
`suspended:true` pauses the same unresolved episode; re-observing the same issue
in the same chat/run preserves its incident ID and acknowledgement. Snoozing an
acknowledged incident clears `acknowledgedAt` and sets `snoozedUntil` so the same
episode can remind the user after that deadline.

Focus is routed to the owning connected sensor only:

```json
{"v":1,"kind":"focus","data":{"sessionId":"chrome:profile-random-id:browser-session-random-id:123","tabId":123,"documentId":"document-1"}}
```

The sensor validates the current tab/document and uses its own `tabs.update` and
`windows.update` APIs to focus it. It never follows a URL from this message.
Focus to a disconnected client, suspended session, or removed tab fails clearly.

The companion shares state through an authenticated loopback broker with an
OS-random 256-bit credential in its private data directory. This credential is
used only inside native Rust processes and is never returned to extensions.
Browser disconnects remove their live routing connection. Disconnected records
are retained as history and clearly marked; remove/closed resolves their live
incidents. Capacity is bounded, and active records are not silently evicted.

## Browser-bound process lifetime

`capabilities.browserBoundLifecycle:true` means that this hub exits after its
last native sensor disconnects. `health.connectedBrowsers` counts registered
identities; `health.lifecycle.connectedNativeHosts` counts authenticated sensor
transports, including a transport whose first `hello` has not arrived yet.
Admin/diagnostic and unauthenticated sockets are excluded. Lifecycle `state` is
`connected`, `idle_grace`, or `stopping`; `idleGraceMs` is the configured grace,
5000 milliseconds by default. Lifecycle health is runtime metadata, not saved
chat state, and does not increment the persisted revision by itself.

`health.processLifetime` describes the operating-system ownership around those
leases. On Windows, `jobManaged:true` reports an enclosing Job;
`breakawayAllowed` and `killOnJobClose` reflect its current limits;
`explicitBreakawayAllowed` and `silentBreakawayAllowed` distinguish whether a
child must request breakaway or receives it automatically. A constrained
broker reports mode `sensor_leases_with_job_limits` and remains subject to that
Job's termination even while other sensors are connected. An unconstrained
broker reports mode `sensor_leases`. The launcher never changes Job limits;
it requests independent lifetime only when allowed. Surviving sensors can
reconnect after an owning Job ends and recover saved state. `doctor` includes
the calling process's limits and, when connected, the broker snapshot's limits.

An authenticated transport acquires its lifetime lease before the native host
receives authentication success. The last disconnect starts one cancellable
deadline. A new lease cancels it; once shutdown has been committed, new leases
are rejected and the next native invocation waits for the old process lock
before starting a successor. Connection IDs also guard cleanup and requests:
an evicted reader cannot act through a replacement with the same `clientId`.

Before exit the hub shuts down every socket, joins old connection workers,
persists disconnected identities, removes `endpoint.json`, and releases its
process lock. A later native call restores incidents/preferences and marks
observations offline until fresh sensor events arrive. Explicit `stop` uses
the same orderly shutdown without the reconnect grace. It does not stop other
Constellation executables or user-launched local work.

Browser adapters release their native port when the last normal window in the
profile closes, including browsers configured to remain running in background
mode. They preserve the user's enabled preference, cancel retry alarms, and
reconnect on normal-window creation. These are window events, not process scans
or recurring heartbeats. Native transport EOF also releases a lease when the
browser exits or crashes before its window event can run.

