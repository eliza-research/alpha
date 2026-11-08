/** Interpreter for config/owner-routes.json, the owner-bound routes the renderer may reach; the Android gate
 * (OwnerRoutes.java) reads the same table. Domain validation and mutation authority stay in the Eliza services. */
import table from '../../../../config/owner-routes.json' with {type:'json'};
export type OwnerRouteGroup = keyof typeof table.groups;
const unsafe = new RegExp(table.unsafe);
// Validated and compiled once, at load: an {id} route needs its group's id pattern.
const groups = new Map(Object.entries(table.groups as Record<string, {prefixes: string[]; id?: string; routes: {methods: string[]; paths: string[]; query?: string[]}[]}>).map(([name, {id, ...group}]) => {
 if(id === undefined && group.routes.some(({paths}) => paths.some(pattern => pattern.includes('{id}'))))throw Error(`Owner route group ${name} has an {id} route but no id pattern`);
 return [name, {...group, id: id === undefined ? undefined : new RegExp(id)}];
}));

/** The group, among those named or else all, whose longest prefix claims the path. */
export function ownerRouteGroup(path: unknown, ...among: OwnerRouteGroup[]): OwnerRouteGroup | undefined {
 let claimant: OwnerRouteGroup | undefined, longest = -1;
 for(const name of among.length ? among : [...groups.keys()] as OwnerRouteGroup[])for(const prefix of named(name).prefixes)
  if(typeof path === 'string' && prefix.length > longest && (path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?'))){claimant = name; longest = prefix.length;}
 return claimant;
}
export function ownerRouteAllowed(name: OwnerRouteGroup, path: unknown, method: unknown): path is string {
 const group = named(name);
 if(typeof path !== 'string' || path.length > 2048 || !path.startsWith('/') || path.startsWith('//') || unsafe.test(path) || /%(?![0-9A-Fa-f]{2})/.test(path))return false;
 const parts = path.split('?');
 if(parts.length > 2 || parts[0].includes('//') || /\/\.{1,2}(\/|$)/.test(parts[0]))return false;
 const keys: string[] = [];
 if(parts[1])for(const pair of parts[1].split('&')){const key = decode(pair.split('=')[0]);if(key === undefined || keys.includes(key))return false;keys.push(key);}
 return group.routes.some(({methods, paths, query}) => methods.includes(method as string) && (!query || keys.every(key => query.includes(key))) && paths.some(pattern => {
  const id = segment(pattern, query ? parts[0] : path), value = id && query ? decode(id) : id;
  return id === '' || value !== undefined && group.id!.test(value);
 }));
}
/** The named group; an unknown name is a caller error, never a group that admits nothing or everything. */
function named(name: string) {
 const group = groups.get(name);
 if(!group)throw Error(`Unknown owner route group ${name}`);
 return group;
}
/** The {id} segment of path under pattern, '' when the pattern has none, undefined when the path does not fit it. */
function segment(pattern: string, path: string): string | undefined {
 const at = pattern.indexOf('{id}');
 if(at < 0)return pattern === path ? '' : undefined;
 const head = pattern.slice(0, at), tail = pattern.slice(at + 4);
 if(path.length <= head.length + tail.length || !path.startsWith(head) || !path.endsWith(tail))return;
 const id = path.slice(head.length, path.length - tail.length);
 // One path segment: never a slash, and never the query of a route matched literally with it (as the shared
 // native OwnerRoutePolicy).
 return id.includes('/') || id.includes('?') ? undefined : id;
}
/** Percent-decodes keeping '+' literal; malformed UTF-8 refuses, as no allowed key or id accepts the native U+FFFD. */
function decode(value: string): string | undefined {
 try{return decodeURIComponent(value);}catch{return undefined;}
}
