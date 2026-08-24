# OAuth configuration templates

Copy `.env.release.example` to an untracked `.env.release` as a local naming reference if useful. The build reads process environment variables and intentionally does not load env files automatically.

Google must be a Chrome Extension OAuth client bound to extension ID `geljambmkfjkhodgkpjhnmfojkpcamig`. GitHub must be an OAuth App with device flow enabled. Client IDs are public; secrets/tokens are prohibited here.

See `docs/OAUTH-PROVISIONING-CHECKLIST.md` for the exact console values, current provisioning status, acceptance procedure, and release handoff. See `docs/OAUTH.md` for the architecture and runtime behavior.
