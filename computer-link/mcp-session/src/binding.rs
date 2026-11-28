//! Offline trust-boundary contract. This module does NOT authenticate tokens.
//! Only audited middleware may construct claims after verifying signature/introspection,
//! issuer, audience, expiry and revocation. Never deserialize these from client JSON.
use crate::{Session, http_gate::{Gate, Request, Response}};

pub const STATUS_SCOPE: &str = "computer-link:status";
#[derive(Clone, PartialEq, Eq)]
pub struct Principal {
    pub issuer: String,
    pub subject: String,
    pub client: String,
    pub resource: String,
}
impl Principal {
    fn valid(&self) -> bool {
        [&self.issuer, &self.subject, &self.client, &self.resource].iter()
            .all(|s| !s.is_empty() && s.len() <= 512 && !s.chars().any(char::is_control))
    }
}
/// Trusted middleware output, not an access token or proof of authentication by itself.
pub struct VerifiedClaims<'a> {
    pub principal: &'a Principal,
    pub scopes: &'a [&'a str],
    pub not_before: u64,
    pub expires: u64,
}
/// Created by a trusted owner-consent controller, never request parameters.
/// Generation must be persistent/monotonic in the future owner controller.
pub struct OwnerGrant {
    pub principal: Principal,
    pub generation: u64,
}
pub struct BoundSession {
    principal: Principal,
    generation: u64,
    last_time: u64,
    revoked: bool,
    protocol: Session,
}
impl BoundSession {
    pub fn from_owner_grant(grant: OwnerGrant, now: u64) -> Option<Self> {
        if !grant.principal.valid() || grant.generation == 0 { return None; }
        Some(Self { principal: grant.principal, generation: grant.generation,
            last_time: now, revoked: false, protocol: Session::default() })
    }
    pub fn revoke(&mut self) { self.revoked = true; self.protocol.revoke(); }
    /// Serial offline admission. `current_generation` and `now` MUST come from the
    /// trusted owner controller/clock, not client headers. No concurrent cancellation.
    pub fn handle(&mut self, gate: &Gate<'_>, claims: Option<&VerifiedClaims<'_>>,
                  current_generation: u64, now: u64, request: Request<'_>) -> Response {
        if self.revoked { return Response::Refused(404); }
        if current_generation != self.generation || now < self.last_time {
            self.revoke(); return Response::Refused(404);
        }
        self.last_time = now;
        let Some(c) = claims else { return Response::Refused(401); };
        if c.principal != &self.principal || !c.principal.valid()
            || c.not_before > now || now >= c.expires || c.not_before >= c.expires {
            return Response::Refused(401);
        }
        if c.scopes.len() > 32 || c.scopes.iter().any(|s| s.len() > 128)
            || !c.scopes.contains(&STATUS_SCOPE) { return Response::Refused(403); }
        gate.handle(&mut self.protocol, true, request)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn principal() -> Principal { Principal { issuer:"https://issuer.example".into(),
        subject:"synthetic-owner".into(), client:"synthetic-client".into(),
        resource:"https://resource.example/mcp".into() } }
    fn session() -> BoundSession { BoundSession::from_owner_grant(OwnerGrant {
        principal:principal(), generation:7 }, 100).unwrap() }
    fn claims(p: &Principal) -> VerifiedClaims<'_> { VerifiedClaims {
        principal:p, scopes:&[STATUS_SCOPE], not_before:100, expires:200 } }
    fn call(s:&mut BoundSession,c:Option<&VerifiedClaims<'_>>,g:u64,n:u64) -> Response {
        raw(s,c,g,n,br#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#)
    }
    fn raw(s:&mut BoundSession,c:Option<&VerifiedClaims<'_>>,g:u64,n:u64,body:&[u8]) -> Response {
        let len = body.len().to_string();
        s.handle(&Gate {authority:"resource.example",allowed_origins:&[]},c,g,n,
            Request { method:"POST",path:"/mcp",headers:&[("MCP-Protocol-Version",crate::VERSION),("Host","resource.example"),
            ("Content-Type","application/json"),("Content-Length",&len),
            ("Accept","application/json, text/event-stream")],body })
    }
    #[test] fn valid_and_missing_per_request_claims() {
        let p=principal(); let c=claims(&p); let mut s=session();
        assert!(matches!(call(&mut s,Some(&c),7,100),Response::Json(ref v) if v.get("result").is_some() && v.get("error").is_none()));
        assert_eq!(call(&mut s,None,7,101),Response::Refused(401));
        assert!(matches!(call(&mut s,Some(&c),7,102),Response::Json(ref v) if v.get("result").is_some() && v.get("error").is_none()));
    }
    #[test] fn each_identity_dimension_is_bound() {
        for field in 0..4 { let mut p=principal();
            match field {0=>p.issuer.push('x'),1=>p.subject.push('x'),
                2=>p.client.push('x'),_=>p.resource.push('x')};
            assert_eq!(call(&mut session(),Some(&claims(&p)),7,100),Response::Refused(401));
        }
    }
    #[test] fn lifetime_boundaries_and_refresh() {
        let p=principal(); let mut c=claims(&p); let mut s=session();
        assert!(matches!(call(&mut s,Some(&c),7,199),Response::Json(ref v) if v.get("result").is_some() && v.get("error").is_none()));
        assert_eq!(call(&mut s,Some(&c),7,200),Response::Refused(401));
        c.expires=300;
        assert!(matches!(call(&mut s,Some(&c),7,200),Response::Json(ref v) if v.get("result").is_some() && v.get("error").is_none()));
        c.not_before=201;
        assert_eq!(call(&mut s,Some(&c),7,200),Response::Refused(401));
        c.not_before=301;
        assert_eq!(call(&mut s,Some(&c),7,200),Response::Refused(401));
    }
    #[test] fn scope_is_exact_and_bounded() {
        let p=principal(); let mut c=claims(&p);
        c.scopes=&["computer-link:status-extra"];
        assert_eq!(call(&mut session(),Some(&c),7,100),Response::Refused(403));
        let scopes=vec![STATUS_SCOPE;33]; c.scopes=&scopes;
        assert_eq!(call(&mut session(),Some(&c),7,100),Response::Refused(403));
    }
    #[test] fn explicit_revocation_is_irreversible() {
        let p=principal(); let c=claims(&p); let mut s=session(); s.revoke();
        assert_eq!(call(&mut s,Some(&c),7,100),Response::Refused(404));
    }
    #[test] fn generation_change_and_clock_rollback_revoke() {
        let p=principal(); let c=claims(&p);
        for (g,n) in [(8,100),(6,100),(7,99)] {let mut s=session();
            assert_eq!(call(&mut s,Some(&c),g,n),Response::Refused(404));
            assert_eq!(call(&mut s,Some(&c),7,100),Response::Refused(404));
        }
    }
    #[test] fn denied_requests_never_consume_protocol_budget() {
        let p=principal(); let c=claims(&p); let mut s=session();
        for _ in 0..200 { assert_eq!(call(&mut s,None,7,100),Response::Refused(401)); }
        assert!(matches!(call(&mut s,Some(&c),7,100),Response::Json(ref v) if v.get("result").is_some() && v.get("error").is_none()));
    }
    #[test] fn full_bound_lifecycle_and_denied_init_preserves_state() {
        let p=principal();let c=claims(&p);let mut s=session();
        let init=br#"{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"synthetic","version":"1"}}}"#;
        assert_eq!(raw(&mut s,None,7,100,init),Response::Refused(401));
        let Response::Json(v)=raw(&mut s,Some(&c),7,100,init) else { panic!("init refused") };
        assert_eq!(v["result"]["protocolVersion"],crate::VERSION);
        assert!(v.get("error").is_none());
        assert_eq!(raw(&mut s,Some(&c),7,100,br#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#),Response::Accepted);
        let Response::Json(v)=raw(&mut s,Some(&c),7,100,br#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"connection_status","arguments":{}}}"#) else {panic!("status refused")};
        assert!(v.get("error").is_none());
        assert!(v["result"]["content"][0]["text"].as_str().unwrap().contains("NOT CONNECTED"));
        s.revoke();
        assert_eq!(raw(&mut s,Some(&c),7,100,init),Response::Refused(404));
    }
    #[test] fn invalid_grant_is_not_a_session() {
        for value in ["".to_string(), "x".repeat(513), "bad\nsubject".into()] {
            let mut p=principal();p.subject=value;
            assert!(BoundSession::from_owner_grant(OwnerGrant {principal:p,generation:7},100).is_none());
        }
        assert!(BoundSession::from_owner_grant(OwnerGrant {principal:principal(),generation:0},100).is_none());
    }
}
