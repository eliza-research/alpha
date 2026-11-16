import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import type {CloudEnvironment} from './cloud-sdk-authority.ts';
import type {CloudResources} from './cloud-worker.ts';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const placeholder = (value: string) => /^0{30}[0-9]{2}$/.test(value);
export const provisionedId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value) && !placeholder(value);

class CloudflareRequestError extends Error {
  readonly status: number;
  readonly codes: readonly number[];

  constructor(status: number, codes: readonly number[], operation: string) {
    super(`Cloudflare ${operation} failed (${status ? `HTTP ${status}` : 'no response'})`);
    this.status = status;
    this.codes = codes;
  }
}

function cloudflareApi(token: string, fetcher: typeof fetch) {
  return async (resource: string, operation: string, input?: RecordValue) => {
    let response: Response;
    try {
      response = await fetcher(`https://api.cloudflare.com/client/v4${resource}`, {
        method: input ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
        ...(input ? {body: JSON.stringify(input)} : {}),
      });
    } catch { throw new CloudflareRequestError(0, [], operation); }
    let envelope: RecordValue;
    try { envelope = record(await response.json()); }
    catch { throw new CloudflareRequestError(response.status, [], operation); }
    if (!response.ok || envelope.success !== true || !('result' in envelope)) {
      const errors = Array.isArray(envelope.errors) ? envelope.errors : [];
      const codes = errors.map(error => record(error).code).filter((code): code is number => typeof code === 'number');
      throw new CloudflareRequestError(response.status, codes, operation);
    }
    return envelope;
  };
}

type CloudflareApi = ReturnType<typeof cloudflareApi>;

async function list(api: CloudflareApi, resource: string, operation: string) {
  const results: RecordValue[] = [];
  // The zones endpoint accepts at most 50 results per page.
  const pageSize = 50;
  let previousPageSize: number | undefined;
  for (let page = 1; page <= 100; page++) {
    const separator = resource.includes('?') ? '&' : '?';
    const response = await api(`${resource}${separator}per_page=${pageSize}&page=${page}`, operation);
    if (!Array.isArray(response.result)) throw new Error(`Cloudflare ${operation} did not return a list`);
    results.push(...response.result.map(record));
    const {page: returnedPage, per_page: perPage = pageSize, total_count: totalCount} = record(response.result_info);
    if ((returnedPage !== undefined && returnedPage !== page) || typeof perPage !== 'number' || !Number.isSafeInteger(perPage) ||
      perPage < 1 || perPage > pageSize || (previousPageSize !== undefined && perPage !== previousPageSize) ||
      response.result.length > perPage || (totalCount !== undefined &&
        (typeof totalCount !== 'number' || !Number.isSafeInteger(totalCount) || totalCount < results.length))) {
      throw new Error(`Cloudflare ${operation} returned inconsistent pagination`);
    }
    previousPageSize = perPage;
    // An endpoint can report an unfiltered total even when its exact-name result is exhausted.
    if (response.result.length < perPage || results.length === totalCount) return results;
  }
  throw new Error(`Cloudflare ${operation} exceeded the page limit`);
}

function configuredId(value: string, label: string) {
  if (placeholder(value)) return undefined;
  if (!provisionedId(value)) throw new Error(`${label} is not a Cloudflare ID`);
  return value;
}

function namedResource(rows: RecordValue[], key: 'name' | 'title', name: string, expectedId: string | undefined, siblingId: string, label: string): (RecordValue & {id: string}) | undefined {
  const matching = rows.filter(row => row[key] === name);
  if (matching.length > 1) throw new Error(`Multiple ${label} resources use ${name}`);
  const [entry] = matching;
  if (expectedId && entry?.id !== expectedId) throw new Error(`The recorded ${label} ID does not match ${name} in the selected account`);
  if (!entry) return undefined;
  if (!provisionedId(entry.id) || entry.id === siblingId || rows.filter(row => row.id === entry.id).length !== 1) {
    throw new Error(`Conflicting ${label} identity for ${name}`);
  }
  return {...entry, id: entry.id};
}

function postgresOrigin(value: string) {
  try {
    const url = new URL(value);
    const database = decodeURIComponent(url.pathname.slice(1));
    const user = decodeURIComponent(url.username), password = decodeURIComponent(url.password);
    const port = url.port ? Number(url.port) : 5432;
    if (['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname && user && password && database && port > 0 && port <= 65535) {
      return {host: url.hostname.toLowerCase(), port, database, user, password, scheme: url.protocol.slice(0, -1)};
    }
  } catch { /* Keep credentials and provider URL errors out of tool output. */ }
  throw new Error('DATABASE_URL must include a PostgreSQL origin, database and credentials');
}

async function createAndRead<T>(create: () => Promise<RecordValue>, read: () => Promise<T | undefined>, label: string, key: keyof T, duplicateCode?: number): Promise<T> {
  let created: RecordValue | undefined;
  let failure: CloudflareRequestError | undefined;
  try { created = record((await create()).result); }
  catch (error) {
    if (!(error instanceof CloudflareRequestError) || (error.status !== 0 && error.status !== 409 && error.status < 500 &&
      !(error.status >= 200 && error.status < 300 && error.codes.length === 0) &&
      (duplicateCode === undefined || !error.codes.includes(duplicateCode)))) throw error;
    failure = error;
  }
  const observed = await read();
  if (!observed) throw failure ?? new Error(`Cloudflare did not confirm the created ${label}`);
  if (created && created[String(key)] !== observed[key]) throw new Error(`Cloudflare returned a conflicting ${label} create receipt`);
  return observed;
}

/** Scope every read and mutation to the same reviewed Cloudflare account. Dry runs do not create resources. */
export async function reconcileCloudResources({ids, sibling, apiHost, databaseUrl, accountId, token, create = false, fetcher = fetch}: {
  ids: CloudResources; sibling: CloudResources; apiHost: string; databaseUrl?: string;
  accountId?: string; token?: string; create?: boolean; fetcher?: typeof fetch;
}): Promise<CloudResources> {
  const recordedAccount = configuredId(ids.accountId, 'Cloudflare account');
  const account = recordedAccount ?? accountId;
  if (!provisionedId(account) || (recordedAccount && accountId !== undefined && accountId !== recordedAccount)) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID must identify the selected Alpha Cloud account');
  }
  if (!token?.trim()) throw new Error('CLOUDFLARE_API_TOKEN is required to verify Alpha Cloud resources');
  if (ids.workerName === sibling.workerName || ids.r2Bucket === sibling.r2Bucket || ids.blobHost === sibling.blobHost || apiHost === ids.blobHost || apiHost === sibling.blobHost) {
    throw new Error('Alpha Cloud resource names must be distinct');
  }
  const kvId = configuredId(ids.kvNamespaceId, 'KV namespace');
  const hyperdriveId = configuredId(ids.hyperdriveId, 'Hyperdrive');
  if (!create && (!recordedAccount || !kvId || !hyperdriveId)) throw new Error('Record the selected account, KV and Hyperdrive IDs before deploy');
  const origin = databaseUrl === undefined && !create ? undefined : postgresOrigin(databaseUrl ?? '');
  const api = cloudflareApi(token, fetcher), accountPath = `/accounts/${account}`;
  const zones = await list(api, `/zones?${new URLSearchParams({name: ids.zone, 'account.id': account, match: 'all'})}`, 'zone lookup');
  const [zone] = zones;
  if (zones.length !== 1 || zone.name !== ids.zone || record(zone.account).id !== account || !provisionedId(zone.id)) {
    throw new Error(`Zone ${ids.zone} is not uniquely owned by the selected Cloudflare account`);
  }

  const kvPath = `${accountPath}/storage/kv/namespaces`, kvName = `${ids.workerName}-cache`;
  const hyperPath = `${accountPath}/hyperdrive/configs`, hyperName = `${ids.workerName}-db`;
  const bucketsPath = `${accountPath}/r2/buckets`, dnsPath = `/zones/${zone.id}/dns_records`;
  const readKv = async () => namedResource(await list(api, `${kvPath}?order=title&direction=asc`, 'KV lookup'), 'title', kvName, kvId, sibling.kvNamespaceId, 'KV namespace');
  const readHyper = async () => {
    const entry = namedResource(await list(api, hyperPath, 'Hyperdrive lookup'), 'name', hyperName, hyperdriveId, sibling.hyperdriveId, 'Hyperdrive');
    if (entry && origin) {
      const observed = record(entry.origin);
      if (!['postgres', 'postgresql'].some(scheme => observed.scheme === scheme) || observed.host !== origin.host ||
        observed.port !== origin.port || observed.database !== origin.database || observed.user !== origin.user) {
        throw new Error('Hyperdrive origin does not match DATABASE_URL');
      }
    }
    return entry;
  };
  const readBucket = async () => {
    let response: RecordValue;
    try { response = await api(`${bucketsPath}/${encodeURIComponent(ids.r2Bucket)}`, 'R2 lookup'); }
    catch (error) {
      if (error instanceof CloudflareRequestError && error.status === 404) return undefined;
      throw error;
    }
    const bucket = record(response.result);
    if (bucket.name !== ids.r2Bucket) throw new Error('R2 readback does not match the configured bucket name');
    return bucket;
  };
  const readDns = async (host: string) => {
    const rows = await list(api, `${dnsPath}?${new URLSearchParams({'name.exact': host})}`, 'DNS lookup');
    if (rows.some(row => row.name !== host || typeof row.type !== 'string')) throw new Error(`Unexpected DNS lookup result for ${host}`);
    const routes = rows.filter(row => row.type === 'A' || row.type === 'AAAA' || row.type === 'CNAME');
    if (!routes.length) return undefined;
    const [row] = routes;
    if (routes.length !== 1 || row.type !== 'AAAA' || row.content !== '100::' || row.proxied !== true || !provisionedId(row.id)) {
      throw new Error(`Conflicting DNS record for ${host}. Expected one proxied AAAA record for 100::`);
    }
    return row;
  };

  // Refuse all known mismatches before making any changes. A retry discovers previous successful creates by name.
  const hosts = [apiHost, ids.blobHost];
  const [kv, hyper, bucket, dns] = await Promise.all([
    readKv(), readHyper(), readBucket(), Promise.all(hosts.map(readDns)),
  ]);
  if (!create) {
    if (!kv || !hyper || !bucket || dns.some(row => !row)) throw new Error('Alpha Cloud resources are missing. Run provision before deploy');
    return {...ids, accountId: account};
  }
  const finalKv = kv ?? await createAndRead(() => api(kvPath, 'KV create', {title: kvName}), readKv, 'KV namespace', 'id', 10014);
  const finalHyper = hyper ?? await createAndRead(() => api(hyperPath, 'Hyperdrive create', {name: hyperName, origin}), readHyper, 'Hyperdrive', 'id');
  if (!bucket) await createAndRead(() => api(bucketsPath, 'R2 create', {name: ids.r2Bucket}), readBucket, 'R2 bucket', 'name');
  for (const [index, host] of hosts.entries()) {
    if (!dns[index]) await createAndRead(() => api(dnsPath, 'DNS create', {type: 'AAAA', name: host, content: '100::', proxied: true,
      comment: 'Alpha Cloud Worker route'}), () => readDns(host), 'DNS record', 'id');
  }
  return {...ids, accountId: account, kvNamespaceId: finalKv.id, hyperdriveId: finalHyper.id};
}

/** Persist one environment without overwriting edits made while Cloudflare requests were in flight. */
export function writeProvisionedResources(file: string, environment: CloudEnvironment, expected: CloudResources, verified: CloudResources) {
  const lease = `${file}.alpha-cloud-write-lock`;
  const lock = fs.openSync(lease, 'wx', 0o600);
  try {
    const original = fs.lstatSync(file);
    if (!original.isFile()) throw new Error('Cloud resources must be a regular file');
    const resources = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<CloudEnvironment, CloudResources>;
    const current = resources[environment];
    if (isDeepStrictEqual(current, verified)) return;
    if (!isDeepStrictEqual(current, expected)) throw new Error(`Cloud resources changed for ${environment}; rerun provision`);
    resources[environment] = verified;
    const scratch = fs.mkdtempSync(path.join(path.dirname(file), '.alpha-cloud-resources-'));
    const staged = path.join(scratch, 'resources.json');
    try {
      fs.writeFileSync(staged, JSON.stringify(resources, null, 2) + '\n', {mode: original.mode & 0o777});
      fs.renameSync(staged, file);
    } finally { fs.rmSync(scratch, {recursive: true, force: true}); }
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lease);
  }
}
