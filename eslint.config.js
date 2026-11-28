import { readFileSync } from "node:fs"
import { relative, sep } from "node:path"
import js from "@eslint/js"
import react from "@eslint-react/eslint-plugin"
import tailwind from "eslint-plugin-better-tailwindcss"
import boundaries from "eslint-plugin-boundaries"
import reactHooks from "eslint-plugin-react-hooks"
import { defineConfig, globalIgnores } from "eslint/config"
import tseslint from "typescript-eslint"
import vibelang from "vibelang/eslint"
import { designSystem } from "./vibestack/design/eslint.ts"
import { parseTokens } from "./vibestack/design/tokens.ts"
import { withWorkspaceBarrels } from "./vibestack/eslint.ts"

const stack = 'AGENTS.md, "The stack"'
const monorepo = 'CONTRIBUTING.md, "The monorepo"'
const banned = ["redux", "react-redux", "zustand", "mobx", "jotai", "recoil", "valtio", "xstate", "vue", "svelte", "jest"]
const scopes = ["reduxjs", "angular", "xstate", "vue", "sveltejs", "jest"]
const imports = {
  patterns: [
    // A package, its subpaths and its family: zustand/middleware, redux-saga, @angular/core.
    { regex: `^(?:@(?:${scopes.join("|")})/|(?:${banned.join("|")})(?:[/-]|$))`, message: `Not part of the stack: ${stack}.` },
    { regex: String.raw`^@elizaos/(?!os/(?:android|aosp|browser/(?:runtime|protection|chromium/component))/|core/(?:catalog/[\w-]+|restart-exit-code)\.json$)[^/]+/`, message: "Import an eliza package from its root barrel: only its declared asset exports take a subpath." },
  ],
}
const noNodeInBrowser = [
  { regex: "^@elizaos/(?:os(?:/(?:build|image|browser(?!/address)|app-update|inference|android|aosp))?$|agent-host(?:/|$)|cloud-worker(?:/|$)|core-node(?:/|$)|plugin-workflow-worker(?:/|$))", message: "Browser code may only import browser-safe @elizaos barrels, never Node/host/worker packages." },
  { regex: "^@repo/eliza-harness(?:/|$)", message: "Browser application code must not import @repo/eliza-harness." },
]
const intraAppBarrels = [
  { regex: String.raw`^\.\./runtime/(?!index\.vibe$|ui\.tsx$|store\.ts$)`, message: "Import app runtime through ../runtime/index.vibe, ../runtime/ui.tsx, or ../runtime/store.ts." },
  { regex: String.raw`^\.\./platform/(?!index\.vibe$)`, message: "Import app platform services through ../platform/index.vibe." },
  { regex: String.raw`^\.\./shell/(?!index\.vibe$|ui\.tsx$|views\.tsx$)`, message: "Import app shell through ../shell/index.vibe or ../shell/ui.tsx." },
  { regex: String.raw`^\.\./notices/(?!index\.vibe$)`, message: "Import app notices through ../notices/index.vibe." },
  { regex: String.raw`^\.\./comms/(?!index\.vibe$|ui\.tsx$)`, message: "Import shared comms through ../comms/index.vibe or ../comms/ui.tsx." },
]
const noPhoneInternals = {
  regex: String.raw`^\.\./phone/(?:back|visit|words|named-review|comms|phone|voicemail|CommsBar|PhoneTabs|CommsTarget|CallStrip)\.`,
  message: "Import shared comms primitives through ../comms/index.vibe or ../comms/ui.tsx.",
}
// AGENTS.md, "Hard rules": an interface keeps its state in the spec's Machine and leaves effects and time to the shell.
// AGENTS.md, "This project": fakes and fixtures live in tests and development only, never in what a build ships.
const noTests = { regex: "(^|/)test/", message: 'An application never imports its tests or their fakes: AGENTS.md, "This project".' }
const noEffects = { paths: [{ name: "react", importNames: ["useEffect", "useLayoutEffect", "useInsertionEffect"], message: 'Send an event to the Machine, or run the effect in the shell: AGENTS.md, "Hard rules".' }], patterns: [...imports.patterns, noTests] }
const dialogs = ["alert", "confirm", "prompt"].map((name) => ({ name, message: "Use Dialog or Alert from @repo/ui." }))
const timers = ["setTimeout", "setInterval", "requestAnimationFrame", "requestIdleCallback"].map((name) => ({ name, message: 'Time belongs to the shell, as an Effect: AGENTS.md, "Hard rules".' }))
/** The same timers reached through the page's own names for the global object. */
const timersOf = ["window", "globalThis", "self"].flatMap((object) => timers.map(({ name, message }) => ({ object, property: name, message })))
// A screen reads no clock: the time of an event is the shell's, and `can` is asked at it (apps/app/src/runtime/react.ts).
const clocks = [
  { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: 'A screen reads no clock: write `now: untimed`, and show a time the machine holds: AGENTS.md, "This project".' },
  { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'A screen reads no clock: write `now: untimed`, and show a time the machine holds: AGENTS.md, "This project".' },
  { selector: "CallExpression[callee.object.name='performance'][callee.property.name='now']", message: 'A screen reads no clock: write `now: untimed`, and show a time the machine holds: AGENTS.md, "This project".' },
  { selector: "CallExpression[callee.property.name='format'][arguments.length=0]", message: 'A formatter with no date formats the clock, and a screen reads no clock: format a time the machine holds: AGENTS.md, "This project".' },
]
const noReact = { patterns: [...imports.patterns, { regex: "^react(?:-dom)?(?:/|$)", message: `Tool and domain code does not import React: ${monorepo}.` }] }
// What no tsconfig.json includes, so the type-aware rules cannot see it.
const untyped = ["*.{js,ts}", "apps/app/public/**/*.js", "vibestack/studio/scripts/**", "**/.storybook/**", "packages/design-system/**", "vibestack/design/test/**", "vibestack/stories/test/**"]
// Every React interface: Studio's page is built on the same theme (vibestack/studio/vite.config.ts).
const tsx = ["packages/ui/**/*.{ts,tsx}", "apps/**/*.{ts,tsx}", "vibestack/studio/src/page/**/*.{ts,tsx}"]
const design = "packages/design-system"
const writing = 'AGENTS.md, "Writing code"'
const citation = String.raw`spec\/\S+\.md, "(?:[^"\\]|\\["\\])+"`
const suppressible = String.raw`(?!code\/|barrel\/|no-console\b)[\w@/-]+`
// AGENTS.md, "Writing code": a citation's line may end with `: ` and what the step shows, and a declaration keeps its doc comment.
const cited = new RegExp(String.raw`^\s*${citation}(?:; ${citation})*(?:: \S.*)?\s*$`)
const suppression = new RegExp(String.raw`^ eslint-disable(?:-next-line|-line)? ${suppressible}(?:, ${suppressible})* -- \S`)
const configs = [suppression, /^ eslint-enable\b/]
const throwsType = String.raw`[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*`
const throwsShape = String.raw`\{[ \t]*${throwsType}(?:[ \t]*\|[ \t]*${throwsType})*[ \t]*\}`
const throwsDirective = new RegExp(String.raw`^\*(?:[\s*]*@throws ${throwsShape})+[\s*]*$`)
const malformedThrows = new RegExp(String.raw`@throws\b(?![ \t]+${throwsShape})`)
const directives = {
  Line: [cited, suppression, /^@ (?:backend|requires|ensures|invariant|decreases|assert|pure|type|ghost)(?: |$)/, /^\/ <reference /, /^ @vitest-environment [\w-]+$/],
  Block: [cited, ...configs, /^\*(?:[\s*]*@(?:model|design) \S+)+[\s*]*$/, throwsDirective],
  Shebang: [/^/],
}
const inline = /^\s*(?:eslint(?:-[a-z]+)*|exported|globals?)(?:\s|$)/
const guarded = (parser) => ({
  meta: { name: `${parser.meta.name} with code/inline`, version: parser.meta.version },
  parseForESLint: (text, options) => {
    const parsed = parser.parseForESLint(text, options)
    const loose = parsed.ast.comments.find((comment) => inline.test(comment.value) && !configs.some((form) => form.test(comment.value)))
    if (loose) throw Object.assign(new SyntaxError(`Inline config here is only "eslint-disable[-next-line|-line] <rule>, … -- <reason>", never for code/*, barrel/* or no-console, and "eslint-enable" (${writing}).`), { lineNumber: loose.loc.start.line, column: loose.loc.start.column + 1 })
    return parsed
  },
})
const declaration = /(?:Declaration|Signature|PropertyDefinition|MethodDefinition|^Property|^TSEnumMember)$/
const documented = (context, comment) => {
  if (!context.options[0]?.jsdoc || comment.type !== "Block" || !comment.value.startsWith("*") || malformedThrows.test(comment.value)) return false
  const start = context.sourceCode.getTokenAfter(comment)?.range[0]
  if (start === undefined) return false
  for (let node = context.sourceCode.getNodeByRangeIndex(start); node && node.range[0] === start; node = node.parent) {
    if (declaration.test(node.type)) return true
  }
  return false
}
const left = { type: "object", additionalProperties: { type: "integer", minimum: 1 } }
const excess = (context, node, found, kind) => {
  const rel = relative(context.cwd, context.filename).split(sep).join("/")
  const allowed = context.options[0]?.left?.[rel] ?? 0
  if (found.length > allowed) found.forEach((problem) => context.report(problem))
  else if (allowed > 0 && found.length < allowed) context.report({ node, message: found.length ? `Stale ${kind} ratchet (${allowed}) for "${rel}": ${found.length} remain; lower it to ${found.length}.` : `Stale ${kind} ratchet (${allowed}) for "${rel}": 0 remain; remove it.` })
}
const comments = {
  meta: { type: "problem", schema: [{ type: "object", properties: { jsdoc: { type: "boolean" }, left }, additionalProperties: false }] },
  create: (context) => ({
    Program: (node) => excess(context, node, context.sourceCode.getAllComments()
      .filter((comment) => !directives[comment.type].some((directive) => directive.test(comment.value)) && !documented(context, comment))
      .map((comment) => ({ loc: comment.loc, message: `No code comments: only spec citations and tool directives (${writing}).` })), "commented"),
  }),
}
const uses = (names) => `:matches(Identifier[name=${names}]:not(ImportSpecifier[imported.name=${names}] > Identifier.local):not(ObjectExpression > Property[computed=false][shorthand=false] > Identifier.key), MemberExpression[computed=true] > Literal.property[value=${names}])`
const scheduling = {
  [uses(/^use(?:Layout|Insertion)?Effect$/)]: `No effect hooks: shared state lives in the spec-backed Machine (${writing}).`,
  [uses(/^(?:setTimeout|setInterval|setImmediate|queueMicrotask|requestAnimationFrame|requestIdleCallback)$/)]: `No timers: wait with Effect in VibeLang, or let the Machine say when (${writing}).`,
}
const effects = {
  meta: { type: "problem", schema: [{ type: "object", properties: { left }, additionalProperties: false }] },
  create: (context) => {
    const found = []
    return { ...Object.fromEntries(Object.entries(scheduling).map(([selector, message]) => [selector, (node) => found.push({ node, message })])), "Program:exit": (node) => excess(context, node, found, "scheduled") }
  },
}
const code = { rules: { comments, effects } }
const own = ["apps/**", "packages/**"]
const commented = { "apps/app/test/app.browser.test.tsx": 1, "packages/ui/vite.config.ts": 1 }
const scheduled = {}

// The tool reads Quint's JSON and the TypeScript compiler API as `any` at its boundaries; packages and apps stay strict.
const loose = Object.fromEntries(["no-explicit-any", "no-unsafe-argument", "no-unsafe-assignment", "no-unsafe-call", "no-unsafe-member-access", "no-unsafe-return"].map((rule) => [`@typescript-eslint/${rule}`, "off"]))

export default withWorkspaceBarrels(defineConfig(
  // Generated or disposable, and .claude/worktrees holds other checkouts of this repository.
  globalIgnores([".eliza/", "apps/app/android/", "apps/app/aosp/", "**/gen/", "!vibestack/gen/", "**/.vibe/", "**/dist/", "**/dist-suite/", "**/build/", "**/.cache/", "**/.spec-cache/", "**/generated/", "**/storybook-static/", "**/test/fixtures/", "vibestack/examples/", "vibestack/fixtures/", ".claude/", ".lemmascript/", ".studio/", ".turbo/", "_apalache-out/"]),
  { linterOptions: { reportUnusedDisableDirectives: "error", reportUnusedInlineConfigs: "error" } },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "package", pattern: ["packages/*", "apps/*"], capture: ["name"] },
        { type: "studio", pattern: "vibestack/studio" },
        { type: "tool", pattern: "vibestack" },
      ],
    },
    rules: {
      "no-restricted-imports": ["error", imports],
      // A relative path stays inside its package; the tool and Studio, which ships inside it, import each other.
      "boundaries/dependencies": ["error", {
        default: "disallow",
        policies: [
          { from: { element: { type: "package" } }, allow: { to: { element: { type: "package", captured: { name: "{{ from.element.captured.name }}" } } } } },
          { from: { element: { types: ["tool", "studio"] } }, allow: { to: { element: { types: ["tool", "studio"] } } } },
        ],
      }],
      // Nor does it reach a file outside every package and the tool.
      "boundaries/no-unknown-dependencies": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
      // node:test runs what `test` and `describe` return; an async event listener is awaited by nobody by design.
      "@typescript-eslint/no-floating-promises": ["error", { allowForKnownSafeCalls: [{ from: "package", package: "node:test", name: ["test", "describe", "it"] }] }],
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { arguments: false } }],
      // Regular expressions here match the tools' column-aligned output, where literal spaces read as the output does.
      "no-regex-spaces": "off",
      // AGENTS.md, "Writing code": one path, so nothing is left for later or kept beside its replacement.
      "no-warning-comments": ["error", { terms: ["todo", "fixme", "legacy", "deprecated"], location: "anywhere" }],
    },
  },
  { files: untyped, extends: [tseslint.configs.disableTypeChecked] },
  { files: ["apps/app/public/voice/**/*.js"], languageOptions: { globals: { AudioWorkletProcessor: "readonly", registerProcessor: "readonly", sampleRate: "readonly" } } },
  // A ratchet at today's longest (Studio's server); a test's describe block holds its cases.
  { ignores: ["**/test/**", "vibestack/selftest.ts"], rules: { "max-lines-per-function": ["error", { max: 250, skipBlankLines: true, skipComments: true }] } },
  {
    files: ["vibestack/**"],
    ignores: ["**/*.tsx"],
    rules: {
      ...loose,
      // `value!` after a check the compiler cannot follow is this code's style, also where a later TypeScript made it redundant.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      // `unknown | Promise<unknown>` and `Json | undefined` document intent although `unknown` and `any` absorb the rest.
      "@typescript-eslint/no-redundant-type-constituents": "off",
      // The TypeScript API compares masked flags: `(flags & NodeFlags.BlockScoped) === NodeFlags.Const`.
      "@typescript-eslint/no-unsafe-enum-comparison": "off",
      // Node types execFile's error as an intersection of Omit<>s, which the rule does not see is an Error.
      "@typescript-eslint/prefer-promise-reject-errors": "off",
      // The compiler host's methods and a driver's functions are passed around as plain functions that use no `this`.
      "@typescript-eslint/unbound-method": "off",
      // Studio's DOM helpers stringify attribute values and children typed `unknown`.
      "@typescript-eslint/no-base-to-string": "off",
    },
  },
  // VibeLang's parser gives .vibe files typescript-eslint's tree without a program, so the rules that need types stay off: `vibelang --noEmit` checks them.
  { files: ["**/*.{vibe,vibex}"], extends: [tseslint.configs.disableTypeChecked], languageOptions: { parser: vibelang, parserOptions: { projectService: false } }, rules: { "no-undef": "off" } },
  // React belongs to interfaces: the tools apart from Studio's page, and schemas, contracts, drivers and the shell everywhere, do without it.
  {
    files: ["vibestack/**", "**/*.{schema,contract}.ts", "**/test/drivers/**", "**/*.vibe"],
    ignores: ["vibestack/studio/src/page/**"],
    rules: { "no-restricted-imports": ["error", noReact] },
  },
  // eslint-plugin-react-hooks owns the rules both plugins ship; @eslint-react adds the rest.
  {
    files: ["**/*.tsx"],
    extends: [react.configs["recommended-type-checked"], reactHooks.configs.flat.recommended],
    rules: Object.fromEntries(Object.keys(reactHooks.rules).filter((rule) => `@eslint-react/${rule}` in react.configs["recommended-type-checked"].rules).map((rule) => [`@eslint-react/${rule}`, "off"])),
  },
  // vibestack/design/eslint.ts: token classes only, read from the theme `pnpm --filter @repo/design-system build` writes.
  {
    files: tsx,
    extends: [designSystem({ tailwind, tokens: parseTokens(JSON.parse(readFileSync(`${design}/tokens.json`, "utf8"))), entryPoint: `${import.meta.dirname}/${design}/generated/theme.css` })],
    settings: { "better-tailwindcss": { cwd: design } },
  },
  // @repo/ui holds the form controls and dialogs every interface uses.
  {
    files: tsx,
    ignores: ["packages/ui/**"],
    rules: {
      "no-restricted-globals": ["error", ...dialogs],
      "no-restricted-syntax": ["error", { selector: "JSXOpeningElement[name.name=/^(input|textarea)$/]", message: "Use Input, Textarea or Checkbox from @repo/ui." }],
    },
  },
  // The application and its components: no effect hooks and no timers.
  { files: ["apps/**/src/**/*.{ts,tsx}"], rules: { "no-restricted-imports": ["error", noEffects], "no-restricted-globals": ["error", ...timers, ...dialogs], "no-restricted-properties": ["error", ...timersOf] } },
  { files: ["apps/app/src/**/*.{ts,tsx}"], rules: { "no-restricted-imports": ["error", { ...noEffects, patterns: [...noEffects.patterns, ...noNodeInBrowser, ...intraAppBarrels] }] } },
  { files: ["apps/app/src/*/**/*.{ts,tsx}"], ignores: ["apps/app/src/{comms,phone}/**"], rules: { "no-restricted-imports": ["error", { ...noEffects, patterns: [...noEffects.patterns, ...noNodeInBrowser, ...intraAppBarrels, noPhoneInternals] }] } },
  { files: ["apps/**/src/**/*.tsx"], rules: { "no-restricted-syntax": ["error", { selector: "JSXOpeningElement[name.name=/^(input|textarea)$/]", message: "Use Input, Textarea or Checkbox from @repo/ui." }, ...clocks] } },
  { files: ["apps/**/src/**/*.vibe"], rules: { "no-restricted-imports": ["error", { patterns: [...noReact.patterns, noTests] }] } },
  { files: ["apps/app/src/**/*.vibe"], rules: { "no-restricted-imports": ["error", { patterns: [...noReact.patterns, noTests, ...noNodeInBrowser, ...intraAppBarrels] }] } },
  { files: ["apps/app/src/*/**/*.vibe"], ignores: ["apps/app/src/{comms,phone}/**"], rules: { "no-restricted-imports": ["error", { patterns: [...noReact.patterns, noTests, ...noNodeInBrowser, ...intraAppBarrels, noPhoneInternals] }] } },
  { files: ["packages/ui/src/**/*.{ts,tsx}"], rules: { "no-restricted-imports": ["error", { ...noEffects, patterns: [...noEffects.patterns, ...noNodeInBrowser] }], "no-restricted-globals": ["error", ...timers], "no-restricted-properties": ["error", ...timersOf] } },
  { files: own, ignores: ["**/*.{vibe,vibex}"], languageOptions: { parser: guarded(tseslint.parser) } },
  { files: ["{apps,packages}/**/*.{vibe,vibex}"], languageOptions: { parser: guarded(vibelang) } },
  { files: own, plugins: { code }, rules: { "no-console": "error", "code/comments": ["error", { jsdoc: true, left: commented }], "code/effects": ["error", { left: scheduled }] } },
), { root: import.meta.dirname })
