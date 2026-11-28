//! Browser-bound lifetime without a heartbeat or a background polling loop.
//! One authenticated native transport owns one lease. The last lease starts
//! a one-shot reconnect grace; admitting a new lease cancels that deadline.
use serde_json::{Value, json};
use std::{
    ffi::OsString,
    io,
    sync::{Arc, Condvar, Mutex},
    time::{Duration, Instant},
};

const DEFAULT_IDLE_GRACE_MS: u64 = 5_000;
const IDLE_GRACE_ENV: &str = "CONSTELLATION_IDLE_GRACE_MS";

struct State {
    sensors: usize,
    idle_since: Option<Instant>,
    stopping: bool,
}

pub(crate) struct Lifecycle {
    state: Mutex<State>,
    changed: Condvar,
    grace: Duration,
}

pub(crate) struct SensorLease {
    lifecycle: Arc<Lifecycle>,
}

fn parse_grace(value: Option<OsString>) -> io::Result<Duration> {
    let milliseconds = match value {
        None => DEFAULT_IDLE_GRACE_MS,
        Some(value) => value
            .to_str()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| (100..=60_000).contains(value))
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("{IDLE_GRACE_ENV} must be an integer from 100 through 60000"),
                )
            })?,
    };
    Ok(Duration::from_millis(milliseconds))
}

impl Lifecycle {
    pub(crate) fn from_environment() -> io::Result<Arc<Self>> {
        Ok(Self::new(parse_grace(std::env::var_os(IDLE_GRACE_ENV))?))
    }

    fn new(grace: Duration) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State {
                sensors: 0,
                // A manually started broker also exits if no browser arrives.
                idle_since: Some(Instant::now()),
                stopping: false,
            }),
            changed: Condvar::new(),
            grace,
        })
    }

    pub(crate) fn acquire(self: &Arc<Self>) -> io::Result<SensorLease> {
        let mut state = self.state.lock().unwrap();
        if state.stopping {
            return Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "broker is stopping; reconnect to start a new broker",
            ));
        }
        state.sensors += 1;
        state.idle_since = None;
        self.changed.notify_one();
        Ok(SensorLease {
            lifecycle: self.clone(),
        })
    }

    pub(crate) fn is_stopping(&self) -> bool {
        self.state.lock().unwrap().stopping
    }

    pub(crate) fn snapshot(&self) -> Value {
        let state = self.state.lock().unwrap();
        json!({
            "mode":"browser_bound",
            "state":if state.stopping {"stopping"} else if state.sensors == 0 {"idle_grace"} else {"connected"},
            "connectedNativeHosts":state.sensors,
            "idleGraceMs":self.grace.as_millis() as u64
        })
    }

    /// Only OS wakeups, connection events and the current one-shot deadline
    /// reach this loop. No periodic timer wakes a connected or idle browser.
    pub(crate) fn wait_for_stop(&self) {
        let mut state = self.state.lock().unwrap();
        while !state.stopping {
            if let Some(idle_since) = state.idle_since {
                let remaining = self.grace.saturating_sub(idle_since.elapsed());
                if remaining.is_zero() {
                    // Admission and the stop decision share this lock. A
                    // successful authentication can never enter a dying hub.
                    state.stopping = true;
                    break;
                }
                state = self.changed.wait_timeout(state, remaining).unwrap().0;
            } else {
                state = self.changed.wait(state).unwrap();
            }
        }
    }

    pub(crate) fn request_stop(&self) {
        self.stop_with(|| Ok(())).unwrap();
    }

    /// Keep the admission lock until an explicit stop reply is written. New
    /// clients are rejected immediately, but shutdown cannot close the admin
    /// socket before its acknowledgement has been placed on the wire.
    pub(crate) fn stop_with(&self, reply: impl FnOnce() -> io::Result<()>) -> io::Result<()> {
        let mut state = self.state.lock().unwrap();
        state.stopping = true;
        let result = reply();
        self.changed.notify_one();
        result
    }
}

impl Drop for SensorLease {
    fn drop(&mut self) {
        let mut state = self.lifecycle.state.lock().unwrap();
        state.sensors -= 1;
        if state.sensors == 0 {
            state.idle_since = Some(Instant::now());
            self.lifecycle.changed.notify_one();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grace_is_bounded_and_has_a_production_default() {
        assert_eq!(parse_grace(None).unwrap(), Duration::from_secs(5));
        assert_eq!(
            parse_grace(Some("100".into())).unwrap(),
            Duration::from_millis(100)
        );
        for value in ["", "0", "99", "60001", "-1", "1.5", "forever"] {
            assert!(parse_grace(Some(value.into())).is_err(), "{value}");
        }
    }

    #[test]
    fn leases_reference_count_and_stop_rejects_new_admission() {
        let lifecycle = Lifecycle::new(Duration::from_secs(5));
        assert_eq!(lifecycle.snapshot()["state"], "idle_grace");
        let first = lifecycle.acquire().unwrap();
        let second = lifecycle.acquire().unwrap();
        assert_eq!(lifecycle.snapshot()["connectedNativeHosts"], 2);
        drop(first);
        assert_eq!(lifecycle.snapshot()["state"], "connected");
        drop(second);
        assert_eq!(lifecycle.snapshot()["state"], "idle_grace");
        lifecycle.request_stop();
        assert!(lifecycle.acquire().is_err());
        assert_eq!(lifecycle.snapshot()["state"], "stopping");
    }
}
