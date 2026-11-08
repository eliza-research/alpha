import {newWorkflow} from './workflow-navigation';
// AP-11 on the FLAG-OFF bundle: the workflow library against the connected resident agent, with only
// the Android bridge stubbed (test/browser/flag-off-android.ts plus the agent's workflow routes below).
// Every other workflow spec runs the development build (?mode=dev&workflows=agent); this one runs the
// bundle `vite build` produces with ELIZA_DEV_ALLOW_TEST_MOCKS unset, and drives rendered controls only.
//
// Covered: the list (only the agent's workflows; no fixture or development workflows), detail, Run with
// its receipt, an approval waiting for confirmation (approve and deny, each with its second
// confirmation), cancelling a running execution, pause and enable, history after a reload, a lost Run
// request that leaves the outcome unknown until the owner explicitly sends the same submission again,
// and the scope refusal before generation.
//
// Evidence boundary: source/test evidence for the flag-off renderer. The agent's workflow routes answer
// in plugin-workflow's wire shapes from an in-page stub that keeps its state in sessionStorage, so it
// survives a reload like the resident agent would. No workflow engine, model, device action, APK,
// emulator or real integration is involved.
import { test, expect, type Page } from '@playwright/test';
import { button, expectNoDevelopmentSurface, fenceNetwork, flagOffAndroid, harness, residentHome } from './flag-off-android';

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'production', 'Production bundle only'); });

/** The resident agent's workflow routes, answered over the Agent.request bridge. */
async function workflowAgent(page: Page) {
  await page.addInitScript(() => {
    const w = window as any, bridge = w.Capacitor, previous = bridge.nativePromise;
    const KEY = 'flag-off-workflows', at = (minute: number) => new Date(Date.UTC(2026, 9, 11, 8, minute)).toISOString();
    const digest = (seed: string) => seed.repeat(64).slice(0, 64);
    const run = (id: string, workflowId: string, status: string, finished: boolean, extra: Record<string, unknown> = {}) => ({ id, workflowId, workflowVersionId: workflowId + '-v1', status, startedAt: at(0), finished, ...(finished ? { stoppedAt: at(1) } : {}), events: [], ...extra });
    const flow = (id: string, name: string, active: boolean, steps: string[]) => ({ id, name, description: 'Synthetic ' + name.toLowerCase(), active, versionId: id + '-v1', steps: steps.map(label => ({ label })) });
    const approval = (nodeId: string, title: string, seed: string) => ({ runId: 'run-approval', workflowId: 'review', workflowVersionId: 'review-v1', nodeId, iteration: 0, requestDigest: digest(seed), status: 'pending', title, summary: 'Synthetic step that waits for the owner', operation: 'Save a note', target: 'Notes: ' + title, account: 'This phone', supported: true });
    const initial = () => ({
      flows: [flow('agenda', 'Agenda digest', false, ['Read supplied text', 'Draft agenda']), flow('review', 'Reviewed note saver', true, ['Draft note', 'Save note after approval']), flow('watch', 'Long running watch', true, ['Wait for a change'])],
      runs: { agenda: [], review: [run('run-approval', 'review', 'waiting-approval', false)], watch: [run('run-active', 'watch', 'running', false)] } as Record<string, any[]>,
      approvals: [approval('save-review', 'Save the agenda note', 'a'), approval('delete-review', 'Delete the old note', 'd')],
      submissions: {} as Record<string, string>, posts: [] as Array<{ path: string; body: any }>, gets: [] as string[], unexpected: [] as string[], loseNextRun: false, runs_started: 0,
    });
    const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null') ?? initial(); } catch { return initial(); } };
    const state = w.workflowAgent = load();
    const save = () => sessionStorage.setItem(KEY, JSON.stringify(state));
    const receipt = (finished = false) => ({ runId: 'run-approval', workflowId: 'review', workflowVersionId: 'review-v1', finished, cancellationRequested: false, approvals: state.approvals });
    const allRuns = () => Object.values(state.runs).flat() as any[];
    const ok = (data: unknown) => ({ status: 200, data });
    const route = (method: string, path: string, body: any): { status: number; data: unknown } | 'lost' => {
      if (method === 'GET') state.gets.push(path); else state.posts.push({ path, body });
      if (path === '/api/workflow/status') return ok({ engine: 'smthrs', status: 'ready', manualSubmissionProtocol: 1, approvalReceiptProtocol: 1, lifecycleMutationProtocol: 1 });
      if (path === '/api/automations') return ok({ automations: state.flows.map((f: any) => ({ id: 'workflow:' + f.id, type: 'workflow', workflowId: f.id, title: f.name, description: f.description, enabled: f.active, status: f.active ? 'active' : 'paused', schedules: [] })) });
      // The mounted Calendar view may read its canonical source; this workflow fixture has none.
      if (method === 'GET' && ['/api/lifeops/calendar/feed', '/api/lifeops/calendar/calendars', '/api/lifeops/calendar/next-context'].includes(path.split('?')[0])) return { status: 503, data: { error: 'Calendar unavailable in this workflow fixture' } };
      if (path === '/api/lifeops/reminders') return ok({ reminders: [] });
      if (path === '/api/lifeops/scheduled-tasks?ownerVisibleOnly=1') return ok({ tasks: [] });
      if (path === '/api/workflow/removed-workflows') return ok({ workflows: [] });
      if (path === '/api/workflow/workflows') return ok({ workflows: state.flows });
      if (path === '/api/workflow/phone/catalog') return ok({ specVersion: 1, generationProtocol: 1, catalogRevision: 'fixture-v1', compilerRevision: 'fixture-v1', maximumSteps: 32, maximumSpecBytes: 65536, triggers: [{ kind: 'manual', available: true }], palette: [{ kind: 'Read', operations: ['supplied_text', 'selected_notes', 'calendar_range'].map(id => ({ id, available: true })) }, { kind: 'Write', operations: ['compose_draft', 'model_draft', 'save_note'].map(id => ({ id, available: true })) }] });
      let m = /^\/api\/workflow\/workflows\/([^/]+)(\/.*)?$/.exec(path);
      if (m) {
        const f = state.flows.find((row: any) => row.id === m![1]), rest = m[2] || '';
        if (!f) return { status: 404, data: {} };
        if (rest === '' && method === 'GET') return ok(f);
        if (rest === '/executions') return ok({ executions: state.runs[f.id] });
        if (rest === '/deactivate') { f.active = false; return ok(f); }
        if (rest === '/activate') { f.active = true; return ok(f); }
        const submission = /^\/submissions\/([^/]+)$/.exec(rest);
        if (submission) return ok({ submissionId: submission[1], execution: allRuns().find(r => r.id === state.submissions[submission[1]]) ?? null });
        if (rest === '/run') {
          // A lost request: it never reached the engine, so nothing was admitted, and no answer comes back.
          if (state.loseNextRun) { state.loseNextRun = false; return 'lost'; }
          if (body.expectedVersionId !== f.versionId) return { status: 409, data: { code: 'WORKFLOW_VERSION_NOT_ADMITTED', workflowId: f.id, submissionId: body.submissionId, expectedVersionId: body.expectedVersionId } };
          // One submission ID is admitted at most once.
          const existing = allRuns().find(r => r.id === state.submissions[body.submissionId]);
          if (existing) return ok({ submissionId: body.submissionId, execution: existing });
          const started = run('run-' + f.id + '-' + (++state.runs_started), f.id, 'finished', true, { output: 'Synthetic agenda: two meetings before noon.' });
          state.runs[f.id].unshift(started); state.submissions[body.submissionId] = started.id;
          return ok({ submissionId: body.submissionId, execution: started });
        }
      }
      m = /^\/api\/workflow\/executions\/([^/]+)(\/.*)?$/.exec(path);
      if (m) {
        const r = allRuns().find(row => row.id === m![1]), rest = m[2] || '';
        if (!r) return { status: 404, data: {} };
        if (rest === '') return ok({ execution: r });
        if (rest === '/cancel') { Object.assign(r, { status: 'cancelled', finished: true, stoppedAt: at(5) }); return ok({ execution: r }); }
        if (rest === '/approvals') return ok(receipt(r.finished));
        const decision = /^\/approvals\/([^/]+)\/(\d+)$/.exec(rest);
        if (decision) {
          const a = state.approvals.find((row: any) => row.nodeId === decodeURIComponent(decision[1]) && row.iteration === Number(decision[2]));
          if (!a || a.status !== 'pending' || body.requestDigest !== a.requestDigest || body.expectedVersionId !== r.workflowVersionId) return { status: 409, data: {} };
          a.status = body.approved ? 'approved' : 'denied'; a.decidedBy = 'owner';
          return ok(receipt());
        }
      }
      state.unexpected.push(method + ' ' + path); return { status: 404, data: {} };
    };
    const owned = (path: string) => /^\/api\/(workflow\/(?!hosted\/)|automations$|lifeops\/)/.test(path);
    bridge.nativePromise = async (plugin: string, method: string, input: any) => {
      if (plugin !== 'Agent' || method !== 'request' || !owned(String(input?.path))) return previous(plugin, method, input);
      w.flagOff.calls.push('Agent.request');
      const result = route(input.method || 'GET', input.path, input.body ? JSON.parse(input.body) : undefined); save();
      if (result === 'lost') throw new Error('Connection reset before the agent answered');
      return { status: result.status, body: JSON.stringify(result.data) };
    };
  });
}
const agent = <T>(page: Page, read: (s: any) => T) => page.evaluate(`(${read.toString()})(window.workflowAgent)`) as Promise<T>;
const posts = (page: Page, suffix: string) => agent(page, s => s.posts).then((rows: Array<{ path: string; body: any }>) => rows.filter(row => row.path.endsWith(suffix)));
const list = (page: Page) => page.locator('[data-alpha-subview="workflows-list"]');
const runStatus = (page: Page) => page.getByRole('status', { name: 'Workflow run status', exact: true });
async function start(page: Page) {
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page);
  await workflowAgent(page);
  await residentHome(page);
  await button(page, 'Workflows').click();
  await expect(list(page).getByText('Agenda digest', { exact: true })).toBeVisible({ timeout: 20_000 });
  return foreign;
}
async function openFlow(page: Page, name: string) {
  await list(page).getByText(name, { exact: true }).first().click();
  await expect(button(page, 'Run now')).toBeVisible();
}

test('the list shows only the agent’s workflows; detail, Run with its receipt, pause and enable', async ({ page }) => {
  test.setTimeout(150_000);
  const foreign = await start(page);
  // Only what the agent returned: no fixture, sample or development workflows in the flag-off build.
  for (const name of ['Agenda digest', 'Reviewed note saver', 'Long running watch']) await expect(list(page).getByText(name, { exact: true }).first()).toBeVisible();
  await expectNoDevelopmentSurface(page);
  await expect(page.getByText(/Simulated|Development workflow|Sample workflow|fixture/i)).toHaveCount(0);

  // Detail: the reviewed steps and the agent's state.
  await openFlow(page, 'Agenda digest');
  await expect(page.getByText('Draft agenda', { exact: true }).first()).toBeVisible();
  await expect(runStatus(page)).toHaveText('Paused on this agent');
  // Run needs a second tap; the first sends nothing.
  await button(page, 'Run now').click();
  await expect(runStatus(page)).toHaveText('Tap Run now again to confirm');
  expect(await posts(page, '/run')).toEqual([]);
  await button(page, 'Run now').click();
  await expect.poll(() => posts(page, '/run').then(rows => rows.length)).toBe(1);
  const [sent] = await posts(page, '/run');
  expect(sent.body).toMatchObject({ input: {}, expectedVersionId: 'agenda-v1' });
  expect(sent.body.submissionId).toMatch(/^[0-9a-f-]{36}$/);
  // The receipt is the agent's execution: its status and output.
  await expect(page.getByText('Synthetic agenda: two meetings before noon.', { exact: true })).toBeVisible();
  await page.locator('details[aria-label="Workflow execution details"]').filter({has:page.getByText('Terminal execution reported by agent', {exact:true})}).locator('summary').click();
  await expect(page.getByText('Terminal execution reported by agent', { exact: true })).toBeVisible();
  await button(page, 'Back to Agenda digest').click();
  await expect(button(page, 'finished execution')).toBeVisible();

  // Enable takes a second tap; pause is immediate and confirmed by the agent.
  const toggle = button(page, 'Turn Agenda digest on or off');
  await toggle.click();
  await expect(runStatus(page)).toHaveText('Tap the switch again to enable scheduled runs');
  expect(await posts(page, '/activate')).toEqual([]);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(runStatus(page)).toHaveText('Enabled on this agent');
  expect(await posts(page, '/activate')).toHaveLength(1);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(runStatus(page)).toHaveText('Paused on this agent');
  expect(await posts(page, '/deactivate')).toHaveLength(1);
  expect(await posts(page, '/run')).toHaveLength(1);
  expect(await agent(page, s => s.unexpected)).toEqual([]);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('an approval waits for a second confirmation to approve or deny, and a running execution is cancelled only when confirmed', async ({ page }) => {
  test.setTimeout(150_000);
  const foreign = await start(page);
  await openFlow(page, 'Reviewed note saver');
  await button(page, 'waiting-approval execution').click();
  const reviews = page.getByRole('region', { name: 'Workflow approval review' });
  await expect(reviews).toHaveCount(2);
  const save = reviews.filter({ hasText: 'Save the agenda note' }), remove = reviews.filter({ hasText: 'Delete the old note' });
  await expect(save).toContainText('Save a note');
  // Approve: the first tap asks for confirmation and sends nothing.
  await save.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(save.getByRole('button', { name: 'Confirm approval', exact: true })).toBeVisible();
  expect(await posts(page, '/0')).toEqual([]);
  await save.getByRole('button', { name: 'Confirm approval', exact: true }).click();
  await expect(save).toContainText('approved');
  // Deny: the same second confirmation.
  await remove.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(remove.getByRole('button', { name: 'Confirm denial', exact: true })).toBeVisible();
  expect(await posts(page, '/approvals/delete-review/0')).toEqual([]);
  await remove.getByRole('button', { name: 'Confirm denial', exact: true }).click();
  await expect(remove).toContainText('denied');
  const decisions = await posts(page, '/0');
  expect(decisions.map(row => [row.path, row.body.approved])).toEqual([['/api/workflow/executions/run-approval/approvals/save-review/0', true], ['/api/workflow/executions/run-approval/approvals/delete-review/0', false]]);
  expect(decisions.map(row => row.body.requestDigest)).toEqual(['a'.repeat(64), 'd'.repeat(64)]);
  await expect(reviews.getByRole('button', { name: /^(Approve|Deny|Confirm approval|Confirm denial)$/ })).toHaveCount(0);
  await button(page, 'Back to Reviewed note saver').click();

  // Cancel: a running execution, cancelled only on the confirming tap.
  await button(page, 'Back to workflows').click();
  await openFlow(page, 'Long running watch');
  await button(page, 'running execution').click();
  await button(page, 'Cancel execution').click();
  await expect(button(page, 'Confirm execution cancellation')).toBeVisible();
  expect(await posts(page, '/cancel')).toEqual([]);
  await button(page, 'Confirm execution cancellation').click();
  await expect.poll(() => posts(page, '/cancel').then(rows => rows.length)).toBe(1);
  await button(page, 'Back to Long running watch').click();
  await expect(button(page, 'cancelled execution')).toBeVisible();
  expect(await posts(page, '/run')).toEqual([]);
  expect(await agent(page, s => s.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('a lost Run request stays outcome unknown until the owner sends the same submission again; history survives a reload', async ({ page }) => {
  test.setTimeout(180_000);
  const foreign = await start(page);
  await openFlow(page, 'Agenda digest');
  await page.evaluate(() => { (window as any).workflowAgent.loseNextRun = true; });
  await button(page, 'Run now').click();
  await button(page, 'Run now').click();
  await expect.poll(() => posts(page, '/run').then(rows => rows.length)).toBe(1);
  // Nothing is retried on its own, and another Run is blocked while the outcome is unknown.
  await expect(runStatus(page)).toHaveText('Prior run outcome unknown — inspect history; repeat submission blocked');
  await button(page, 'Run now').click();
  await page.waitForTimeout(500);
  expect(await posts(page, '/run')).toHaveLength(1);

  // After a reload the retained request is checked against the agent: it has no run for it.
  await page.reload();
  await button(page, 'Workflows').click();
  await openFlow(page, 'Agenda digest');
  const [lost] = await posts(page, '/run');
  expect(await agent(page, s => s.gets)).toContain(`/api/workflow/workflows/agenda/submissions/${lost.body.submissionId}`);
  await expect(runStatus(page)).toHaveText('The agent has no run for your earlier request. Run now sends that same request again');
  await button(page, 'Run now').click();
  await expect(runStatus(page)).toHaveText('Tap Run now again to send your earlier request once more');
  expect(await posts(page, '/run')).toHaveLength(1);
  await button(page, 'Run now').click();
  await expect.poll(() => posts(page, '/run').then(rows => rows.length)).toBe(2);
  const [, resent] = await posts(page, '/run');
  // The owner's resend carries the original submission identity and reviewed version.
  expect(resent.body).toEqual(lost.body);
  await expect(page.getByText('Synthetic agenda: two meetings before noon.', { exact: true })).toBeVisible();
  await button(page, 'Back to Agenda digest').click();

  // History after another reload: the one run, from the agent.
  await page.reload();
  await button(page, 'Workflows').click();
  await openFlow(page, 'Agenda digest');
  await expect(button(page, 'finished execution')).toHaveCount(1);
  await expect(runStatus(page)).toHaveText('Paused on this agent');
  expect(await agent(page, s => s.runs.agenda.length)).toBe(1);
  expect(await posts(page, '/run')).toHaveLength(2);
  expect(await agent(page, s => s.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('an out-of-scope workflow request is refused before anything is sent to the agent', async ({ page }) => {
  test.setTimeout(120_000);
  const foreign = await start(page);
  await newWorkflow(page);
  await page.getByRole('textbox', { name: 'Workflow name', exact: true }).fill('Retained original draft');
  await page.getByRole('button', { name: /Describe it to/ }).click();
  await page.getByRole('textbox', { name: 'Workflow request', exact: true }).fill('Pay my rent on the first of the month');
  await button(page, 'Generate workflow draft').click();
  const refusal = page.locator('[role=status]').filter({ hasText: 'Workflows can’t make payments or move money' });
  await expect(refusal).toBeVisible();
  await expect(refusal).toContainText('Nothing was sent to the agent');
  expect(await posts(page, '/phone/generate')).toEqual([]);
  await expect(page.getByRole('region', { name: 'Generated draft', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Workflow name', exact: true })).toHaveValue('Retained original draft');
  expect(await agent(page, s => s.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});
