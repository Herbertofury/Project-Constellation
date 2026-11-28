#!/usr/bin/env node
import { createRemoteDeviceAgent } from '../src/remote-device.mjs';
const agent = await createRemoteDeviceAgent();
const stop = () => agent.stop();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await agent.run();
