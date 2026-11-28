use serde_json::{Value, json};
use std::collections::{BTreeMap, VecDeque};

pub const MAX_CLIENTS: usize = 16;
pub const MAX_SESSIONS: usize = 128;
pub const MAX_INCIDENTS: usize = 256;
pub const BROWSERS: &[&str] = &["chrome", "edge", "opera_gx", "firefox", "chromium"];
// Keep every provider-core host. The two additional native adapter origins are
// retained deliberately for compatibility; no wildcard/subdomain matching.
pub const CHAT_HOSTS: &[&str] = &[
    "chatgpt.com",
    "chat.openai.com",
    "claude.ai",
    "gemini.google.com",
    "grok.com",
    "www.grok.com",
    "chat.deepseek.com",
    "perplexity.ai",
    "www.perplexity.ai",
    "copilot.microsoft.com",
    "chat.mistral.ai",
    "poe.com",
    "meta.ai",
    "www.meta.ai",
    "chat.qwen.ai",
    "kimi.com",
    "www.kimi.com",
    "character.ai",
    "www.character.ai",
    "huggingface.co",
    "you.com",
    "www.you.com",
    "pi.ai",
    "www.pi.ai",
    "duck.ai",
    "aistudio.google.com",
];
const STATUSES: &[&str] = &[
    "running",
    "idle",
    "completed",
    "permission_required",
    "error",
    "rate_limited",
    "context_limit",
    "waiting_for_user",
    "no_visible_progress",
    "suspended",
    "closed",
];
const ISSUE_STATUSES: &[&str] = &[
    "permission_required",
    "error",
    "rate_limited",
    "context_limit",
    "waiting_for_user",
    "no_visible_progress",
];

#[derive(Clone, Debug, PartialEq)]
struct AlertSettings {
    enabled: bool,
    audio_enabled: bool,
    notifications_enabled: bool,
    completion_enabled: bool,
    volume: f64,
    reminder_minutes: f64,
    max_reminders: u64,
    mute_until: u64,
}

impl Default for AlertSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            audio_enabled: true,
            notifications_enabled: true,
            completion_enabled: false,
            volume: 0.45,
            reminder_minutes: 0.0,
            max_reminders: 3,
            mute_until: 0,
        }
    }
}

impl AlertSettings {
    fn patched(&self, input: &Value) -> Result<Self, String> {
        let fields = input.as_object().ok_or("settings must be an object")?;
        let mut settings = self.clone();
        for (name, value) in fields {
            let boolean = || {
                value
                    .as_bool()
                    .ok_or_else(|| format!("{name} must be a boolean"))
            };
            let number = |maximum: f64| {
                value
                    .as_f64()
                    .filter(|number| number.is_finite() && (0.0..=maximum).contains(number))
                    .ok_or_else(|| format!("{name} must be between 0 and {maximum}"))
            };
            let integer = |maximum: u64| {
                value
                    .as_u64()
                    .filter(|number| *number <= maximum)
                    .ok_or_else(|| format!("{name} must be an integer between 0 and {maximum}"))
            };
            match name.as_str() {
                "enabled" => settings.enabled = boolean()?,
                "audioEnabled" => settings.audio_enabled = boolean()?,
                "notificationsEnabled" => settings.notifications_enabled = boolean()?,
                "completionEnabled" => settings.completion_enabled = boolean()?,
                "volume" => settings.volume = number(1.0)?,
                "reminderMinutes" => settings.reminder_minutes = number(120.0)?,
                "maxReminders" => settings.max_reminders = integer(10)?,
                "muteUntil" => settings.mute_until = integer(9_007_199_254_740_991)?,
                _ => return Err(format!("unsupported alert setting: {name}")),
            }
        }
        Ok(settings)
    }

    fn json(&self) -> Value {
        json!({"enabled":self.enabled,"audioEnabled":self.audio_enabled,
            "notificationsEnabled":self.notifications_enabled,"completionEnabled":self.completion_enabled,
            "volume":self.volume,"reminderMinutes":self.reminder_minutes,
            "maxReminders":self.max_reminders,"muteUntil":self.mute_until})
    }
}

pub fn text(value: &Value, name: &str, max: usize, optional: bool) -> Result<String, String> {
    let Some(raw) = value.get(name).and_then(Value::as_str) else {
        return if optional && value.get(name).is_none() {
            Ok(String::new())
        } else {
            Err(format!("{name} must be a string"))
        };
    };
    if raw.len() > max || raw.chars().any(char::is_control) || (!optional && raw.is_empty()) {
        return Err(format!("invalid {name}"));
    }
    Ok(raw.to_owned())
}

pub fn identifier(value: &Value, name: &str) -> Result<String, String> {
    let raw = text(value, name, 80, false)?;
    if !raw
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.' | b'@'))
    {
        return Err(format!("invalid {name}"));
    }
    Ok(raw)
}

pub fn tab_id(value: &Value) -> Result<u64, String> {
    value
        .get("tabId")
        .and_then(Value::as_u64)
        .filter(|n| *n <= i32::MAX as u64)
        .ok_or_else(|| "tabId must be a nonnegative browser tab ID".into())
}

pub fn chat_url(raw: &str) -> Result<String, String> {
    if raw.len() > 2048 {
        return Err("URL is too long".into());
    }
    let mut url = url::Url::parse(raw).map_err(|_| "invalid URL")?;
    if url.scheme() != "https"
        || !CHAT_HOSTS.contains(&url.host_str().unwrap_or(""))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err("URL is not a supported chat origin".into());
    }
    url.set_query(None);
    url.set_fragment(None);
    let result = url.to_string();
    if result.len() > 384 {
        return Err("normalized URL is too long".into());
    }
    Ok(result)
}

#[derive(Clone, Debug)]
pub struct Client {
    pub id: String,
    pub browser: String,
    pub profile_id: String,
    pub instance_id: String,
    pub label: String,
    pub connected: bool,
    pub updated_at: u64,
}

impl Client {
    pub fn parse(input: &Value, now: u64) -> Result<Self, String> {
        let browser = text(input, "browser", 16, false)?;
        if !BROWSERS.contains(&browser.as_str()) {
            return Err("unsupported browser".into());
        }
        let profile_id = identifier(input, "profileId")?;
        let instance_id = identifier(input, "instanceId")?;
        let label = text(input, "label", 100, true)?;
        Ok(Self {
            id: format!("{browser}:{profile_id}:{instance_id}"),
            browser,
            profile_id,
            instance_id,
            label,
            connected: true,
            updated_at: now,
        })
    }
    fn json(&self) -> Value {
        json!({"clientId":self.id,"browser":self.browser,"profileId":self.profile_id,
            "instanceId":self.instance_id,"label":self.label,"connected":self.connected,
            "updatedAt":self.updated_at})
    }
}

#[derive(Clone, Debug)]
pub struct Session {
    pub id: String,
    pub client_id: String,
    pub browser: String,
    pub profile_id: String,
    pub tab_id: u64,
    pub document_id: String,
    pub run_id: String,
    pub url: String,
    pub title: String,
    pub status: String,
    pub reason: String,
    pub connected: bool,
    pub updated_at: u64,
    pub observed_at: u64,
}

impl Session {
    fn parse(client: &Client, event: &Value, now: u64) -> Result<Self, String> {
        let tab_id = tab_id(event)?;
        let status = text(event, "status", 32, false)?;
        if !STATUSES.contains(&status.as_str()) {
            return Err("unsupported status".into());
        }
        let observed_at = observation_time(event, now)?;
        Ok(Self {
            id: format!("{}:{tab_id}", client.id),
            client_id: client.id.clone(),
            browser: client.browser.clone(),
            profile_id: client.profile_id.clone(),
            tab_id,
            document_id: text(event, "documentId", 80, true)?,
            run_id: text(event, "runId", 80, true)?,
            url: chat_url(&text(event, "url", 2048, false)?)?,
            title: text(event, "title", 180, true)?,
            status,
            reason: text(event, "reason", 240, true)?,
            connected: true,
            updated_at: now,
            observed_at,
        })
    }
    fn same_evidence(&self, other: &Self) -> bool {
        self.status == other.status
            && self.reason == other.reason
            && self.url == other.url
            && self.run_id == other.run_id
            && self.document_id == other.document_id
            && self.title == other.title
            && self.connected == other.connected
    }
    fn json(&self) -> Value {
        json!({"sessionId":self.id,"clientId":self.client_id,"browser":self.browser,
            "profileId":self.profile_id,"tabId":self.tab_id,"documentId":self.document_id,
            "runId":self.run_id,"url":self.url,"title":self.title,"status":self.status,
            "reason":self.reason,"connected":self.connected,"updatedAt":self.updated_at,
            "observedAt":self.observed_at})
    }
}

fn observation_time(event: &Value, now: u64) -> Result<u64, String> {
    let observed_at = match event.get("observedAt") {
        Some(value) => value
            .as_u64()
            .ok_or("observedAt must be an unsigned integer")?,
        None => now,
    };
    if observed_at > now.saturating_add(5 * 60 * 1000)
        || observed_at.saturating_add(24 * 60 * 60 * 1000) < now
    {
        return Err("observedAt is outside the accepted clock range".into());
    }
    Ok(observed_at)
}

#[derive(Clone, Debug)]
struct Incident {
    id: String,
    session_id: String,
    client_id: String,
    title: String,
    url: String,
    document_id: String,
    run_id: String,
    kind: String,
    reason: String,
    first_seen_at: u64,
    updated_at: u64,
    acknowledged_at: Option<u64>,
    snoozed_until: Option<u64>,
    resolved_at: Option<u64>,
    suspended: bool,
}

impl Incident {
    fn json(&self) -> Value {
        json!({"incidentId":self.id,"sessionId":self.session_id,"clientId":self.client_id,
            "title":self.title,"url":self.url,"documentId":self.document_id,"runId":self.run_id,
            "kind":self.kind,"reason":self.reason,"firstSeenAt":self.first_seen_at,
            "updatedAt":self.updated_at,"acknowledgedAt":self.acknowledged_at,
            "snoozedUntil":self.snoozed_until,"resolvedAt":self.resolved_at,"suspended":self.suspended})
    }
}

#[derive(Clone, Default)]
pub struct Store {
    pub clients: BTreeMap<String, Client>,
    pub sessions: BTreeMap<String, Session>,
    incidents: VecDeque<Incident>,
    pub revision: u64,
    updated_at: u64,
    next_incident: u64,
    alert_settings: Option<AlertSettings>,
    // Transaction-local ordering changes need durability without changing the
    // public evidence revision or broadcasting/re-alerting an existing issue.
    ordering_serial: u64,
}

impl Store {
    pub(crate) fn needs_persistence_since(&self, previous: &Self) -> bool {
        self.revision != previous.revision || self.ordering_serial != previous.ordering_serial
    }
    fn changed(&mut self, now: u64) {
        self.revision = self.revision.saturating_add(1);
        self.updated_at = now;
    }
    pub fn hello_with_alert_settings(
        &mut self,
        input: &Value,
        preferences: Option<&Value>,
        now: u64,
    ) -> Result<String, String> {
        // Validate before registering a client so a malformed first preference
        // cannot leave a ghost connection or partly initialize the policy.
        let initial = preferences
            .map(|value| AlertSettings::default().patched(value))
            .transpose()?;
        let client = self.hello(input, now)?;
        if self.alert_settings.is_none()
            && let Some(initial) = initial
        {
            self.alert_settings = Some(initial);
            self.changed(now);
        }
        Ok(client)
    }

    pub fn set_alert_settings(
        &mut self,
        patch: &Value,
        initialize_only: bool,
        now: u64,
    ) -> Result<bool, String> {
        let next = self
            .alert_settings
            .clone()
            .unwrap_or_default()
            .patched(patch)?;
        // The broker holds one mutex across this check, mutation and durable
        // write. A simultaneous later initializer never overwrites the winner.
        if (initialize_only && self.alert_settings.is_some())
            || self.alert_settings.as_ref() == Some(&next)
        {
            return Ok(false);
        }
        self.alert_settings = Some(next);
        self.changed(now);
        Ok(true)
    }
    pub fn hello(&mut self, input: &Value, now: u64) -> Result<String, String> {
        let client = Client::parse(input, now)?;
        if self.clients.get(&client.id).is_some_and(|c| c.connected) {
            return Err("this browser instance already has a connection".into());
        }
        // A reconnect with a new browser-session ID retires old offline records
        // for the same profile. Live parallel windows use one shared sensor.
        let retired: Vec<String> = self
            .clients
            .values()
            .filter(|c| {
                !c.connected
                    && c.browser == client.browser
                    && c.profile_id == client.profile_id
                    && c.id != client.id
            })
            .map(|c| c.id.clone())
            .collect();
        for id in retired {
            self.evict_client(&id, now);
        }
        if !self.clients.contains_key(&client.id) && self.clients.len() >= MAX_CLIENTS {
            if let Some(oldest) = self
                .clients
                .values()
                .filter(|c| !c.connected)
                .min_by_key(|c| c.updated_at)
                .map(|c| c.id.clone())
            {
                self.evict_client(&oldest, now);
            } else {
                return Err("connected browser capacity reached".into());
            }
        }
        let id = client.id.clone();
        self.clients.insert(id.clone(), client);
        self.changed(now);
        Ok(id)
    }
    fn evict_client(&mut self, id: &str, now: u64) {
        let ids: Vec<String> = self
            .sessions
            .values()
            .filter(|s| s.client_id == id)
            .map(|s| s.id.clone())
            .collect();
        for session_id in ids {
            self.resolve(&session_id, now);
            self.sessions.remove(&session_id);
        }
        self.clients.remove(id);
    }
    pub fn disconnect(&mut self, id: &str, now: u64) {
        let Some(client) = self.clients.get_mut(id) else {
            return;
        };
        if !client.connected {
            return;
        }
        client.connected = false;
        client.updated_at = now;
        for session in self.sessions.values_mut().filter(|s| s.client_id == id) {
            session.connected = false;
        }
        self.changed(now);
    }
    fn resolve(&mut self, session_id: &str, now: u64) {
        for incident in self
            .incidents
            .iter_mut()
            .filter(|i| i.session_id == session_id && i.resolved_at.is_none())
        {
            incident.resolved_at = Some(now);
            incident.updated_at = now;
            incident.suspended = false;
        }
    }
    pub fn remove(&mut self, client_id: &str, tab: u64, now: u64) -> bool {
        let id = format!("{client_id}:{tab}");
        if self.sessions.remove(&id).is_some() {
            self.resolve(&id, now);
            self.changed(now);
            true
        } else {
            false
        }
    }
    pub fn observe(&mut self, client_id: &str, input: &Value, now: u64) -> Result<bool, String> {
        let client = self
            .clients
            .get(client_id)
            .filter(|c| c.connected)
            .ok_or("hello required before observation")?;
        if input.get("status").and_then(Value::as_str) == Some("closed") {
            let tab = tab_id(input)?;
            let observed_at = observation_time(input, now)?;
            let document = input
                .get("documentId")
                .map(|_| text(input, "documentId", 80, true))
                .transpose()?;
            let run = input
                .get("runId")
                .map(|_| text(input, "runId", 80, true))
                .transpose()?;
            let url = input
                .get("url")
                .map(|_| chat_url(&text(input, "url", 2048, false)?))
                .transpose()?;
            let Some(previous) = self.sessions.get(&format!("{client_id}:{tab}")) else {
                return Ok(false);
            };
            // A document closure can arrive after navigation or newer evidence.
            // Preserve its context all the way from the browser; only explicit
            // tab removal uses the separate, intentionally unscoped remove op.
            if observed_at < previous.observed_at
                || document
                    .as_ref()
                    .is_some_and(|id| id != &previous.document_id)
                || run.as_ref().is_some_and(|id| id != &previous.run_id)
                || url.as_ref().is_some_and(|url| url != &previous.url)
            {
                return Ok(false);
            }
            return Ok(self.remove(client_id, tab, now));
        }
        let session = Session::parse(client, input, now)?;
        if let Some(previous) = self.sessions.get_mut(&session.id) {
            // Drop stale in-flight observations after a newer event from the same document.
            if session.observed_at < previous.observed_at {
                return Ok(false);
            }
            if previous.same_evidence(&session) {
                // A duplicate is not a new incident or a reason to broadcast,
                // but it is newer evidence. Keep the ordering watermark so a
                // delayed clearance cannot overwrite a more recent issue.
                // Persist the watermark before acknowledging it, including an
                // abrupt hub exit immediately after the reply. Exact retries
                // remain read-only and do not repeat the durable write.
                if previous.observed_at != session.observed_at {
                    previous.observed_at = session.observed_at;
                    self.ordering_serial = self.ordering_serial.wrapping_add(1);
                }
                return Ok(false);
            }
        } else if self.sessions.len() >= MAX_SESSIONS {
            if let Some(oldest) = self
                .sessions
                .values()
                .filter(|s| !s.connected)
                .min_by_key(|s| s.updated_at)
                .map(|s| s.id.clone())
            {
                self.resolve(&oldest, now);
                self.sessions.remove(&oldest);
            } else {
                return Err("live session capacity reached".into());
            }
        }
        let same_context = self.sessions.get(&session.id).is_some_and(|previous| {
            previous.run_id == session.run_id
                && previous.document_id == session.document_id
                && previous.url == session.url
        });
        // Suspension is loss of current evidence, not recovery. Resuming the
        // same issue in the same chat/run keeps its existing episode and ack.
        let continuing = session.status == "suspended"
            || self.incidents.iter().any(|incident| {
                let original_context = if incident.url.is_empty() {
                    same_context // Legacy active episodes lack preserved identity.
                } else {
                    incident.url == session.url
                        && incident.document_id == session.document_id
                        && incident.run_id == session.run_id
                };
                incident.session_id == session.id
                    && incident.kind == session.status
                    && incident.resolved_at.is_none()
                    && original_context
            });
        if !continuing {
            self.resolve(&session.id, now);
        }
        if session.status == "suspended" {
            for incident in self.incidents.iter_mut().filter(|incident| {
                incident.session_id == session.id && incident.resolved_at.is_none()
            }) {
                incident.suspended = true;
                incident.updated_at = now;
            }
        }
        if ISSUE_STATUSES.contains(&session.status.as_str()) {
            if let Some(incident) = self.incidents.iter_mut().rev().find(|i| {
                i.session_id == session.id && i.kind == session.status && i.resolved_at.is_none()
            }) {
                incident.updated_at = now;
                incident.reason = session.reason.clone();
                incident.suspended = false;
            } else {
                if self.incidents.len() >= MAX_INCIDENTS {
                    if let Some(position) =
                        self.incidents.iter().position(|i| i.resolved_at.is_some())
                    {
                        self.incidents.remove(position);
                    } else {
                        return Err("active incident capacity reached".into());
                    }
                }
                self.next_incident = self.next_incident.saturating_add(1);
                self.incidents.push_back(Incident {
                    id: format!("incident-{}", self.next_incident),
                    session_id: session.id.clone(),
                    client_id: client_id.into(),
                    title: session.title.clone(),
                    url: session.url.clone(),
                    document_id: session.document_id.clone(),
                    run_id: session.run_id.clone(),
                    kind: session.status.clone(),
                    reason: session.reason.clone(),
                    first_seen_at: now,
                    updated_at: now,
                    acknowledged_at: None,
                    snoozed_until: None,
                    resolved_at: None,
                    suspended: false,
                });
            }
        }
        if let Some(client) = self.clients.get_mut(client_id) {
            client.updated_at = now;
        }
        self.sessions.insert(session.id.clone(), session);
        self.changed(now);
        Ok(true)
    }
    pub fn acknowledge(&mut self, id: &str, now: u64) -> Result<(), String> {
        let incident = self
            .incidents
            .iter_mut()
            .find(|i| i.id == id)
            .ok_or("incident not found")?;
        incident.acknowledged_at = Some(now);
        incident.updated_at = now;
        self.changed(now);
        Ok(())
    }
    pub fn snooze(&mut self, id: &str, duration: u64, now: u64) -> Result<(), String> {
        if !(60_000..=24 * 60 * 60 * 1000).contains(&duration) {
            return Err("snooze must be 1 minute to 24 hours".into());
        }
        let incident = self
            .incidents
            .iter_mut()
            .find(|i| i.id == id && i.resolved_at.is_none())
            .ok_or("active incident not found")?;
        incident.snoozed_until = Some(now.saturating_add(duration));
        incident.acknowledged_at = None;
        incident.updated_at = now;
        self.changed(now);
        Ok(())
    }
    pub fn focus(&self, id: &str) -> Result<(String, Value), String> {
        let session = self
            .sessions
            .get(id)
            .filter(|s| s.connected && s.status != "suspended")
            .ok_or("session is closed, suspended, or disconnected")?;
        if !self
            .clients
            .get(&session.client_id)
            .is_some_and(|c| c.connected)
        {
            return Err("browser disconnected".into());
        }
        Ok((
            session.client_id.clone(),
            json!({"v":1,"kind":"focus","data":{
            "sessionId":session.id,"tabId":session.tab_id,"documentId":session.document_id}}),
        ))
    }
    pub fn snapshot(&self) -> Value {
        json!({"protocolVersion":1,"revision":self.revision,"updatedAt":self.updated_at,
            "alertSettings":self.alert_settings.as_ref().map(AlertSettings::json),
            "clients":self.clients.values().map(Client::json).collect::<Vec<_>>(),
            "sessions":self.sessions.values().map(Session::json).collect::<Vec<_>>(),
            "incidents":self.incidents.iter().map(Incident::json).collect::<Vec<_>>(),
            "limits":{"clients":MAX_CLIENTS,"sessions":MAX_SESSIONS,"incidents":MAX_INCIDENTS},
            "capabilities":{"focus":true,"sharedAlertSettings":true,"consentAutomation":false,"externalNetwork":false}})
    }
    pub fn restore(value: &Value, now: u64) -> Result<Self, String> {
        if value.get("protocolVersion").and_then(Value::as_u64) != Some(1) {
            return Err("unsupported saved state version".into());
        }
        let clients = value
            .get("clients")
            .and_then(Value::as_array)
            .ok_or("missing clients")?;
        let sessions = value
            .get("sessions")
            .and_then(Value::as_array)
            .ok_or("missing sessions")?;
        let incidents = value
            .get("incidents")
            .and_then(Value::as_array)
            .ok_or("missing incidents")?;
        if clients.len() > MAX_CLIENTS
            || sessions.len() > MAX_SESSIONS
            || incidents.len() > MAX_INCIDENTS
        {
            return Err("saved state exceeds limits".into());
        }
        let mut store = Store {
            revision: value.get("revision").and_then(Value::as_u64).unwrap_or(0),
            updated_at: now,
            ..Default::default()
        };
        if let Some(settings) = value.get("alertSettings").filter(|value| !value.is_null()) {
            if settings.as_object().is_none_or(|object| object.len() != 8) {
                return Err("saved alert settings are incomplete".into());
            }
            store.alert_settings = Some(AlertSettings::default().patched(settings)?);
        }
        for value in clients {
            let mut client = Client::parse(value, now)?;
            client.connected = false;
            client.updated_at = value
                .get("updatedAt")
                .and_then(Value::as_u64)
                .unwrap_or(now)
                .min(now);
            store.clients.insert(client.id.clone(), client);
        }
        for value in sessions {
            let client_id = text(value, "clientId", 200, false)?;
            let client = store
                .clients
                .get(&client_id)
                .ok_or("saved session has no client")?;
            // Validate old saved records without treating them as fresh observations.
            let mut restored = value.clone();
            restored["observedAt"] = json!(now);
            let mut session = Session::parse(client, &restored, now)?;
            session.connected = false;
            session.observed_at = value
                .get("observedAt")
                .and_then(Value::as_u64)
                .unwrap_or(now)
                // Live observations permit this source-clock skew. Clamping
                // to now after a restart would forget an accepted watermark
                // and allow an older in-flight clearance to resolve the issue.
                .min(now.saturating_add(5 * 60 * 1000));
            session.updated_at = value
                .get("updatedAt")
                .and_then(Value::as_u64)
                .unwrap_or(now)
                .min(now);
            store.sessions.insert(session.id.clone(), session);
        }
        for value in incidents {
            let id = identifier(value, "incidentId")?;
            let sequence = id
                .strip_prefix("incident-")
                .and_then(|n| n.parse::<u64>().ok())
                .ok_or("bad incident ID")?;
            store.next_incident = store.next_incident.max(sequence);
            let kind = text(value, "kind", 32, false)?;
            if !ISSUE_STATUSES.contains(&kind.as_str()) {
                return Err("invalid saved incident kind".into());
            }
            // Older snapshots did not retain incident identity. Leave those
            // unavailable fields blank instead of borrowing a newer tab's chat.
            let original_url = text(value, "url", 384, true)?;
            let original_url = if original_url.is_empty() {
                original_url
            } else {
                chat_url(&original_url)?
            };
            store.incidents.push_back(Incident {
                id,
                session_id: text(value, "sessionId", 220, false)?,
                client_id: text(value, "clientId", 200, false)?,
                title: text(value, "title", 180, true)?,
                url: original_url,
                document_id: text(value, "documentId", 80, true)?,
                run_id: text(value, "runId", 80, true)?,
                kind,
                reason: text(value, "reason", 240, true)?,
                first_seen_at: value
                    .get("firstSeenAt")
                    .and_then(Value::as_u64)
                    .unwrap_or(now)
                    .min(now),
                updated_at: value
                    .get("updatedAt")
                    .and_then(Value::as_u64)
                    .unwrap_or(now)
                    .min(now),
                acknowledged_at: value
                    .get("acknowledgedAt")
                    .and_then(Value::as_u64)
                    .map(|n| n.min(now)),
                snoozed_until: value
                    .get("snoozedUntil")
                    .and_then(Value::as_u64)
                    .map(|n| n.min(now.saturating_add(86_400_000))),
                resolved_at: value
                    .get("resolvedAt")
                    .and_then(Value::as_u64)
                    .map(|n| n.min(now)),
                suspended: value
                    .get("suspended")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            });
        }
        Ok(store)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn hello(browser: &str) -> Value {
        json!({"browser":browser,"profileId":"work","instanceId":"session","label":"Work"})
    }
    fn event(status: &str, now: u64) -> Value {
        json!({"tabId":3,"documentId":"doc","runId":"run","url":"https://chatgpt.com/c/test?secret=not-stored#fragment","title":"Test","status":status,"reason":"Short reason","observedAt":now})
    }

    #[test]
    fn shared_alert_preferences_initialize_once_merge_and_survive_restart() {
        let mut store = Store::default();
        assert!(store.snapshot()["alertSettings"].is_null());
        store
            .hello_with_alert_settings(
                &hello("chrome"),
                Some(&json!({"muteUntil":90_000,"audioEnabled":false,"volume":0.2})),
                100,
            )
            .unwrap();
        let initialized = store.snapshot()["alertSettings"].clone();
        store
            .hello_with_alert_settings(
                &hello("firefox"),
                Some(&json!({"muteUntil":0,"audioEnabled":true,"volume":0.9})),
                110,
            )
            .unwrap();
        assert_eq!(store.snapshot()["alertSettings"], initialized);
        assert!(
            !store
                .set_alert_settings(&json!({"muteUntil":0}), true, 120)
                .unwrap()
        );
        assert!(
            store
                .set_alert_settings(&json!({"volume":0.7,"completionEnabled":true}), false, 130)
                .unwrap()
        );
        let patched = store.snapshot()["alertSettings"].clone();
        assert_eq!(patched["muteUntil"], 90_000);
        assert_eq!(patched["audioEnabled"], false);
        assert_eq!(patched["volume"], 0.7);
        assert_eq!(patched["completionEnabled"], true);
        let restored = Store::restore(&store.snapshot(), 140).unwrap();
        assert_eq!(restored.snapshot()["alertSettings"], patched);

        let mut legacy = store.snapshot();
        legacy.as_object_mut().unwrap().remove("alertSettings");
        let mut restored = Store::restore(&legacy, 150).unwrap();
        assert!(restored.snapshot()["alertSettings"].is_null());
        assert!(
            restored
                .set_alert_settings(&json!({"enabled":false}), true, 160)
                .unwrap()
        );
        assert!(
            !restored
                .set_alert_settings(&json!({"enabled":true}), true, 170)
                .unwrap()
        );
        assert_eq!(restored.snapshot()["alertSettings"]["enabled"], false);
    }

    #[test]
    fn alert_settings_reject_invalid_fields_and_ranges_without_mutating_policy() {
        let mut store = Store::default();
        store
            .set_alert_settings(&json!({"muteUntil":80_000}), true, 100)
            .unwrap();
        let before = store.snapshot();
        for patch in [
            json!([]),
            json!(null),
            json!({"enabled":"false"}),
            json!({"audioEnabled":0}),
            json!({"notificationsEnabled":null}),
            json!({"completionEnabled":1}),
            json!({"volume":1.1}),
            json!({"volume":-0.1}),
            json!({"reminderMinutes":121}),
            json!({"maxReminders":11}),
            json!({"maxReminders":1.5}),
            json!({"muteUntil":9_007_199_254_740_992_u64}),
            json!({"muteUntil":-1}),
            json!({"muteUntil":1.5}),
            json!({"muteUntil":0,"clickPermissions":true}),
        ] {
            assert!(
                store.set_alert_settings(&patch, false, 110).is_err(),
                "{patch}"
            );
            assert_eq!(
                store.snapshot(),
                before,
                "invalid patch changed state: {patch}"
            );
        }
        let mut corrupt = before;
        corrupt["alertSettings"]
            .as_object_mut()
            .unwrap()
            .remove("muteUntil");
        assert!(Store::restore(&corrupt, 120).is_err());
        assert!(store.set_alert_settings(&json!({"volume":0,"reminderMinutes":120,"maxReminders":10,"muteUntil":9_007_199_254_740_991_u64}), false, 130).unwrap());
    }

    #[test]
    fn invalid_first_hello_preferences_do_not_register_a_ghost_client() {
        let mut store = Store::default();
        let before = store.snapshot();
        assert!(
            store
                .hello_with_alert_settings(
                    &hello("chrome"),
                    Some(&json!({"muteUntil":"tomorrow"})),
                    100
                )
                .is_err()
        );
        assert_eq!(store.snapshot(), before);
        store.hello(&hello("chrome"), 110).unwrap();
        assert!(
            store
                .hello_with_alert_settings(&hello("chrome"), Some(&json!({"enabled":false})), 120)
                .is_err()
        );
        assert!(store.snapshot()["alertSettings"].is_null());
    }

    #[test]
    fn native_origins_cover_every_browser_provider_without_weakening_url_validation() {
        use std::collections::BTreeSet;
        // This reads the actual extension registry at compile time, so adding a
        // provider to the browser without its native origin fails native CI.
        let source = include_str!("../../../extension/src/provider-core.js");
        let mut browser_hosts = BTreeSet::new();
        for line in source.lines() {
            if let Some((_, rest)) = line.split_once("hosts: [") {
                let (items, _) = rest
                    .split_once(']')
                    .expect("provider hosts array must close");
                for item in items.split(',') {
                    let host = item
                        .trim()
                        .strip_prefix('\'')
                        .and_then(|s| s.strip_suffix('\''))
                        .expect("provider hosts must be literal names");
                    assert!(!host.is_empty());
                    browser_hosts.insert(host);
                }
            }
        }
        assert!(
            browser_hosts.len() >= 24,
            "provider registry could not be read completely"
        );
        let allowed: BTreeSet<_> = CHAT_HOSTS.iter().copied().collect();
        assert_eq!(allowed.len(), CHAT_HOSTS.len(), "duplicate native origins");
        let missing: Vec<_> = browser_hosts.difference(&allowed).copied().collect();
        assert!(
            missing.is_empty(),
            "native hub rejects supported browser providers: {missing:?}"
        );
        assert_eq!(
            allowed
                .difference(&browser_hosts)
                .copied()
                .collect::<BTreeSet<_>>(),
            BTreeSet::from(["aistudio.google.com", "www.grok.com"]),
            "unexpected origin expansion"
        );
        for host in allowed {
            let clean = format!("https://{host}/chat/test");
            assert_eq!(
                chat_url(&format!("{clean}?secret=do-not-store#fragment")).unwrap(),
                clean
            );
            assert!(chat_url(&format!("http://{host}/chat/test")).is_err());
            assert!(chat_url(&format!("https://user:password@{host}/chat/test")).is_err());
            assert!(chat_url(&format!("https://{host}:8443/chat/test")).is_err());
            assert!(chat_url(&format!("https://{host}.example.invalid/chat/test")).is_err());
        }
        assert!(
            chat_url(&format!("https://chat.mistral.ai/chat/{}", "x".repeat(400))).is_err(),
            "oversized routes must fail explicitly rather than silently truncate identity"
        );
    }

    #[test]
    fn browser_isolation_dedup_resolution_and_ack() {
        let mut store = Store::default();
        let chrome = store.hello(&hello("chrome"), 1000).unwrap();
        let firefox = store.hello(&hello("firefox"), 1000).unwrap();
        assert!(
            store
                .observe(&chrome, &event("permission_required", 1000), 1000)
                .unwrap()
        );
        assert!(
            !store
                .observe(&chrome, &event("permission_required", 1001), 1001)
                .unwrap()
        );
        store
            .observe(&firefox, &event("error", 1002), 1002)
            .unwrap();
        assert_eq!(store.sessions.len(), 2);
        assert_eq!(store.incidents.len(), 2);
        assert_eq!(
            store.sessions[&format!("{chrome}:3")].url,
            "https://chatgpt.com/c/test"
        );
        store.acknowledge("incident-1", 1003).unwrap();
        store.snooze("incident-2", 60_000, 1003).unwrap();
        store
            .observe(&chrome, &event("running", 1004), 1004)
            .unwrap();
        assert_eq!(store.incidents[0].resolved_at, Some(1004));
        assert_eq!(store.incidents[1].resolved_at, None);
        store.remove(&firefox, 3, 1005);
        assert_eq!(store.incidents[1].resolved_at, Some(1005));
    }

    #[test]
    fn document_changes_create_new_incidents_and_stale_events_are_ignored() {
        let mut store = Store::default();
        let client = store.hello(&hello("chrome"), 1000).unwrap();
        store.observe(&client, &event("error", 1010), 1010).unwrap();
        assert!(
            !store
                .observe(&client, &event("running", 1001), 1011)
                .unwrap()
        );
        let mut next = event("error", 1012);
        next["documentId"] = json!("next");
        store.observe(&client, &next, 1012).unwrap();
        assert_eq!(store.incidents.len(), 2);
        assert!(store.incidents[0].resolved_at.is_some());
    }

    #[test]
    fn delayed_or_unrelated_closure_cannot_resolve_the_current_document() {
        let mut store = Store::default();
        let client = store.hello(&hello("chrome"), 1000).unwrap();
        store.observe(&client, &event("error", 1010), 1010).unwrap();
        store.acknowledge("incident-1", 1011).unwrap();
        let original = store.snapshot();

        assert!(
            !store
                .observe(&client, &event("closed", 1005), 1012)
                .unwrap()
        );
        assert_eq!(store.snapshot(), original);

        let mut old_document = event("closed", 1013);
        old_document["documentId"] = json!("previous-document");
        assert!(!store.observe(&client, &old_document, 1013).unwrap());
        assert_eq!(store.snapshot(), original);

        let mut invalid_clock = event("closed", 400_000);
        assert!(store.observe(&client, &invalid_clock, 1014).is_err());
        invalid_clock["observedAt"] = json!("unknown");
        assert!(store.observe(&client, &invalid_clock, 1014).is_err());
        assert_eq!(store.snapshot(), original);

        assert!(
            store
                .observe(&client, &event("closed", 1015), 1015)
                .unwrap()
        );
        assert!(store.sessions.is_empty());
        assert_eq!(store.incidents[0].resolved_at, Some(1015));
        assert_eq!(store.incidents[0].acknowledged_at, Some(1011));
    }

    #[test]
    fn repeated_evidence_advances_ordering_without_reannouncing_the_incident() {
        let mut store = Store::default();
        let client = store.hello(&hello("chrome"), 1000).unwrap();
        store.observe(&client, &event("error", 1010), 1010).unwrap();
        store.acknowledge("incident-1", 1011).unwrap();
        let revision = store.revision;
        assert!(!store.observe(&client, &event("error", 1050), 1050).unwrap());
        assert_eq!(
            store.revision, revision,
            "duplicates do not broadcast or re-alert"
        );
        assert_eq!(store.sessions[&format!("{client}:3")].observed_at, 1050);
        assert!(
            !store
                .observe(&client, &event("running", 1030), 1060)
                .unwrap()
        );
        assert_eq!(store.sessions[&format!("{client}:3")].status, "error");
        assert_eq!(store.incidents.len(), 1);
        assert_eq!(store.incidents[0].resolved_at, None);
        assert_eq!(store.incidents[0].acknowledged_at, Some(1011));
        // A later save retains the latest ordering metadata. Restore does not
        // mistake either an older event or a restarted connection for recovery.
        store
            .set_alert_settings(&json!({"volume":0.25}), false, 1070)
            .unwrap();
        let mut restored = Store::restore(&store.snapshot(), 1080).unwrap();
        restored.hello(&hello("chrome"), 1081).unwrap();
        assert!(
            !restored
                .observe(&client, &event("running", 1040), 1082)
                .unwrap()
        );
        assert_eq!(restored.incidents[0].resolved_at, None);
        assert!(
            restored
                .observe(&client, &event("running", 1090), 1090)
                .unwrap()
        );
        assert_eq!(restored.incidents[0].resolved_at, Some(1090));
    }

    #[test]
    fn suspension_preserves_episode_until_observed_clearance() {
        let mut store = Store::default();
        let client = store.hello(&hello("chrome"), 1000).unwrap();
        store
            .observe(&client, &event("permission_required", 1001), 1001)
            .unwrap();
        store.acknowledge("incident-1", 1002).unwrap();
        store
            .observe(&client, &event("suspended", 1003), 1003)
            .unwrap();
        assert_eq!(store.incidents[0].resolved_at, None);
        assert!(store.incidents[0].suspended);
        assert_eq!(store.incidents[0].acknowledged_at, Some(1002));
        assert!(
            !store
                .observe(&client, &event("suspended", 1004), 1004)
                .unwrap()
        );
        let mut restored = Store::restore(&store.snapshot(), 2000).unwrap();
        restored.hello(&hello("chrome"), 2001).unwrap();
        restored
            .observe(&client, &event("permission_required", 2002), 2002)
            .unwrap();
        assert_eq!(
            restored.incidents.len(),
            1,
            "re-observation must not create another alert episode"
        );
        assert_eq!(restored.incidents[0].id, "incident-1");
        assert_eq!(restored.incidents[0].acknowledged_at, Some(1002));
        assert_eq!(restored.incidents[0].resolved_at, None);
        assert!(!restored.incidents[0].suspended);
        // Suspension may carry incomplete identity. It still cannot prove
        // recovery; original incident identity decides whether re-observation
        // resumes this episode or starts another one.
        let mut uncertain = event("suspended", 2003);
        uncertain["runId"] = json!("");
        restored.observe(&client, &uncertain, 2003).unwrap();
        assert_eq!(restored.incidents[0].resolved_at, None);
        restored
            .observe(&client, &event("permission_required", 2004), 2004)
            .unwrap();
        assert_eq!(restored.incidents.len(), 1);
        restored
            .observe(&client, &event("running", 2005), 2005)
            .unwrap();
        assert_eq!(restored.incidents[0].resolved_at, Some(2005));
    }

    #[test]
    fn snoozing_an_acknowledged_incident_rearms_the_same_episode() {
        let mut store = Store::default();
        let client = store.hello(&hello("firefox"), 1000).unwrap();
        store.observe(&client, &event("error", 1001), 1001).unwrap();
        store.acknowledge("incident-1", 1002).unwrap();
        store.snooze("incident-1", 60_000, 1003).unwrap();
        let restored = Store::restore(&store.snapshot(), 1004).unwrap();
        assert_eq!(restored.incidents[0].acknowledged_at, None);
        assert_eq!(restored.incidents[0].snoozed_until, Some(61_003));
        assert_eq!(restored.incidents[0].resolved_at, None);
        assert_eq!(restored.incidents.len(), 1);
    }

    #[test]
    fn history_keeps_original_chat_identity_after_navigation_and_legacy_restore() {
        let mut store = Store::default();
        let client = store.hello(&hello("chrome"), 1000).unwrap();
        store.observe(&client, &event("error", 1001), 1001).unwrap();
        let mut next = event("permission_required", 1002);
        next["title"] = json!("A different chat");
        next["url"] = json!("https://claude.ai/chat/new");
        next["documentId"] = json!("new-document");
        next["runId"] = json!("new-run");
        store.observe(&client, &next, 1002).unwrap();
        let restored = Store::restore(&store.snapshot(), 2000).unwrap();
        let original = &restored.incidents[0];
        assert_eq!(original.title, "Test");
        assert_eq!(original.url, "https://chatgpt.com/c/test");
        assert_eq!(original.document_id, "doc");
        assert_eq!(original.run_id, "run");
        assert_eq!(original.resolved_at, Some(1002));
        assert_eq!(restored.incidents[1].title, "A different chat");
        assert_eq!(restored.incidents[1].document_id, "new-document");
        let mut legacy = store.snapshot();
        for item in legacy["incidents"].as_array_mut().unwrap() {
            for field in ["title", "url", "documentId", "runId", "suspended"] {
                item.as_object_mut().unwrap().remove(field);
            }
        }
        let legacy = Store::restore(&legacy, 2000).unwrap();
        assert!(legacy.incidents[0].title.is_empty());
        assert!(legacy.incidents[0].url.is_empty());
        assert!(
            legacy.incidents[0].document_id.is_empty(),
            "legacy history must not adopt the new tab document"
        );
    }

    #[test]
    fn full_capacity_history_and_sessions_fit_a_native_snapshot() {
        let mut store = Store::default();
        let mut clock = 1_800_000_000_000;
        for client_number in 0..MAX_CLIENTS {
            let client=store.hello(&json!({"browser":"chromium","profileId":format!("{client_number:02}{}","p".repeat(78)),
                "instanceId":"s".repeat(80),"label":"\"".repeat(100)}),clock).unwrap();
            for tab_number in 0..MAX_SESSIONS / MAX_CLIENTS {
                let url = format!(
                    "https://chatgpt.com/{}",
                    "x".repeat(384 - "https://chatgpt.com/".len())
                );
                let mut row = json!({"tabId":tab_number,"documentId":"\"".repeat(80),"runId":"\\".repeat(80),
                    "url":url,"title":"\"".repeat(180),"reason":"\\".repeat(240),"status":"error","observedAt":clock});
                store.observe(&client, &row, clock).unwrap();
                clock += 1;
                row["status"] = json!("permission_required");
                row["observedAt"] = json!(clock);
                store.observe(&client, &row, clock).unwrap();
                clock += 1;
            }
        }
        assert_eq!(store.sessions.len(), MAX_SESSIONS);
        assert_eq!(store.incidents.len(), MAX_INCIDENTS);
        let response = json!({"v":1,"kind":"snapshot","data":store.snapshot()});
        let bytes = serde_json::to_vec(&response).unwrap();
        assert!(
            bytes.len() <= crate::wire::MAX_FRAME,
            "full snapshot is {} bytes, above frame limit {}",
            bytes.len(),
            crate::wire::MAX_FRAME
        );
    }

    #[test]
    fn restart_marks_all_sources_disconnected_and_focus_is_constrained() {
        let mut store = Store::default();
        let client = store.hello(&hello("chrome"), 1000).unwrap();
        store.observe(&client, &event("error", 1001), 1001).unwrap();
        let id = format!("{client}:3");
        let (owner, route) = store.focus(&id).unwrap();
        assert_eq!(owner, client);
        assert_eq!(route["data"]["tabId"], 3);
        let mut restored = Store::restore(&store.snapshot(), 2000).unwrap();
        assert!(restored.focus(&id).is_err());
        restored.hello(&hello("chrome"), 2001).unwrap();
        assert!(restored.focus(&id).is_err());
        restored
            .observe(&client, &event("error", 2002), 2002)
            .unwrap();
        assert!(restored.focus(&id).is_ok());
        restored.disconnect(&client, 2003);
        assert!(restored.focus(&id).is_err());
    }

    #[test]
    fn rejects_unknown_browsers_urls_and_unbounded_inputs() {
        assert!(Client::parse(&hello("unknown"), 0).is_err());
        assert!(chat_url("https://chatgpt.com.evil.test/c/x").is_err());
        assert!(chat_url("https://user:pass@chatgpt.com/c/x").is_err());
        assert!(chat_url("file:///etc/passwd").is_err());
        assert!(chat_url("https://chatgpt.com:8443/c/x").is_err());
        let mut store = Store::default();
        let client = store.hello(&hello("chrome"), 1000).unwrap();
        let mut invalid = event("error", 1000);
        invalid["title"] = json!("x".repeat(181));
        assert!(store.observe(&client, &invalid, 1000).is_err());
        assert!(
            store
                .observe(&client, &event("click_allow", 1000), 1000)
                .is_err()
        );
        assert!(store.snooze("anything", u64::MAX, 1000).is_err());
    }
}
