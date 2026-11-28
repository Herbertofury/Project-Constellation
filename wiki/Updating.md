# Updating Project Constellation

## Installed from a GitHub release

1. Export a recovery snapshot from the Project Constellation home page.
2. Download the matching `Project-Constellation-vX.Y.Z-Extension.zip` asset and `SHA256SUMS-vX.Y.Z.txt` from GitHub Releases, substituting the release version for `X.Y.Z`.
3. Verify the archive SHA-256 value against that checksum file.
4. Extract the verified archive into a staging directory. Verify your exported recovery snapshot and copy the currently installed unpacked directory to a separate backup location.
5. Replace the contents of the already-registered permanent directory with the verified staged contents, keeping its path unchanged and the backup separate. Do not merge old and new release files. Open `chrome://extensions` and use **Reload** on the existing extension; Reload uses the registered path and does not choose a new folder. Do not remove the extension.
6. Open the home page and confirm the version, knowledge counts, provider status, and latest recovery checkpoint.
7. Reconnect a provider only if its authorization was revoked or the extension ID changed.

Retain the known-good backup until the new build has opened and the checks above
succeed. If the update cannot load, restore the previous contents at the same
registered path and reload again. See [Installation](Installation) for the full
procedure. Setup-managed Windows installations should use [Install / Repair](Windows-Setup)
and then reload their existing browser sensor.

## Installed from source

```powershell
git pull --ff-only
npm ci
npm run verify
npm run build
```

Production builds require the approved OAuth client identifiers described in [OAuth and provider setup](OAuth-and-Provider-Setup). Reload `build/unpacked` from `chrome://extensions` after a successful build.

## Data compatibility

Project Constellation keeps durable state in versioned Chrome storage and validates imported snapshots before applying them. The historical v0.14.0 upgrade preserved v0.13.0 knowledge, captures, recovery snapshots, settings, and provider configuration metadata. OAuth access and refresh tokens are never exported in recovery snapshots.
