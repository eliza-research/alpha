/** IPC exposure for existing canonical Notes/Calendar APIs. Domain validation and
 * mutation authority remain in the owning Eliza service and view broker. */
import type {VerifiedSession} from './alpha-client';
import {ownerRouteAllowed} from './owner-route-policy';
export type AppRecordMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export interface AppRecordPort {
 readonly sessionId: string;
 readonly scope?: string;
 readonly identity: VerifiedSession;
 current(): boolean;
 request(path: string, method: AppRecordMethod, body: unknown | undefined, signal: AbortSignal): Promise<unknown>;
}
export function assertAppRecordRequestAllowed(path: unknown, method: unknown, body: unknown): asserts path is string {
 if(!ownerRouteAllowed('records', path, method) || ((method === 'GET' || method === 'DELETE') && body !== undefined))throw Error('Unsupported app record request. Nothing was sent.');
}
