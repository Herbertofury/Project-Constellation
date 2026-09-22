# Constellation Commander v0.2.0 checkpoint

Windows acceptance is green on Actions run **35749916108** at branch commit `febfeb037b7f38c6d4af30d4cb4d5efbb1f3284e`.

Verified deliverables:

- Windows: `Constellation-Commander-Windows-x64-v0.2.0.zip` — SHA-256 `d0dc1dc40e23c7c980418bbaac6da02cd164c24a910ebea066268e6f1d5e9485` — Drive ID `1RvIWI7ZVWVv5ozzgdULlFc5mbMQ-sNUQ`
- Plugin package: `Constellation-Commander-Plugin-v0.2.0.zip` — SHA-256 `ad786dd1ca33928786d10b93cc65bec91b48d0c37b98904815074c63db8b3f23` — Drive ID `1hOGtuKgQ6BNcila3BVuU1yOJrMuBlskY`
- Source: `Constellation-Commander-v0.2.0-source.zip` — SHA-256 `0ac8db900ad34c449c6e85bff2ae16db64b992832db5a4799128cbc549c27b27` — Drive ID `1RfG8DvjJh-t_FG-PNobRAWurVwZwdFRN`

Architecture: normal ChatGPT plugin -> OpenAI registered app/MCP binding -> OAuth 2.1 + PKCE self-hosted relay -> outbound-only Windows companion -> local Commander executor.

No ChatGPT Work transport, no OpenAI API key, and no Constellation Commander tool-call quota are part of the runtime design.

Remaining external activation gates: deploy the relay at a stable HTTPS hostname, then register/submit the production MCP endpoint through OpenAI's normal **With MCP** plugin flow and bind the resulting app identity. Do not add direct `mcp.json` to the imported plugin package; OpenAI marks such imported plugins Desktop-only.
