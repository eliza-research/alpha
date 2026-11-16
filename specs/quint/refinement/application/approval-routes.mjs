import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces} from '../check-traces.mjs';
import {withMountedShell} from './shell-coordinator.mjs';

const self = fileURLToPath(import.meta.url);
const proposalId = 'approval-routes-note';

async function installApprovalPort(page) {
  await page.addInitScript(({proposalId}) => {
    const base = window.Capacitor.nativePromise;
    const route = '/api/client-devices/proposals';
    const digest = 'a'.repeat(64);
    const operation = {type:'create_note', title:'Synthetic approval note', body:'Synthetic contents'};
    const fixture = window.approvalRoutes = {
      armed:false, lists:0, holdLists:false, admitNextList:false, listReplies:[], decisions:0, effects:0,
      journal:null, finishDecision:null, finishReceipt:null, rejectDecision:false, server:'pending',
      unexpected:[],
    };
    const ok = value => ({status:200, body:JSON.stringify(value)});
    const proposal = () => ({
      id:proposalId, digest, state:'pending', expiresAt:expiry,
      subjectUserId:'9f1dc45a-4011-4e44-947a-30d999d24fa5', requestedBy:'6f1d3c3e-8c55-4c1b-9d1f-2b6f0b0d3a11',
      action:'device_action', payload:{action:'device_action', version:1, installationId:window.flagOff.installationId,
        enrollmentId:'fixture-enrollment', operation},
    });
    const proposals = () => ({proposals:fixture.armed && fixture.server === 'pending' ? [proposal()] : []});
    const expiry = new Date(Date.now() + 600_000).toISOString();
    const methods = window.Capacitor.PluginHeaders.find(row => row.name === 'AlphaActionJournal').methods;
    methods.push(...['reserve','markApplying','finish'].map(name => ({name,rtype:'promise'})));
    window.Capacitor.nativePromise = async (plugin, method, input) => {
      if (plugin === 'AlphaActionJournal') {
        if (method === 'list') return {entries:fixture.journal ? [structuredClone(fixture.journal)] : []};
        if (method === 'get') return {entry:fixture.journal ? structuredClone(fixture.journal) : null};
        if (method === 'reserve') {
          if (fixture.journal) return {created:false, entry:structuredClone(fixture.journal)};
          fixture.journal = {...structuredClone(input), phase:'reserved'};
          return {created:true, entry:structuredClone(fixture.journal)};
        }
        if (method === 'markApplying') {
          Object.assign(fixture.journal, {phase:'applying', attemptId:input.attemptId});
          return {};
        }
        if (method === 'finish') {
          Object.assign(fixture.journal, {phase:'terminal', status:input.status, summary:input.summary, result:input.result});
          return {};
        }
      }
      if (plugin === 'Agent' && method === 'requestStream') {
        fixture.armed = true;
        fixture.holdLists = true;
        return base(plugin, method, input);
      }
      if (plugin === 'Agent' && method === 'request') {
        if (input.path === '/api/client-devices/register') {
          const result = await base(plugin, method, input);
          return {...result, body:JSON.stringify({...JSON.parse(result.body), capabilities:['notes.local-record.v1']})};
        }
        if (input.path === route) {
          if (fixture.armed && ++fixture.lists > 1 && fixture.holdLists) {
            if (fixture.admitNextList) fixture.admitNextList = false;
            else await new Promise(resolve => fixture.listReplies.push(resolve));
          }
          return ok(proposals());
        }
        if (input.path?.startsWith(route + '/')) {
          const actionRoute = input.path.slice(route.length + 1);
          const [, kind] = actionRoute.split('/');
          const body = JSON.parse(input.body);
          if (input.method !== 'POST' || actionRoute !== `${proposalId}/${kind}` || body.digest !== digest) {
            fixture.unexpected.push(actionRoute);
            throw Error('Unexpected decision identity');
          }
          const reply = (state, execution) => ok({proposal:{...proposal(), state, ...(execution ? {execution} : {})}, digest});
          // Hold the real client's first decision and acknowledgement at separate wire points.
          // The actual pinned device coordinator and durable journal calls execute around them.
          if (kind === 'decision' && body.decision === 'approve') {
            fixture.decisions++;
            await new Promise(resolve => { fixture.finishDecision = resolve; });
            fixture.finishDecision = null;
            if (fixture.rejectDecision) throw Error('Synthetic approval transport failed');
            return reply('approved');
          }
          if (kind === 'claim') return reply('executing', {attemptId:'fixture-attempt'});
          if (kind === 'receipt' && body.attemptId === 'fixture-attempt') {
            await new Promise(resolve => { fixture.finishReceipt = resolve; });
            fixture.finishReceipt = null;
            if (body.receipt.outcome !== 'applied') throw Error('Synthetic effect was not applied');
            return reply('succeeded', {attemptId:'fixture-attempt'});
          }
          fixture.unexpected.push(actionRoute);
          throw Error('Unexpected approval route');
        }
      }
      return base(plugin, method, input);
    };
  }, {proposalId});
}

async function approvalTrace({name, page, errors}) {
  const card = page.locator('.alpha-action-review').getByText('Create note', {exact:true});
  await page.waitForFunction(() => window.quintActors.connectionController.getSnapshot().phoneActionsAvailable);
  await page.evaluate(async () => {
    const {connectionController} = window.quintActors;
    connectionController.setDeviceExecutor(async (operation, id, _context, signal) => {
      signal.throwIfAborted();
      const f = window.approvalRoutes;
      if (operation.type !== 'create_note' || operation.title !== 'Synthetic approval note'
        || f.journal?.phase !== 'applying' || f.journal?.operationId !== id) throw Error('Unexpected synthetic native effect');
      f.effects++;
      f.server = 'done';
      return {status:'succeeded', summary:'Synthetic note created'};
    });
    window.quintShell.setState({chat:'sheet', draft:'Prepare a synthetic note'});
  });
  await page.waitForFunction(() => window.quintShell.S().draft === 'Prepare a synthetic note');
  await page.evaluate(() => { void window.quintShell.send(); });
  await card.waitFor();
  await page.waitForFunction(() => window.approvalRoutes.listReplies.length > 0);
  const observe = () => page.evaluate(id => {
    const f = window.approvalRoutes, shell = window.quintShell;
    const {alphaClient, connectionController} = window.quintActors;
    const card = shell.S().msgs.find(row => row.card?.proposalId === id)?.card;
    const receipt = card?.done;
    return {
      's.server': f.server,
      's.executions': f.effects,
      's.requests': f.decisions,
      's.inFlight': Number(!!f.finishDecision),
      's.clientProposal': alphaClient.proposals.has(id),
      's.consumed': alphaClient.consumed.has(id),
      's.card': !card ? 'none' : receipt ? card.title === 'Completed' ? 'done' : 'unconfirmed' : card.reviewUnavailable ? 'unavailable' : card.recovered ? 'recovered' : 'live',
      's.tap': !shell.pendingActionApproval ? 'none' : f.finishDecision || f.finishReceipt ? 'executing' : 'fetching',
      's.reattachments': connectionController.getSnapshot().history?.revision ? 1 : 0,
      's.completedShown': card?.title === 'Completed',
    };
  }, proposalId);
  const trace = {name, init:{name:'init'}, expect:await observe(), steps:[]};
  const checkpoint = async (action, args) => trace.steps.push({label:action, action:{name:action, ...(args ? {args} : {})}, expect:await observe()});
  assert.equal(trace.expect['s.card'], 'live');
  const releaseLists = (keepHolding = false) => page.evaluate(keepHolding => {
    const f = window.approvalRoutes;
    f.holdLists = keepHolding;
    f.listReplies.splice(0).forEach(release => release());
  }, keepHolding);
  const waitApproval = () => page.waitForFunction(() => window.approvalRoutes.finishDecision);
  const waitIdle = () => page.waitForFunction(() => !window.quintShell.pendingActionApproval);
  const waitSettlement = (detectRedispatch = false) => page.waitForFunction(({id, detectRedispatch}) => {
    const shell = window.quintShell;
    return (detectRedispatch && window.approvalRoutes.finishDecision) || (!shell.pendingActionApproval
      && shell.S().msgs.some(row => row.card?.proposalId === id && row.card.done));
  }, {id:proposalId, detectRedispatch});
  const waitRecovered = () => page.waitForFunction(id => window.quintShell.S().msgs.find(row => row.card?.proposalId === id)?.card.recovered, proposalId);
  if (name === 'recovered approval' || name.endsWith('refetch')) {
    await releaseLists();
    await waitRecovered();
    await checkpoint('recover');
    await page.evaluate(() => { window.approvalRoutes.holdLists = true; });
    await card.click();
    await page.waitForFunction(() => window.approvalRoutes.listReplies.length === 1);
    await checkpoint('tapApprove');
    if (name === 'retired refetch') {
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', {configurable:true, get:() => true});
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await waitIdle();
      await releaseLists();
      await checkpoint('abortTap');
      assert.deepEqual(errors, []);
      return trace;
    }
    if (name === 'absent refetch') {
      await page.evaluate(() => { window.approvalRoutes.server = 'absent'; });
      await checkpoint('agentWithdrawsReview');
      await releaseLists(true);
      await waitIdle();
      await checkpoint('fetchSettles');
      await releaseLists();
      await page.waitForFunction(id => window.quintShell.S().msgs.find(row => row.card?.proposalId === id)?.card.reviewUnavailable, proposalId);
      await checkpoint('recover');
      assert.deepEqual(errors, []);
      return trace;
    }
    await releaseLists();
    await waitApproval();
    await checkpoint('fetchSettles');
  } else {
    await card.click();
    await waitApproval();
    await checkpoint('tapApprove');
  }
  if (name === 'unconfirmed after reload') {
    await page.evaluate(() => {
      const f = window.approvalRoutes;
      f.rejectDecision = true;
      f.finishDecision();
    });
    await waitSettlement();
    await page.getByText('Action did not reach a confirmed result. Check action history before requesting it again.', {exact:true}).first().waitFor();
    await checkpoint('unconfirmedReceiptArrives');
    const session = await page.evaluate(() => window.quintActors.connectionController.getSnapshot().session);
    await page.evaluate(() => {
      const {connectionController} = window.quintActors;
      // History checks journaled receipts through one list before the new transcript's recovery.
      window.approvalRoutes.admitNextList = true;
      void connectionController.restoreHistory(connectionController.getSelectedConversationId());
    });
    await page.waitForFunction(id => window.quintActors.connectionController.getSnapshot().history?.revision === 1
      && !window.quintShell.S().msgs.some(row => row.card?.proposalId === id), proposalId);
    assert.deepEqual(await page.evaluate(() => window.quintActors.connectionController.getSnapshot().session), session);
    await checkpoint('reattach', [true]);
    await releaseLists();
    await waitRecovered();
    await checkpoint('recover');
    await page.evaluate(() => { window.approvalRoutes.holdLists = true; });
    await card.click();
    await page.waitForFunction(() => window.approvalRoutes.listReplies.length === 1);
    await checkpoint('tapApprove');
    await releaseLists();
    await waitSettlement(true);
    await checkpoint('fetchSettles');
  } else {
    await page.evaluate(() => { window.approvalRoutes.finishDecision(); });
    await page.waitForFunction(() => window.approvalRoutes.finishReceipt);
    await checkpoint('agentHandlesExecute');
    await page.evaluate(() => { window.approvalRoutes.finishReceipt(); });
    await waitSettlement();
    await checkpoint('receiptArrives');
  }
  assert.deepEqual(await page.evaluate(() => window.approvalRoutes.unexpected), []);
  assert.deepEqual(errors, []);
  return trace;
}

export async function checkApprovalRoutes(extraSources = []) {
  const {scenarios:traces, sources, driverHashes} = await withMountedShell(
    ['live approval','recovered approval','retired refetch','absent refetch','unconfirmed after reload'], approvalTrace,
    {install:installApprovalPort, extraSources:[self, ...extraSources]},
  );
  return checkTraces({model:'ApprovalRoutes', traces, sources, driverHashes, scope:'bounded-orchestration', assumptions:[
    'The real mounted app includes the shell, AlphaClient, connection controller and shared device-action coordinator. The native journal, agent endpoint and device effect are synthetic.',
    'A single synthetic Notes proposal is supplied under verified resident registration. Five schedules cover a live approval, recovered approval, refetch retirement, a withdrawn proposal and reuse of an unconfirmed result after same-session history restore.',
    'Received decision calls and the synthetic native effect model requests and execution. The fixture does not establish agent-journal authority, a distinct resident session, or signed/device acceptance.',
  ]});
}

if (process.argv[1] === self) {
  const result = await checkApprovalRoutes();
  console.log(JSON.stringify({model:result.model, traces:result.traces, checkpoints:result.checkpoints, receiptPath:result.receiptPath}));
}
