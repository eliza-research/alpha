import type {openDomainRecovery} from '../browser/domain-recovery';
import type {WorkflowIntentStore} from './workflow-intents';

type RecoveryRequest = {
  store: Pick<WorkflowIntentStore, 'recoveryDocument'>;
  current: () => boolean;
  changed: () => void;
  unavailable: () => void;
};

export function createWorkflowRequestRecovery(loadDialog: () => Promise<typeof openDomainRecovery>) {
  let owner: AbortController | undefined;
  const retire = () => {
    const previous = owner;
    owner = undefined;
    previous?.abort();
  };

  async function open(request: RecoveryRequest) {
    if (!request.current()) return;
    retire();
    const controller = owner = new AbortController();
    const current = () => owner === controller && request.current();
    const check = (signal?: AbortSignal) => {
      signal?.throwIfAborted();
      if (!current()) throw new DOMException('Workflow recovery retired', 'AbortError');
    };

    try {
      const domain = await request.store.recoveryDocument();
      if (!current()) return;
      const show = await loadDialog();
      if (!current()) return;
      show({
        capture(signal) {
          check(signal);
          return domain.capture(signal);
        },
        async reset(expected, signal) {
          check(signal);
          await domain.reset(expected, signal);
          if (current()) request.changed();
        },
      }, 'workflow requests', 'Browser workflow request recovery',
      'Download pending requests before resetting. An uncertain operation may already have run. Check execution history before repeating it. Reset clears only this agent’s saved requests and does not cancel executions.',
      controller.signal);
    } catch {
      if (current()) request.unavailable();
    }
  }

  return {open, retire};
}
