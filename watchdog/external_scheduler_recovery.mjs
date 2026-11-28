// GitHub-side recovery supervision. No ChatGPT session or permission mutation.
export const ISSUE_TITLE = '[Watchdog] ChatGPT scheduler requires recovery';
export const PR_TITLE = '[Watchdog] External ChatGPT scheduler recovery pulse';
export const RECOVERY_BRANCH = 'watchdog/external-recovery-pulse';
const MARKER = 'constellation-recovery-state';
const COOLDOWN_MS = 60 * 60 * 1000;
const PHASE_STATES = new Set(['pending', 'attempting', 'dispatched', 'active', 'blocked', 'error']);

function requireHealth(health) {
  if (!health || !['healthy', 'stale', 'future', 'broken'].includes(health.scheduler_state)
      || !/^[a-f0-9]{64}$/.test(health.episode_key || '')
      || health.recovery_required !== (health.scheduler_state !== 'healthy')) {
    throw new Error('A validated committed-audit result is required.');
  }
}

function safeError(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) ? `GitHub HTTP ${status}` : 'GitHub request failed';
}

function phaseError(error, now, permissionMessage) {
  const blocked = error?.status === 403 && /not permitted|not accessible|forbidden|permission|denied|not allowed/i.test(String(error?.message || ''))
    && !/rate.limit|abuse|secondary limit/i.test(String(error?.message || ''));
  return {
    state: blocked ? 'blocked' : 'error', attempted_at: now,
    reason: blocked ? permissionMessage : safeError(error),
  };
}

export function readRecoveryState(body, episode, now = new Date().toISOString()) {
  const match = String(body || '').match(/<!-- constellation-recovery-state (\{[^\n]*\}) -->/);
  let raw;
  try { raw = JSON.parse(match?.[1] || '{}'); } catch { raw = {}; }
  const state = { schema: 1, episode, validation: { state: 'pending' }, bridge: { state: 'pending' } };
  if (raw.schema !== 1 || raw.episode !== episode) return state;
  for (const key of ['validation', 'bridge']) {
    const phase = raw[key];
    if (!phase || !PHASE_STATES.has(phase.state)) continue;
    const attempted = typeof phase.attempted_at === 'string' ? Date.parse(phase.attempted_at) : NaN;
    if (phase.state !== 'pending' && (!Number.isFinite(attempted) || attempted > Date.parse(now))) continue;
    state[key] = { state: phase.state };
    if (typeof phase.attempted_at === 'string' && Number.isFinite(Date.parse(phase.attempted_at))) {
      state[key].attempted_at = new Date(phase.attempted_at).toISOString();
    }
    // Issue bodies are external input. Only our fixed status messages are used
    // for public output; arbitrary marker fields cannot redirect API calls.
    if (phase.state === 'blocked') state[key].reason = key === 'bridge'
      ? 'Repository policy or token permissions block automatic pull requests.'
      : 'Token permissions block diagnostic workflow dispatch.';
    if (phase.state === 'error') state[key].reason = 'Previous GitHub request failed.';
  }
  return state;
}

function coolingDown(phase, now) {
  const age = Date.parse(now) - Date.parse(phase.attempted_at || '');
  return Number.isFinite(age) && age >= 0 && age < COOLDOWN_MS;
}

function issueBody(health, state) {
  return [
    'The committed ChatGPT scheduler audit requires attention.', '',
    `Audit state: ${health.scheduler_state}`,
    `Last recorded successful audit: ${health.last_ok_utc || 'unavailable'}`,
    `Stale threshold: ${health.stale_threshold_minutes ?? 'invalid'} minutes`,
    'This repository record does not measure current ChatGPT service health.', '',
    `Diagnostic UI validation: ${state.validation.state}`,
    'That workflow runs isolated fixtures and CDP tests; dispatch is not evidence of live task recovery.',
    `Recovery PR bridge: ${state.bridge.state}`,
    ...(state.bridge.reason ? [state.bridge.reason] : []),
    'A blocked bridge requires repository policy review; this supervisor never changes permissions or substitutes credentials.',
    'The next successful native scheduler audit must refresh watchdog/heartbeat.json. Only fresh valid audit evidence closes this incident.', '',
    'Repeated unchanged incidents update this record only when recovery state changes. Failed attempts and PR pulses have a one-hour cooldown.',
    'Recovery protocol: watchdog/recovery-protocol.md. No task prompts or credentials are stored here.', '',
    `<!-- ${MARKER} ${JSON.stringify(state)} -->`,
  ].join('\n');
}

export async function retryLatestFailedWatchdog({ github, owner, repo, branch = 'main' }) {
  const { data } = await github.rest.actions.listWorkflowRuns({
    owner, repo, workflow_id: 'chatgpt-watchdog-external.yml', branch, per_page: 10,
  });
  // Never select an older failure behind a success or an in-flight run. An
  // intentional cancellation or approval requirement is not a retry request.
  const latest = data.workflow_runs?.[0];
  if (!latest) return { state: 'not-needed' };
  if (latest.status !== 'completed') return { state: 'already-running', run_id: latest.id };
  if (!['failure', 'timed_out'].includes(latest.conclusion)) return { state: 'not-needed', run_id: latest.id };
  if (Number(latest.run_attempt || 1) >= 3) return { state: 'retry-budget-exhausted', run_id: latest.id };
  await github.rest.actions.reRunWorkflowFailedJobs({ owner, repo, run_id: latest.id });
  return { state: 'retry-requested', run_id: latest.id, previous_attempt: Number(latest.run_attempt || 1) };
}

export async function superviseRecovery({ github, context, health, now = new Date().toISOString() }) {
  requireHealth(health);
  const { owner, repo } = context.repo;
  const report = { schema: 1, checked_at_utc: now, evidence_scope: 'committed-scheduler-audit',
    service_health: 'not-measured', audit_state: health.scheduler_state, recovery_required: health.recovery_required,
    episode_key: health.episode_key, outcome: 'pending', errors: [] };
  let issue;
  let state;
  const save = async () => {
    const body = issueBody(health, state);
    if (issue?.body === body) return;
    const { data } = issue
      ? await github.rest.issues.update({ owner, repo, issue_number: issue.number, body })
      : await github.rest.issues.create({ owner, repo, title: ISSUE_TITLE, body });
    issue = { ...issue, ...data, body };
    report.incident_number = issue.number;
  };
  try {
    // paginate preserves the entire incident inventory, including records past
    // the first hundred. Never confuse a same-titled PR with an issue.
    const issues = await github.paginate(github.rest.issues.listForRepo, { owner, repo, state: 'open', per_page: 100 });
    const incidents = issues.filter(item => !item.pull_request && item.title === ISSUE_TITLE);
    issue = incidents[0];
    if (!health.recovery_required) {
      let prs = [];
      try {
        prs = await github.paginate(github.rest.pulls.list, {
          owner, repo, state: 'open', head: `${owner}:${RECOVERY_BRANCH}`, per_page: 100,
        });
      } catch (error) { report.errors.push({ phase: 'list-recovery-prs', reason: safeError(error) }); }
      // A failure in one closure must not hide the other still-open records.
      for (const pr of prs) {
        try { await github.rest.pulls.update({ owner, repo, pull_number: pr.number, state: 'closed' }); }
        catch (error) { report.errors.push({ phase: 'close-pr', number: pr.number, reason: safeError(error) }); }
      }
      for (const item of incidents) {
        try { await github.rest.issues.update({ owner, repo, issue_number: item.number, state: 'closed', state_reason: 'completed' }); }
        catch (error) { report.errors.push({ phase: 'close-incident', number: item.number, reason: safeError(error) }); }
      }
      report.closed_incidents = incidents.length - report.errors.filter(item => item.phase === 'close-incident').length;
      report.closed_prs = prs.length - report.errors.filter(item => item.phase === 'close-pr').length;
    } else {
      state = readRecoveryState(issue?.body, health.episode_key, now);
      // Persist the recovery incident before optional PR or diagnostic work.
      // Its existence cannot depend on permission to create a pull request.
      await save();
      report.incident_number = issue.number;

      if (state.validation.state !== 'dispatched' && !coolingDown(state.validation, now)) {
        state.validation = { state: 'attempting', attempted_at: now };
        await save(); // durable claim before the side effect; restart is bounded
        try {
          await github.rest.actions.createWorkflowDispatch({ owner, repo,
            workflow_id: 'chatgpt-ui-scheduler-rescue.yml', ref: context.payload?.repository?.default_branch || 'main' });
          state.validation = { state: 'dispatched', attempted_at: now };
        } catch (error) {
          state.validation = phaseError(error, now, 'Token permissions block diagnostic workflow dispatch.');
        }
        await save();
      }

      if (!coolingDown(state.bridge, now)) {
        state.bridge = { state: 'attempting', attempted_at: now };
        await save();
        try {
          const repoInfo = await github.rest.repos.get({ owner, repo });
          const base = repoInfo.data.default_branch;
          const prs = await github.paginate(github.rest.pulls.list, {
            owner, repo, state: 'open', head: `${owner}:${RECOVERY_BRANCH}`, base, per_page: 100,
          });
          try { await github.rest.git.getRef({ owner, repo, ref: `heads/${RECOVERY_BRANCH}` }); }
          catch (error) {
            if (error.status !== 404) throw error;
            const baseRef = await github.rest.git.getRef({ owner, repo, ref: `heads/${base}` });
            await github.rest.git.createRef({ owner, repo, ref: `refs/heads/${RECOVERY_BRANCH}`, sha: baseRef.data.object.sha });
          }
          let file;
          try { file = (await github.rest.repos.getContent({ owner, repo, path: 'watchdog/resume-pulse.json', ref: RECOVERY_BRANCH })).data; }
          catch (error) { if (error.status !== 404) throw error; }
          const payload = { schema_version: 2, emitted_at_utc: now, episode_key: health.episode_key,
            audit_state: health.scheduler_state, last_chatgpt_heartbeat_utc: health.last_ok_utc,
            evidence_scope: 'committed-scheduler-audit', service_health: 'not-measured',
            requested_action: 'Inspect native scheduler state using the authorized recovery protocol.',
            recovery_controller: 'watchdog/recovery-controller.json', recovery_protocol: 'watchdog/recovery-protocol.md',
            note: 'A PR pulse requests inspection; it does not prove repair or override permissions.' };
          await github.rest.repos.createOrUpdateFileContents({ owner, repo, path: 'watchdog/resume-pulse.json',
            message: `watchdog: emit recovery inspection pulse ${now}`, branch: RECOVERY_BRANCH,
            content: Buffer.from(JSON.stringify(payload, null, 2) + '\n').toString('base64'), ...(file?.sha ? { sha: file.sha } : {}) });
          const pr = prs[0] || (await github.rest.pulls.create({ owner, repo, head: RECOVERY_BRANCH, base, title: PR_TITLE,
            body: `Recovery inspection requested by incident #${issue.number}.\n\nThe committed audit is ${health.scheduler_state}. This PR is a GitHub event bridge, not live service-health evidence or proof of task repair. No credentials or approval-policy changes are included.` })).data;
          report.recovery_pr_number = pr.number;
          state.bridge = { state: 'active', attempted_at: now };
        } catch (error) {
          state.bridge = phaseError(error, now, 'Repository policy or token permissions block automatic pull requests.');
        }
        await save();
      }
      report.validation = { ...state.validation };
      report.bridge = { ...state.bridge };
      for (const phase of ['validation', 'bridge']) {
        if (state[phase].state === 'error') report.errors.push({ phase, reason: state[phase].reason });
      }
    }
  } catch (error) {
    report.errors.push({ phase: 'incident-supervision', reason: safeError(error) });
  }

  // Retry inspection is independent of incident/PR permissions, with a bounded
  // run-attempt budget. Record its failure without erasing the incident result.
  try { report.watchdog_retry = await retryLatestFailedWatchdog({ github, owner, repo,
    branch: context.payload?.repository?.default_branch || 'main' }); }
  catch (error) { report.errors.push({ phase: 'watchdog-retry', reason: safeError(error) }); }
  report.outcome = report.errors.length ? 'failed'
    : [report.validation?.state, report.bridge?.state].includes('blocked') ? 'blocked'
      : health.recovery_required ? 'awaiting-native-audit' : 'healthy-audit';
  return report;
}

// The independent hourly monitor retains its own issue and permissions. Share
// validation and pagination without making it depend on the PR recovery lane.
export async function reportAuditIncident({ github, context, health }) {
  requireHealth(health);
  const { owner, repo } = context.repo;
  const title = '[Watchdog] ChatGPT scheduled-task heartbeat stale';
  const all = await github.paginate(github.rest.issues.listForRepo, { owner, repo, state: 'open', per_page: 100 });
  const incidents = all.filter(item => !item.pull_request && item.title === title);
  if (!health.recovery_required) {
    const errors = [];
    for (const incident of incidents) {
      try { await github.rest.issues.update({ owner, repo, issue_number: incident.number, state: 'closed', state_reason: 'completed' }); }
      catch (error) { errors.push({ phase: 'close-incident', number: incident.number, reason: safeError(error) }); }
    }
    return { outcome: errors.length ? 'failed' : 'healthy-audit', closed_incidents: incidents.length - errors.length, errors };
  }
  const body = [
    'The committed scheduler audit requires attention.', '',
    `Audit state: ${health.scheduler_state}`,
    `Last recorded successful audit: ${health.last_ok_utc || 'unavailable'}`,
    `Stale threshold: ${health.stale_threshold_minutes ?? 'invalid'} minutes`,
    `Audit episode: ${health.episode_key}`, '',
    'This repository record does not measure current ChatGPT service health.',
    'The next authorized native scheduler audit should inspect and repair actual task state, then update watchdog/heartbeat.json only after successful verification.',
    'Recovery source: watchdog/recovery-controller.json and watchdog/recovery-protocol.md.',
    'Actual age and validation evidence are retained in this workflow run. Unchanged audit evidence does not append repeated comments. No credentials or task prompts are stored here.',
  ].join('\n');
  let incident = incidents[0];
  if (!incident) incident = (await github.rest.issues.create({ owner, repo, title, body })).data;
  else if (incident.body !== body) await github.rest.issues.update({ owner, repo, issue_number: incident.number, body });
  return { outcome: 'awaiting-native-audit', incident_number: incident.number };
}

export function recoverySummary(health, report) {
  return [
    '## External scheduler audit supervision', '',
    `- Committed audit state: ${health.scheduler_state}`,
    `- Last successful audit: ${health.last_ok_utc || 'unavailable'}`,
    `- Audit age in minutes: ${health.heartbeat_age_minutes ?? 'unavailable'}`,
    `- Recovery outcome: ${report.outcome}`,
    `- Diagnostic validation: ${report.validation?.state || 'not-required'}`,
    `- PR bridge: ${report.bridge?.state || 'not-required'}`,
    `- Watchdog retry: ${report.watchdog_retry?.state || 'unavailable'}`, '',
    'This checks a committed audit record. It does not measure current ChatGPT service health, operate an owner browser, grant permissions or prove task recovery.',
    ...report.errors.map(item => `- ${item.phase}: ${item.reason}`), '',
  ].join('\n');
}
