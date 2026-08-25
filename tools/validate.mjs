import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.PROJECT_CONSTELLATION_ROOT ? path.resolve(process.env.PROJECT_CONSTELLATION_ROOT) : path.join(repoRoot, 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const required = ['manifest.json','background.js','popup.html','popup.css','popup.js','sidepanel.html','sidepanel.css','sidepanel.js','home.html','home.css','home.js','offscreen.html','offscreen.js','src/core.js','src/brain-core.js','src/provider-core.js','src/integrity-core.js','src/knowledge-core.js','src/health-core.js','src/live-sentinel.js','src/content.js','src/styles.css'];
for (const file of required) if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}`);
const releaseSupportFiles = [
  'config/oauth/.env.release.example',
  'config/oauth/README.md',
  'PRIVACY.md',
  'docs/OAUTH.md',
  'docs/OAUTH-PROVISIONING-CHECKLIST.md',
  'docs/RELEASING.md',
  `docs/v${manifest.version}-release-notes.md`,
  'wiki/OAuth-and-Provider-Setup.md',
  'wiki/Privacy-Policy.md',
  'wiki/Release-Process.md',
  'wiki/Updating.md'
];
for (const file of releaseSupportFiles) if (!fs.existsSync(path.join(repoRoot, file))) throw new Error(`Missing release-support file ${file}`);
const oauthTemplate = fs.readFileSync(path.join(repoRoot, 'config/oauth/.env.release.example'), 'utf8');
for (const forbiddenAssignment of ['CLIENT_SECRET=', 'ACCESS_TOKEN=', 'REFRESH_TOKEN=']) {
  if (oauthTemplate.includes(forbiddenAssignment)) throw new Error(`OAuth template must never contain ${forbiddenAssignment}`);
}
const oauthChecklist = fs.readFileSync(path.join(repoRoot, 'docs/OAUTH-PROVISIONING-CHECKLIST.md'), 'utf8');
for (const marker of ['project-constellation-506518', 'geljambmkfjkhodgkpjhnmfojkpcamig', 'drive.file', 'PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID', 'PROJECT_CONSTELLATION_GITHUB_CLIENT_ID', 'real signed-in']) {
  if (!oauthChecklist.includes(marker)) throw new Error(`OAuth provisioning checklist missing ${marker}`);
}
const updatingGuide = fs.readFileSync(path.join(repoRoot, 'wiki/Updating.md'), 'utf8');
if (!updatingGuide.includes('Project-Constellation-vX.Y.Z-unpacked.zip')) throw new Error('Wiki update guide must name the generated unpacked release asset.');
if (manifest.manifest_version !== 3) throw new Error('Manifest must be MV3');
if (manifest.name !== 'Project Constellation') throw new Error('Branding must be Project Constellation');
if (manifest.version !== JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version) throw new Error('Manifest and package versions must match.');
if (!manifest.side_panel?.default_path) throw new Error('Side panel missing');
if (!manifest.background?.service_worker) throw new Error('Service worker missing');
if (!manifest.permissions?.includes('identity') || !manifest.permissions?.includes('alarms') || !manifest.permissions?.includes('offscreen') || !manifest.permissions?.includes('webRequest')) throw new Error('Identity, alarms, offscreen, and passive webRequest health telemetry are required.');
if (!manifest.optional_permissions?.includes('history')) throw new Error('Optional browser history discovery permission is required for zero-tab deep cataloging.');

const content = fs.readFileSync(path.join(root, 'src/content.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
for (const forbidden of ['.remove()','removeChild(','content-visibility','display: none']) if (content.includes(forbidden)) throw new Error(`Forbidden conversation-loss primitive: ${forbidden}`);
if (/\bfetch\s*\(/.test(content) || /XMLHttpRequest/.test(content)) throw new Error('Content script must never make network requests');
if (/retry[^\n]{0,160}\.click\s*\(/i.test(content)) throw new Error('Delivery/network recovery must never click Retry; browser refresh is the recovery primitive.');

const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
if (!content.includes('rate-limited') || !background.includes('noteProviderRateLimit')) throw new Error('Rate-limit governor/recovery state is missing.');
if (!background.includes('api.github.com') || !background.includes('www.googleapis.com')) throw new Error('Expected remote sync adapters are missing.');
for (const marker of ['GITHUB_TOKEN_META_KEY','githubRefreshAccessToken','grant_type: \'refresh_token\'','offline_access','refresh_token_expires_in']) if (!background.includes(marker)) throw new Error(`Refresh-safe GitHub OAuth missing: ${marker}`);
for (const marker of ['grantedScopes','DRIVE_SCOPE','driveConnectionStatus({ verify: true })']) if (!background.includes(marker)) throw new Error(`Verified Google OAuth missing: ${marker}`);
if (/chrome\.tabs\.create\s*\(\s*\{[^}]*active\s*:\s*false/s.test(background)) throw new Error('Automatic background catalog must never create hidden tabs.');
if (!background.includes('chrome.windows.create') || !background.includes('manual-full-capture')) throw new Error('Explicit one-window manual full-capture fallback is missing.');
const fullCaptureStart = background.indexOf('async function ensureFullCaptureWindow');
const fullCaptureEnd = background.indexOf('async function waitForTabComplete', fullCaptureStart);
const fullCaptureBlock = fullCaptureStart >= 0 && fullCaptureEnd > fullCaptureStart ? background.slice(fullCaptureStart, fullCaptureEnd) : '';
if (fullCaptureBlock.includes("state: 'minimized'") || fullCaptureBlock.includes('state:"minimized"')) throw new Error('Full Capture must not use minimized windows; hidden-page throttling breaks reliability.');
if (!background.includes('APPROVAL_RECOVERY_STATE_KEY') || !background.includes("state: 'minimized'")) throw new Error('Approval Recovery must keep its explicit one-tab background lane separate from Full Capture.');
for (const marker of ['PC_GITHUB_OAUTH_START','PC_GITHUB_OAUTH_POLL','PC_DRIVE_CONNECT','PC_PROVIDER_SESSION_STATUS','PC_CONNECTIONS_STATUS','PC_FULL_CAPTURE_RUNNER_DONE','PC_APPROVAL_RECOVERY_START','PC_APPROVAL_RECOVERY_STOP','PC_REFRESH_RECOVERY_REQUEST','PC_INTEGRITY_SCAN','PC_REQUEST_GOVERNOR_STATUS','PC_KNOWLEDGE_SUMMARY','PC_KNOWLEDGE_LIST','PC_KNOWLEDGE_REINDEX','knowledgeItems','projectContinuity','watchForStalls','updateAttentionBadge']) if (!background.includes(marker)) throw new Error(`Readiness backend missing: ${marker}`);
if (!background.includes('onMessage.addListener((message, sender, sendResponse)')) throw new Error('Capture runner sender identity must be preserved.');
const homeHtml = fs.readFileSync(path.join(root, 'home.html'), 'utf8');
const homeJs = fs.readFileSync(path.join(root, 'home.js'), 'utf8');
if (!homeHtml.includes('Capture all chats')) throw new Error('Home must expose the explicit Capture all chats control.');
for (const marker of ['Connections','Sign in with Google','Sign in with GitHub','Capture all chats','Always allow all connected-app prompts','Fix all known ChatGPT chats']) if (!homeHtml.includes(marker)) throw new Error(`Premium readiness control missing: ${marker}`);
for (const marker of ['Projects & Groups','+ Group','+ Smart collection','+ Project','orgProjectGrid','orgBulkBar']) if (!homeHtml.includes(marker)) throw new Error(`Organization Home control missing: ${marker}`);
for (const marker of ['PC_ORG_SUMMARY','PC_ORG_CHATS','PC_ORG_PROJECT_CREATE','PC_ORG_CHAT_PATCH','application/x-project-constellation-chat','application/x-project-constellation-project']) if (!homeJs.includes(marker) && !background.includes(marker)) throw new Error(`Organization workflow missing: ${marker}`);
for (const marker of ['groups:', 'smartCollections:', 'workspaceProjectStatus', 'workspaceProjectId']) if (!background.includes(marker)) throw new Error(`Organization database index missing: ${marker}`);
for (const marker of ['structuredTurnLinks','structuredCodeBlocks','structuredTurnFormattedText','structuredTurnAssets','queueEmbeddedMediaCapture']) if (!content.includes(marker)) throw new Error(`Structured output capture missing: ${marker}`);
for (const marker of ['Knowledge Vault','knowledgeBrowser','continuityShelf','rebuildKnowledge']) if (!homeHtml.includes(marker)) throw new Error(`Knowledge Vault UI missing: ${marker}`);

const healthCore = fs.readFileSync(path.join(root, 'src/health-core.js'), 'utf8');
for (const marker of ['deriveHealth','stale-page','output-regressed','tool-running','tool-stalled','tool-dead','request-stalled','dead','refresh-required','old-project-version']) if (!healthCore.includes(marker)) throw new Error(`Live Chat Health core missing: ${marker}`);
for (const marker of ['projectConstellationHealthHud','projectConstellationOutputVault','PC_LIVE_HEALTH_CONTEXT','PC_OUTPUT_OBSERVE','PC_OUTPUT_COMPARE','PC_OUTPUT_TURN_REVISIONS','renderOutputVault','syncConstellationDock','pcVaultReader','pcVaultRaw','vaultRichText','liveHealthSettings','toolPhaseFromLabel','liveHealthToolSteps','Tool pulse','Output Vault','PC_BRANCH_CHAT','PC_BRANCH_CONTINUATION_CLAIM','PC_BRANCH_LINEAGE_RESOLVE','Branch &amp; continue']) if (!content.includes(marker)) throw new Error(`Live Chat Health and Output Vault content workflow missing: ${marker}`);
for (const marker of ['toolEvidenceDirty','pendingRoots.size > 40','document.hidden ? 30000','conversation-turn-',':session:']) if (!content.includes(marker)) throw new Error(`Current compatibility/performance control missing: ${marker}`);
for (const marker of ["id: 'grok'","id: 'deepseek'","id: 'metaai'","id: 'qwen'","id: 'kimi'","id: 'characterai'","id: 'huggingchat'","id: 'you'","id: 'pi'","id: 'duckai'"]) if (!content.includes(marker) && !fs.readFileSync(path.join(root, 'src/provider-core.js'), 'utf8').includes(marker)) throw new Error(`Common AI provider missing: ${marker}`);
if (!content.includes("? 'guest'")) throw new Error('Guest and signed-in AI sessions must be distinguished truthfully.');
for (const marker of ['PC_LIVE_HEALTH_CONTEXT','liveNetworkByTab','oldestPendingAt','chrome.webRequest.onBeforeRequest','latestTurnsForChat','PC_OUTPUT_OBSERVE','PC_OUTPUT_COMPARE','PC_OUTPUT_TURN_REVISIONS','turnRevisions','outputSnapshots','preserveTurnRevisions','compareObservedOutput','PC_BRANCH_CHAT','PC_BRANCH_CONTINUATION_CLAIM','PC_BRANCH_CONTINUATION_COMPLETE','PC_BRANCH_LINEAGE_RESOLVE','branchContinuationPrompt']) if (!background.includes(marker)) throw new Error(`Live Chat Health and Output Vault backend missing: ${marker}`);
for (const marker of ['LIVE CHAT HEALTH','liveHealthEnabled','liveHealthToolWatchdog','liveHealthDeadStall','liveHealthCorner','liveHealthDensity']) if (!homeHtml.includes(marker)) throw new Error(`Live Chat Health settings UI missing: ${marker}`);

for (const marker of ['PC_KNOWLEDGE_LIST','PC_KNOWLEDGE_REINDEX','loadKnowledge','knowledgeCard','continuityCard']) if (!homeJs.includes(marker)) throw new Error(`Knowledge Vault workflow missing: ${marker}`);
if (!background.includes("reasons: ['DOM_PARSER']")) throw new Error('True offscreen DOM parser path is missing.');
for (const banned of ['chatgpt-bliss','GPT_BLISS','gptBliss','GptBliss','Bliss Constellation','CHATGPT BLISS']) {
  const files = required.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  if (files.includes(banned)) throw new Error(`Legacy branding remains: ${banned}`);
}
const executable = required.filter((file) => file.endsWith('.js')).map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(executable)) throw new Error('Dynamic code execution is forbidden.');
if (!homeJs.includes('const safeUrl =') || !fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8').includes('const safeUrl =')) throw new Error('External navigation allow-list is missing.');
console.log('validate.mjs: PASS');
