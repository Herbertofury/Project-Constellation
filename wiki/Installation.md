# Installation

## Windows 0.23.0 quick setup

Use the self-contained Windows Setup executable from the matching GitHub release. It stages sensors, registers the Rust hub and includes Computer Tools. Browser enablement remains one step per profile. See [Windows setup](https://github.com/Herbertofury/Project-Constellation/blob/main/docs/WINDOWS-SETUP.md) for the complete install, repair, rollback and lifecycle guide.


## Release install

1. Download `Project-Constellation-v0.23.0-Extension.zip` and `SHA256SUMS-v0.23.0.txt` from the matching GitHub Release.
2. Verify SHA-256 in PowerShell:

   ```powershell
   Get-FileHash .\Project-Constellation-v0.23.0-Extension.zip -Algorithm SHA256
   ```

3. Extract the ZIP to a permanent directory. Chrome expects that directory to remain available.
4. Open `chrome://extensions`.
5. Enable **Developer mode** and select **Load unpacked**.
6. Choose the extracted directory containing `manifest.json`.
7. Confirm the extension ID is `geljambmkfjkhodgkpjhnmfojkpcamig`.
8. Pin the extension, open Project Constellation, and visit **Accounts & Connections**.

Do not load the source repository root; load `build/unpacked` during development or the extracted release directory for normal use.

## Upgrade from v0.13.0

The stable manifest key and storage schema preserve the extension identity and local browser data. Extract v0.23.0 to a new permanent folder, open the existing extension’s details in `chrome://extensions`, and reload it from the new unpacked folder. Do not remove the old extension first unless you already exported or remotely verified the local brain; removing an extension can delete its browser storage.

After reload:

1. Open Home and check the status bar/catalog counts.
2. Open **Accounts & Connections** and verify provider sessions.
3. Reconnect Google/GitHub only if verification reports authorization missing/expired.
4. Run **Round-trip verify** for Drive.
5. Open an existing ChatGPT chat and confirm Execution Pulse plus its permanent **⇄ Output Vault** control appear.

## Development install

Run `npm run build:dev`, then load `build/unpacked`. Development builds are clearly labeled and deliberately contain no OAuth configuration unless valid client IDs were provided. Use them for local UI/capture testing, not production OAuth acceptance.

## Uninstall safely

Before removing the extension, export the local brain and/or complete a verified Drive sync. Verify the resulting receipt and remote snapshot. Then remove the extension from `chrome://extensions`.
