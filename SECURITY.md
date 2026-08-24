# Security policy

Report vulnerabilities through GitHub private vulnerability reporting when available. Do not include live access tokens, refresh tokens, private chat exports, or account data in a public issue.

Supported security fixes target the latest release line. Project Constellation uses least-privilege optional host permissions for Google Drive and GitHub, the Google `drive.file` scope, Manifest V3 CSP defaults, bounded local parsing, and export paths that exclude OAuth tokens.

See [docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md) for the current threat model and audit findings.
