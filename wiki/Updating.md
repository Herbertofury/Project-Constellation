# Updating Project Constellation

## Installed from a GitHub release

1. Export a recovery snapshot from the Project Constellation home page.
2. Download the new `Project-Constellation-vX.Y.Z.zip` asset and its checksum file from GitHub Releases.
3. Verify the archive SHA-256 value against `SHA256SUMS.txt`.
4. Extract the archive into a new, versioned directory.
5. Open `chrome://extensions`, enable **Developer mode**, and use **Load unpacked** for that directory. If Chrome retained the same extension identity, use its reload button instead.
6. Open the home page and confirm the version, knowledge counts, provider status, and latest recovery checkpoint.
7. Reconnect a provider only if its authorization was revoked or the extension ID changed.

Never overwrite the only known-good unpacked directory before the new build has opened successfully.

## Installed from source

```powershell
git pull --ff-only
npm ci
npm run verify
npm run build
```

Production builds require the approved OAuth client identifiers described in [OAuth and provider setup](OAuth-and-Provider-Setup). Reload `build/unpacked` from `chrome://extensions` after a successful build.

## Data compatibility

Project Constellation keeps durable state in versioned Chrome storage and validates imported snapshots before applying them. The v0.14.0 upgrade preserves v0.13.0 knowledge, captures, recovery snapshots, settings, and provider configuration metadata. OAuth access and refresh tokens are never exported in recovery snapshots.

