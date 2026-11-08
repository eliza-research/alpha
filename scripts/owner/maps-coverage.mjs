#!/usr/bin/env node
/**
 * Owner prep for #667 (docs/human-actions.md H-05, H-16). Local files only; contacts nothing and
 * never reads a setting's value.
 *
 *   node scripts/owner/maps-coverage.mjs coverage FILE [--extract-bounds W,S,E,N] [--point LAT,LON ...]
 *   node scripts/owner/maps-coverage.mjs checklist [--environment staging|production] [--names FILE]
 *
 * `coverage` validates a candidate ELIZA_MAPS_COVERAGE_JSON with the pinned upstream rules
 * (packages/cloud/shared/src/lib/services/maps/osm-provider.ts parseCoverageRegions: 1 to 64
 * regions, id ^[a-z0-9][a-z0-9_-]{0,63}$ and unique, name 1..100 characters, bounds
 * [west,south,east,north] with west < east and south < north inside the world). With
 * --extract-bounds it also requires every region inside the served extract (the reference stack
 * README says the bounds must lie inside the extract), and each --point is reported inside or
 * outside coverage. It prints the one-line value for the operator.
 *
 * `checklist` prints the H-16 settings for one environment. With --names it reads a JSON list of
 * the setting names that are set (for example the names column of `wrangler secret list`, or
 * [{"name": ...}] rows); only names are read, so no value is ever handled.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = `Usage: node scripts/owner/maps-coverage.mjs coverage FILE [--extract-bounds W,S,E,N] [--point LAT,LON ...]
       node scripts/owner/maps-coverage.mjs checklist [--environment staging|production] [--names FILE]`;
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

/** Problems with a coverage value, by the upstream parser's rules. */
export function coverageProblems(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) return ["must list 1 to 64 regions"];
  const problems = [], ids = new Set();
  value.forEach((region, index) => {
    const at = `regions[${index}]`;
    if (!isObject(region)) { problems.push(`${at} must be {id, name, bounds}`); return; }
    if (typeof region.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(region.id)) problems.push(`${at}.id must match ^[a-z0-9][a-z0-9_-]{0,63}$`);
    else if (ids.has(region.id)) problems.push(`${at}.id ${region.id} is repeated`);
    else ids.add(region.id);
    if (typeof region.name !== "string" || !region.name.trim() || region.name.length > 100) problems.push(`${at}.name must be 1 to 100 characters`);
    if (!validBounds(region.bounds)) problems.push(`${at}.bounds must be [west, south, east, north] with west < east, south < north, inside -180..180 and -90..90`);
    if (Array.isArray(region.bounds) && region.bounds[0] > region.bounds[2]) problems.push(`${at}.bounds crosses the antimeridian, which the parser refuses; split the region in two`);
  });
  return problems;
}

export function validBounds(value) {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(v => typeof v === "number" && Number.isFinite(v))) return false;
  const [west, south, east, north] = value;
  return west >= -180 && east <= 180 && south >= -90 && north <= 90 && west < east && south < north;
}

export const inside = ([west, south, east, north], [w, s, e, n]) => w >= west && s >= south && e <= east && n <= north;
export const contains = ([west, south, east, north], latitude, longitude) => longitude >= west && longitude <= east && latitude >= south && latitude <= north;

/** The H-16 settings. `secret` ones are Worker secrets; their values never belong in a file here. */
export const SETTINGS = Object.freeze([
  { name: "ELIZA_MAPS_GEOCODER_URL", required: true, note: "HTTPS Nominatim 4.3 or later with the region extracts (reference stack: https://<MAPS_SEARCH_HOST>/)" },
  { name: "ELIZA_MAPS_GEOCODER_API_KEY", required: false, secret: true, note: "the reference stack's MAPS_ACCESS_KEY" },
  { name: "ELIZA_MAPS_ROUTER_URL", required: true, note: "HTTPS GraphHopper with the same extracts and profiles car, foot, bike" },
  { name: "ELIZA_MAPS_ROUTER_API_KEY", required: false, secret: true, note: "the reference stack's MAPS_ACCESS_KEY" },
  { name: "ELIZA_MAPS_ROUTER_PROFILES", required: false, note: 'default {"drive":"car","walk":"foot","bicycle":"bike"}' },
  { name: "ELIZA_MAPS_ROUTE_ALTERNATIVES", required: false, note: "set false when the router cannot compute alternatives" },
  { name: "ELIZA_MAPS_COVERAGE_JSON", required: true, note: "validated by: node scripts/owner/maps-coverage.mjs coverage FILE" },
  { name: "ELIZA_MAPS_DATASET_REVISION", required: true, note: "the extract date or version served; change it on every data update" },
  { name: "ELIZA_MAPS_OPERATOR", required: false, note: "who runs the geocoder and router; shown in the location disclosure (recommended)" },
  { name: "ELIZA_MAPS_ATTRIBUTION", required: false, note: "only to override the composed OpenStreetMap credit (H-35)" },
  { name: "ELIZA_MAPS_PROVIDER_ID", required: false, note: "default eliza-cloud-osm" },
  { name: "ELIZA_CLOUD_MAPS_REQUEST_ALLOWANCES", required: true, note: "H-04, validated by: node scripts/owner/subscription-limits.mjs maps-allowances FILE --rate-limits FILE" },
  { name: "ELIZA_CLOUD_PLAN_RATE_LIMITS", required: true, note: "H-03 with selected:true; Maps refuses with maps_allowance_unconfigured until it is selected" },
  { name: "INFERENCE_STRONG_REVOCATION_ENABLED", required: true, note: 'must be exactly "true"; production waits for the staged canary in the pinned packages/cloud/api/wrangler.toml' },
]);

export function namesFrom(value) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.names) ? value.names : [];
  return new Set(rows.map(row => (typeof row === "string" ? row : row?.name)).filter(name => typeof name === "string"));
}

const option = (rest, name) => { const index = rest.indexOf(name); return index >= 0 ? rest[index + 1] : undefined; };
const options = (rest, name) => rest.flatMap((item, index) => (item === name ? [rest[index + 1]] : []));
const numbers = text => String(text ?? "").split(",").map(Number);

export function main(argv, { log = console.log, error = console.error } = {}) {
  const [command, ...rest] = argv;
  if (command === "coverage" && rest[0] && !rest[0].startsWith("--")) {
    let value;
    try { value = JSON.parse(fs.readFileSync(path.resolve(rest[0]), "utf8")); } catch { log(`ELIZA_MAPS_COVERAGE_JSON candidate ${rest[0]}: not JSON`); return 1; }
    const problems = coverageProblems(value);
    const extract = option(rest, "--extract-bounds");
    if (extract !== undefined) {
      const bounds = numbers(extract);
      if (!validBounds(bounds)) problems.push("--extract-bounds must be W,S,E,N");
      else if (Array.isArray(value)) value.forEach((region, index) => { if (validBounds(region?.bounds) && !inside(bounds, region.bounds)) problems.push(`regions[${index}] (${region.id}) is not inside the extract bounds`); });
    }
    log(`ELIZA_MAPS_COVERAGE_JSON candidate ${rest[0]}: ${problems.length ? "NOT valid" : `valid, ${value.length} region(s)`}`);
    for (const line of problems) log(`  - ${line}`);
    for (const point of options(rest, "--point")) {
      const [latitude, longitude] = numbers(point);
      const hit = Array.isArray(value) ? value.filter(region => validBounds(region?.bounds) && contains(region.bounds, latitude, longitude)).map(region => region.id) : [];
      log(`  point ${latitude},${longitude}: ${hit.length ? `inside ${hit.join(", ")}` : "outside coverage (Cloud answers 422 unsupported_region)"}`);
    }
    if (!problems.length) log(`  Value for the Cloud operator (one line): ${JSON.stringify(value)}`);
    return problems.length ? 1 : 0;
  }
  if (command === "checklist") {
    const environment = option(rest, "--environment") ?? "staging";
    if (!["staging", "production"].includes(environment)) { error(USAGE); return 2; }
    const namesFile = option(rest, "--names");
    const set = namesFile ? namesFrom(JSON.parse(fs.readFileSync(path.resolve(namesFile), "utf8"))) : null;
    log(`H-16 Maps settings for ${environment}${set ? ` (checked against the names in ${namesFile}; values are not read)` : ""}:`);
    let missing = 0;
    for (const row of SETTINGS) {
      const state = set ? (set.has(row.name) ? "set" : row.required ? "MISSING" : "unset") : row.required ? "required" : "optional";
      if (state === "MISSING") missing++;
      log(`  [${state}] ${row.name}${row.secret ? " (secret)" : ""}: ${row.note}`);
    }
    if (environment === "production") log('  Production also needs the organization Durable Object binding and INFERENCE_STRONG_REVOCATION_ENABLED="true" after the staged canary (staging soak, writer audit, 5% canary, ramp).');
    log("  Deploy the Cloud capabilities route before clients; then with a signed-in plan GET /api/v1/maps/capabilities must list the regions and the dataset revision.");
    return missing ? 1 : 0;
  }
  error(USAGE);
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
