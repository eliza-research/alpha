import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const pages = ".cache/public-pages";
const browser = join(pages, "alpha-slack-assets");
const bundle = "../app/.cache/hosted-slack";

rmSync(pages, { recursive: true, force: true });
cpSync("node_modules/@elizaos/cloud-worker/dist/pages", pages, { recursive: true });
mkdirSync(browser, { recursive: true });
cpSync(join(bundle, "assets"), join(browser, "assets"), { recursive: true });
cpSync(join(bundle, "slack.html"), join(browser, "opener"));
cpSync(join(bundle, "alpha-slack-return.html"), join(browser, "return"));
