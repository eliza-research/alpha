/**
 * Alpha's composer, Calendar and email recovery drafts use the shared durable draft controller
 * (elizaOS packages/ui/src/state/durable-draft-controller.ts): durable hold/commit/release around
 * each send, conversation and owner fencing by binding, and an unknown dispatch outcome that is
 * never offered for a second send. This name is kept for the existing call sites.
 */
export {DurableDraftController as AssistantDraftController} from '../../../../.eliza/client-features/packages/ui/src/state/durable-draft-controller.ts';
