import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ISSUE_TITLE, RECOVERY_BRANCH, superviseRecovery, readRecoveryState, retryLatestFailedWatchdog, reportAuditIncident } from '../watchdog/external_scheduler_recovery.mjs';

const now = '2026-11-28T12:00:00.000Z';
const context = { repo: { owner: 'owner', repo: 'repo' }, payload: { repository: { default_branch: 'main' } } };
const stale = { scheduler_state: 'stale', recovery_required: true, episode_key: 'a'.repeat(64),
  last_ok_utc: '2026-09-23T03:53:35Z', stale_threshold_minutes: 75, heartbeat_age_minutes: 95000 };
const error = (status, message = 'Request failed') => Object.assign(new Error(message), { status });

function fixture(options = {}) {
  const calls = [], issues = options.issues || [], prs = options.prs || [];
  let nextNumber = 700;
  const make = (name, fn) => Object.assign(async args => {
    calls.push({ name, args: structuredClone(args) });
    const failure = typeof options.fail?.[name] === 'function' ? options.fail[name](args) : options.fail?.[name];
    if (failure) throw failure;
    return { data: await fn(args) };
  }, { endpointName: name });
  const github = { rest: { issues: {}, pulls: {}, actions: {}, repos: {}, git: {} } };
  github.rest.issues.listForRepo = make('issues.list', () => issues.filter(i => i.state !== 'closed'));
  github.rest.issues.create = make('issues.create', args => {
    const issue = { ...args, number: nextNumber++, state: 'open' }; issues.push(issue); return issue;
  });
  github.rest.issues.update = make('issues.update', args => {
    const issue = issues.find(i => i.number === args.issue_number); assert.ok(issue); Object.assign(issue, args); return issue;
  });
  github.rest.pulls.list = make('pulls.list', () => prs.filter(p => p.state !== 'closed'));
  github.rest.pulls.create = make('pulls.create', args => { const pr = { ...args, number: nextNumber++ }; prs.push(pr); return pr; });
  github.rest.pulls.update = make('pulls.update', args => {
    const pr = prs.find(p => p.number === args.pull_number); Object.assign(pr, args); return pr;
  });
  github.rest.actions.createWorkflowDispatch = make('actions.dispatch', () => ({}));
  github.rest.actions.listWorkflowRuns = make('actions.runs', () => ({ workflow_runs: options.runs || [] }));
  github.rest.actions.reRunWorkflowFailedJobs = make('actions.retry', () => ({}));
  github.rest.repos.get = make('repos.get', () => ({ default_branch: 'main' }));
  github.rest.repos.getContent = make('repos.content', () => ({ sha: 'b'.repeat(40) }));
  github.rest.repos.createOrUpdateFileContents = make('repos.write', () => ({}));
  github.rest.git.getRef = make('git.getRef', () => ({ object: { sha: 'c'.repeat(40) } }));
  github.rest.git.createRef = make('git.createRef', () => ({}));
  github.paginate = async (method, args) => {
    calls.push({ name: 'paginate', endpoint: method.endpointName });
    return (await method(args)).data;
  };
  return { github, issues, prs, calls, count: name => calls.filter(c => c.name === name).length };
}

test('records the incident before denied PR creation and preserves independent diagnostics', async () => {
  const f = fixture({ fail: { 'pulls.create': error(403, 'GitHub Actions is not permitted to create or approve pull requests.') } });
  const report = await superviseRecovery({ github: f.github, context, health: stale, now });
  assert.equal(report.outcome, 'blocked');
  assert.equal(report.bridge.state, 'blocked');
  assert.equal(report.validation.state, 'dispatched');
  assert.equal(f.issues.length, 1);
  assert.ok(f.calls.findIndex(c => c.name === 'issues.create') < f.calls.findIndex(c => c.name === 'pulls.create'));
  assert.match(f.issues[0].body, /PR bridge: blocked/);
  assert.match(f.issues[0].body, /does not measure current ChatGPT service health/);
  const dispatch = f.calls.find(c => c.name === 'actions.dispatch').args;
  assert.equal(dispatch.ref, 'main');
  assert.equal(dispatch.workflow_id, 'chatgpt-ui-scheduler-rescue.yml');
  assert.equal('inputs' in dispatch, false, 'target workflow declares no dispatch inputs');
});

test('unchanged blocked recovery neither floods issues nor repeats dispatch or pulse writes', async () => {
  const f = fixture({ fail: { 'pulls.create': error(403, 'GitHub Actions is not permitted to create or approve pull requests.') } });
  await superviseRecovery({ github: f.github, context, health: stale, now });
  const before = { writes: f.count('issues.update'), pulses: f.count('repos.write'), dispatches: f.count('actions.dispatch') };
  const result = await superviseRecovery({ github: f.github, context, health: { ...stale, heartbeat_age_minutes: 95010 }, now: '2026-11-28T12:10:00.000Z' });
  assert.equal(result.outcome, 'blocked');
  assert.equal(f.count('issues.update'), before.writes);
  assert.equal(f.count('repos.write'), before.pulses);
  assert.equal(f.count('actions.dispatch'), before.dispatches);
  assert.equal(f.issues.length, 1);
});

test('policy becoming available resumes after cooldown without a new incident or validation run', async () => {
  const options = { fail: { 'pulls.create': error(403, 'Permission denied') } }, f = fixture(options);
  await superviseRecovery({ github: f.github, context, health: stale, now });
  delete options.fail['pulls.create'];
  const report = await superviseRecovery({ github: f.github, context, health: stale, now: '2026-11-28T13:00:00.000Z' });
  assert.equal(report.bridge.state, 'active');
  assert.equal(report.outcome, 'awaiting-native-audit');
  assert.equal(f.issues.length, 1);
  assert.equal(f.prs.length, 1);
  assert.equal(f.count('actions.dispatch'), 1);
  const pulse = JSON.parse(Buffer.from(f.calls.filter(c => c.name === 'repos.write').at(-1).args.content, 'base64'));
  assert.equal(pulse.service_health, 'not-measured');
});

test('new audit episode is processed immediately and existing PR is reused', async () => {
  const f = fixture();
  await superviseRecovery({ github: f.github, context, health: stale, now });
  const report = await superviseRecovery({ github: f.github, context, health: { ...stale, episode_key: 'b'.repeat(64) }, now: '2026-11-28T12:05:00.000Z' });
  assert.equal(report.bridge.state, 'active');
  assert.equal(f.count('actions.dispatch'), 2);
  assert.equal(f.count('pulls.create'), 1);
  assert.equal(f.issues.length, 1);
});

test('durable attempting state prevents duplicate side effects immediately after restart', async () => {
  const phase = { state: 'attempting', attempted_at: now };
  const body = `<!-- constellation-recovery-state ${JSON.stringify({ schema: 1, episode: stale.episode_key, validation: phase, bridge: phase })} -->`;
  const f = fixture({ issues: [{ title: ISSUE_TITLE, body, number: 20 }] });
  const report = await superviseRecovery({ github: f.github, context, health: stale, now: '2026-11-28T12:01:00.000Z' });
  assert.equal(report.outcome, 'awaiting-native-audit');
  assert.equal(f.count('actions.dispatch'), 0);
  assert.equal(f.count('repos.write'), 0);
});

test('malformed, mismatched and future journal claims cannot permanently suppress recovery', async () => {
  assert.equal(readRecoveryState('<!-- constellation-recovery-state {invalid} -->', stale.episode_key).bridge.state, 'pending');
  const body = `<!-- constellation-recovery-state ${JSON.stringify({ schema: 1, episode: stale.episode_key,
    validation: { state: 'attempting', attempted_at: '2099-01-01T00:00:00Z', repository: 'elsewhere' },
    bridge: { state: 'blocked', attempted_at: '2099-01-01T00:00:00Z', reason: 'UNTRUSTED' } })} -->`;
  const f = fixture({ issues: [{ title: ISSUE_TITLE, body, number: 20 }] });
  const result = await superviseRecovery({ github: f.github, context, health: stale, now });
  assert.equal(result.bridge.state, 'active');
  assert.equal(f.count('actions.dispatch'), 1);
  assert.ok(f.calls.filter(c => c.args).every(c => c.args.repo === 'repo'));
  assert.doesNotMatch(f.issues[0].body, /UNTRUSTED|elsewhere/);
});

test('full incident inventory is searched and same-title PRs are excluded', async () => {
  const issues = [...Array.from({ length: 110 }, (_, i) => ({ number: i + 1, title: `unrelated ${i}` })),
    { number: 400, title: ISSUE_TITLE, pull_request: {} }, { number: 401, title: ISSUE_TITLE, body: '' }];
  const f = fixture({ issues });
  const result = await superviseRecovery({ github: f.github, context, health: stale, now });
  assert.equal(result.incident_number, 401);
  assert.equal(f.count('issues.create'), 0);
  assert.ok(f.calls.some(c => c.name === 'paginate' && c.endpoint === 'issues.list'));
});

test('valid fresh audit closes every incident and PR without comment spam', async () => {
  const f = fixture({ issues: [{ number: 1, title: ISSUE_TITLE }, { number: 2, title: ISSUE_TITLE }], prs: [{ number: 3 }, { number: 4 }] });
  const result = await superviseRecovery({ github: f.github, context, health: { ...stale, scheduler_state: 'healthy', recovery_required: false }, now });
  assert.equal(result.outcome, 'healthy-audit');
  assert.equal(result.closed_incidents, 2);
  assert.equal(result.closed_prs, 2);
  assert.ok(f.issues.every(i => i.state === 'closed'));
  assert.equal(f.count('actions.dispatch'), 0);
});

test('invalid evidence cannot close an incident or perform any GitHub mutation', async () => {
  const f = fixture();
  await assert.rejects(superviseRecovery({ github: f.github, context, health: { ...stale, recovery_required: false }, now }), /validated/);
  assert.equal(f.calls.length, 0);
});

test('unexpected dispatch failure remains a failed outcome while independent PR recovery continues', async () => {
  const f = fixture({ fail: { 'actions.dispatch': error(422, 'Unexpected inputs') } });
  const result = await superviseRecovery({ github: f.github, context, health: stale, now });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.bridge.state, 'active');
  assert.equal(result.validation.state, 'error');
  assert.ok(result.errors.some(e => e.phase === 'validation'));
});

test('incident persistence failure prevents optional side effects but still inspects watchdog retry', async () => {
  const f = fixture({ fail: { 'issues.create': error(500) } });
  const result = await superviseRecovery({ github: f.github, context, health: stale, now });
  assert.equal(result.outcome, 'failed');
  assert.equal(f.count('actions.dispatch'), 0);
  assert.equal(f.count('repos.write'), 0);
  assert.equal(f.count('actions.runs'), 1);
});

test('only latest retryable failure is rerun and run-attempt budget is enforced', async () => {
  for (const latest of [
    { status: 'completed', conclusion: 'success', run_attempt: 1 },
    { status: 'in_progress', conclusion: null, run_attempt: 1 },
    { status: 'completed', conclusion: 'cancelled', run_attempt: 1 },
    { status: 'completed', conclusion: 'action_required', run_attempt: 1 },
    { status: 'completed', conclusion: 'failure', run_attempt: 3 },
  ]) {
    const f = fixture({ runs: [{ id: 100, ...latest }, { id: 99, status: 'completed', conclusion: 'failure', run_attempt: 1 }] });
    await retryLatestFailedWatchdog({ github: f.github, owner: 'owner', repo: 'repo' });
    assert.equal(f.count('actions.retry'), 0, JSON.stringify(latest));
  }
  const f = fixture({ runs: [{ id: 100, status: 'completed', conclusion: 'failure', run_attempt: 2 }] });
  const result = await retryLatestFailedWatchdog({ github: f.github, owner: 'owner', repo: 'repo' });
  assert.equal(result.state, 'retry-requested');
  assert.equal(f.calls.find(c => c.name === 'actions.retry').args.run_id, 100);
});

test('healthy cleanup keeps processing incidents when individual PR closure fails', async () => {
  const f = fixture({ issues: [{ number: 1, title: ISSUE_TITLE }], prs: [{ number: 3 }], fail: { 'pulls.update': error(500) } });
  const result = await superviseRecovery({ github: f.github, context, health: { ...stale, scheduler_state: 'healthy', recovery_required: false }, now });
  assert.equal(result.outcome, 'failed');
  assert.equal(f.issues[0].state, 'closed');
  assert.equal(result.closed_prs, 0);
});

test('healthy cleanup still closes verified incidents when PR listing is unavailable', async () => {
  const f = fixture({ issues: [{ number: 1, title: ISSUE_TITLE }], fail: { 'pulls.list': error(500) } });
  const result = await superviseRecovery({ github: f.github, context, health: { ...stale, scheduler_state: 'healthy', recovery_required: false }, now });
  assert.equal(result.outcome, 'failed');
  assert.equal(f.issues[0].state, 'closed');
  assert.ok(result.errors.some(e => e.phase === 'list-recovery-prs'));
});

test('rate limiting is an actual failure, not a repository permission block', async () => {
  const f = fixture({ fail: { 'pulls.create': error(403, 'API rate limit exceeded') } });
  const result = await superviseRecovery({ github: f.github, context, health: stale, now });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.bridge.state, 'error');
});

test('retry inspection is scoped to the repository default branch', async () => {
  const f = fixture();
  await retryLatestFailedWatchdog({ github: f.github, owner: 'owner', repo: 'repo', branch: 'trunk' });
  assert.equal(f.calls.find(c => c.name === 'actions.runs').args.branch, 'trunk');
});

test('missing, invalid and future dispatched timestamps do not suppress validation forever', async () => {
  for (const attempted_at of [undefined, 'invalid', 1, [now], '2099-01-01T00:00:00Z']) {
    const state = { schema: 1, episode: stale.episode_key,
      validation: { state: 'dispatched', attempted_at }, bridge: { state: 'pending' } };
    const f = fixture({ issues: [{ title: ISSUE_TITLE, number: 20,
      body: `<!-- constellation-recovery-state ${JSON.stringify(state)} -->` }] });
    const result = await superviseRecovery({ github: f.github, context, health: stale, now });
    assert.equal(result.validation.state, 'dispatched');
    assert.equal(f.count('actions.dispatch'), 1, String(attempted_at));
  }
});

test('independent hourly monitor reuses one issue without changing PR or dispatch state', async () => {
  const f = fixture();
  const first = await reportAuditIncident({ github: f.github, context, health: stale });
  const again = await reportAuditIncident({ github: f.github, context, health: { ...stale, heartbeat_age_minutes: 95010 } });
  assert.equal(first.incident_number, again.incident_number);
  assert.equal(f.count('issues.create'), 1);
  assert.equal(f.count('issues.update'), 0);
  assert.equal(f.count('actions.dispatch'), 0);
  assert.equal(f.count('pulls.list'), 0);
  const future = await reportAuditIncident({ github: f.github, context,
    health: { ...stale, scheduler_state: 'future', episode_key: 'c'.repeat(64) } });
  assert.equal(future.outcome, 'awaiting-native-audit');
  assert.match(f.issues[0].body, /Audit state: future/);
  const fresh = await reportAuditIncident({ github: f.github, context,
    health: { ...stale, scheduler_state: 'healthy', recovery_required: false } });
  assert.equal(fresh.closed_incidents, 1);
  assert.equal(f.issues[0].state, 'closed');
});

test('hourly monitor attempts all duplicate closures and reports partial failure accurately', async () => {
  const title = '[Watchdog] ChatGPT scheduled-task heartbeat stale';
  const f = fixture({ issues: [{ number: 1, title }, { number: 2, title }],
    fail: { 'issues.update': args => args.issue_number === 1 ? error(500) : null } });
  const result = await reportAuditIncident({ github: f.github, context,
    health: { ...stale, scheduler_state: 'healthy', recovery_required: false } });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.closed_incidents, 1);
  assert.equal(result.errors[0].number, 1);
  assert.notEqual(f.issues[0].state, 'closed');
  assert.equal(f.issues[1].state, 'closed');
});
