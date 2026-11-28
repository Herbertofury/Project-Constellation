'use strict';
const path = require('node:path');
const { verifyNativePayload } = require('./verify-native-resources.cjs');
module.exports = async context => {
  if (context.electronPlatformName !== 'win32') return;
  await verifyNativePayload(path.join(context.appOutDir, 'resources/computer-link'), context.packager.appInfo.version);
};
