//! Deliberately narrow browser handoff. No browser profiles, cookies or shell commands.
//! DNS syntax is not network isolation: a public-looking host may resolve privately.
use std::io;

#[derive(Debug, PartialEq)]
pub struct HttpsLink { url: String, host: String }
impl HttpsLink {
    pub fn parse(bytes: &[u8]) -> io::Result<Self> {
        let reject = || io::Error::other("one ASCII HTTPS URL with a dotted DNS host required");
        let raw = std::str::from_utf8(bytes).map_err(|_| reject())?;
        // Permit a text editor's final newline, never embedded whitespace or control bytes.
        let url = raw.strip_suffix("\r\n").or_else(|| raw.strip_suffix('\n')).unwrap_or(raw);
        if url.len() > 2048 || !url.is_ascii() || url.bytes().any(|b| b <= 32 || b == 127 || b == b'\\' || b == b'"' || b == b'\'' || b == b'<' || b == b'>') { return Err(reject()); }
        let rest = url.strip_prefix("https://").ok_or_else(reject)?;
        let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
        let host = &rest[..end];
        // Ports, credentials, IPv4/IPv6 literals, escaped hosts and IDNs are unsupported.
        let labels: Vec<_> = host.split('.').collect();
        if host.len() > 253 || labels.len() < 2 || labels.iter().any(|label|
            label.is_empty() || label.len() > 63 || label.starts_with('-') || label.ends_with('-') ||
            !label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') || label.to_ascii_lowercase().starts_with("xn--")) {
            return Err(reject());
        }
        let tld = labels.last().unwrap().to_ascii_lowercase();
        if tld.len() < 2 || !tld.bytes().all(|b| b.is_ascii_alphabetic()) ||
            ["localhost", "local", "internal", "home", "lan", "test", "invalid", "onion"].contains(&tld.as_str()) { return Err(reject()); }
        // Keep display and launch identical; reject malformed escapes and encoded control bytes.
        let bytes = url.as_bytes(); let mut i = end + 8;
        while i < bytes.len() {
            if bytes[i] == b'%' {
                if i + 2 >= bytes.len() { return Err(reject()); }
                let hex = |b:u8| (b as char).to_digit(16);
                let value = match (hex(bytes[i+1]),hex(bytes[i+2])) { (Some(a),Some(b)) => a*16+b, _ => return Err(reject()) };
                if value <= 32 || value == 127 || value == 34 || value == 39 || value == 92 { return Err(reject()); }
                i += 3;
            } else { i += 1; }
        }
        Ok(Self { url: url.to_owned(), host: host.to_ascii_lowercase() })
    }
    pub fn url(&self) -> &str { &self.url }
    pub fn host(&self) -> &str { &self.host }
    /// Caller must display this exact immutable URL before approval. Disconnect fences it.
    pub fn open_if_current<F>(&self, approved: bool, generation: u64, current: u64, launch: F) -> io::Result<bool>
    where F: FnOnce(&str) -> io::Result<()> {
        if !approved || generation != current { return Ok(false); }
        launch(&self.url)?;
        Ok(true)
    }
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn exact_url_and_editor_newline() {
        let link = HttpsLink::parse(b"https://Example.com/path?q=one%2Ftwo#part\r\n").unwrap();
        assert_eq!(link.host(),"example.com");
        assert_eq!(link.url(),"https://Example.com/path?q=one%2Ftwo#part");
    }
    #[test] fn rejects_ambiguous_or_privileged_targets() {
        for value in ["file:///C:/x", "javascript:alert(1)", "http://example.com", "https://localhost/", "https://127.0.0.1/", "https://[::1]/", "https://host.local/", "https://a:443/", "https://user@example.com/", "https://example.com\\@evil.com/", "https://example.com/a\nb", "https://example.com/%00", "https://example.com/%22", "https://example.com/\"x", "https://example.com/%0d%0a", "https://example.com/%x0", "https://example.com/%", "https://xn--test.com/", "https://example.com./", "https://-example.com/", "https://example.com:443/", "https://2130706433/", "https://a.123/", "https://éxample.com/"] { assert!(HttpsLink::parse(value.as_bytes()).is_err(),"rejected fixture"); }
        assert!(HttpsLink::parse(&[255]).is_err());
        assert!(HttpsLink::parse(format!("https://example.com/{}","x".repeat(2048)).as_bytes()).is_err());
    }
    #[test] fn denial_and_revocation_never_launch() {
        let link=HttpsLink::parse(b"https://example.com/").unwrap();
        for (yes,old,new) in [(false,1,1),(true,1,2)] { assert!(!link.open_if_current(yes,old,new, |_| panic!("must not launch")).unwrap()); }
        let mut seen=String::new();
        assert!(link.open_if_current(true,2,2,|s| {seen=s.into();Ok(())}).unwrap());
        assert_eq!(seen,link.url());
        assert!(link.open_if_current(true,2,2, |_|Err(io::Error::other("launcher unavailable"))).is_err());
    }
}

/// One synchronous OS handoff; no command interpreter or argument string.
/// The injectable boundary is internal, not an environment-controlled runtime hook.
fn shell_handoff<F>(url: &str, invoke: F) -> io::Result<()>
where F: FnOnce(&[u16], &[u16]) -> isize {
    let verb: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
    let target: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
    if invoke(&verb, &target) <= 32 {
        Err(io::Error::other("Windows did not accept browser handoff"))
    } else { Ok(()) }
}
#[cfg(windows)]
pub fn open_default_browser(owner: isize, link: &HttpsLink) -> io::Result<()> {
    use std::{ffi::c_void, ptr};
    #[link(name="shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(h: *mut c_void, verb: *const u16, file: *const u16,
            args: *const u16, dir: *const u16, show: i32) -> *mut c_void;
    }
    shell_handoff(link.url(), |verb, target| unsafe {
        ShellExecuteW(owner as *mut c_void, verb.as_ptr(), target.as_ptr(),
            ptr::null(), ptr::null(), 1) as isize
    })
}
#[cfg(test)] mod shell_tests {
    use super::*;
    #[test] fn approved_handoff_preserves_exact_target_and_os_result() {
        let url = format!("https://example.com/{}?q=one%2Ftwo#end", "x".repeat(1900));
        let link = HttpsLink::parse(url.as_bytes()).unwrap();
        let mut calls=0;
        assert!(link.open_if_current(true, 4, 4, |selected| shell_handoff(selected, |verb, target| {
            calls+=1;
            assert_eq!(verb, &[111,112,101,110,0]);
            assert_eq!(target.last(),Some(&0));
            assert_eq!(String::from_utf16(&target[..target.len()-1]).unwrap(), url);
            33
        })).unwrap());
        assert_eq!(calls,1);
        for code in [0,2,5,8,26,27,28,29,30,31,32] {
            assert!(shell_handoff(link.url(), |_,_|code).is_err());
        }
        assert!(shell_handoff(link.url(), |_,_|34).is_ok());
    }
    #[test] fn denied_or_stale_approval_never_reaches_os_boundary() {
        let link=HttpsLink::parse(b"https://example.com/").unwrap();
        for (yes,generation,current) in [(false,1,1),(true,1,2)] {
            assert!(!link.open_if_current(yes,generation,current, |url| shell_handoff(url, |_,_|panic!("OS invoked"))).unwrap());
        }
    }
}
