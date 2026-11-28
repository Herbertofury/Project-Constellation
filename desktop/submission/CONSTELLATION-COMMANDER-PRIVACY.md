# Constellation Commander Privacy Policy

Constellation Commander is designed to let a user operate computers they explicitly pair with a relay they control.

## Data processed

The relay necessarily processes MCP tool requests, device routing identifiers, authorization tokens, tool results, basic device status, and bounded recent tool-call history so requested actions can be routed and continuity can work across chats. The Windows companion processes local files, commands, and process information only when invoked by an authorized tool call and subject to the companion's local policy.

## Storage

Relay state is stored on the operator's configured persistent storage. Device bearer tokens and ChatGPT OAuth access/refresh tokens are stored as hashes by the relay; short-lived pairing state may temporarily contain the newly issued device credential until the device redeems it. The local companion stores its pairing credential in the user's local Commander configuration.

## No sale or advertising use

Constellation Commander does not sell personal information and does not use Commander content for advertising. The reference implementation contains no third-party analytics or telemetry by default.

## User control

Users can disconnect the desktop companion, revoke/delete relay state, restrict local allowed roots and commands, or stop the relay. Removing a device credential from the relay invalidates that device's connection.

## OpenAI

ChatGPT plugin requests are also subject to OpenAI's own terms and privacy practices. Constellation Commander does not require an OpenAI API key for its normal ChatGPT plugin transport.

## Contact

Project issues and support are handled through the Project Constellation repository: https://github.com/Herbertofury/Project-Constellation
