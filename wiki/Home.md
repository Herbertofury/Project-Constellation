# Project Constellation Wiki

Project Constellation is a privacy-first Chrome extension that preserves ChatGPT conversations, turns them into durable local knowledge, and helps recover safely when long chats or browser sessions become fragile.

Version **0.23.0** adds verified observation delivery, bounded failed-channel alert retries, burst-resistant native transport, clearer unavailable-source triage and repair after rollback. It combines the original project, conversation and desktop tools
with durable attention alerts, explicit cross-browser monitoring, a Rust hub
that follows browser lifetime, a compact Windows installer and the complete
Computer-Link native toolkit. Use the [Windows setup guide](Windows-Setup),
[Agent Monitor guide](Agent-Monitor) and [Computer Tools migration map](Computer-Tools).

The compact installer includes native tools and stages browser sensors. Enable
a sensor in every browser/profile you want to monitor. The full desktop shell
also ships separately as an installer and portable ZIP. The release is a
prerelease while Firefox signing, Windows publisher signing and owner account
acceptance remain open. Check the actual [GitHub release and runtime receipts](https://github.com/Herbertofury/Project-Constellation/releases/tag/v0.23.0)
for executed evidence.
## Start here

- [Install Project Constellation](Installation)
- [Configure Google Drive and GitHub](OAuth-and-Provider-Setup)
- [Review AI provider support](AI-Provider-Support)
- [Understand the features](Features)
- [Troubleshoot a problem](Troubleshooting)
- [Recover or restore data](Recovery)

## For maintainers

- [Architecture](Architecture)
- [Folder structure](Folder-Structure)
- [ChatGPT integration](ChatGPT-Integration)
- [AI provider support](AI-Provider-Support)
- [Performance behavior](Performance)
- [Development and building](Development-and-Building)
- [Updating](Updating)
- [Security and privacy](Security-and-Privacy)
- [Contributor and agent continuation](Contributor-and-Agent-Continuation)

The canonical source is [Herbertofury/Project-Constellation](https://github.com/Herbertofury/Project-Constellation). ProjectDump is retained only as historical provenance; Project Constellation no longer depends on it.

Before enabling remote sync, read the [privacy policy](Privacy-Policy). Maintainers should use the [production release process](Release-Process) so the source, packaged artifacts, Wiki, and Drive checkpoint remain one verified state.
