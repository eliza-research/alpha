// Knip reads .vibe files through VibeLang's own compiler, which gives it a module's imports and exports without bodies.
// Each exception below names something Knip cannot follow:
//   ignore vibestack/examples/**            standalone projects with their own install, outside the workspace
//   ignore **/test/fixtures/**              inputs the tools' tests read as text, never imported
//   ignoreIssues server.vibe exports        AGENTS is used in its own file, in a body ignoreExportsUsedInFile cannot see
//   root lemmascript                        run as an executable by vibestack/prove.ts
//   eliza-harness openssl                   the system's own, run by packages/eliza-harness/src/services.ts for the local cloud's certificate
//   root @vitest/browser                    loaded by Vitest's browser mode, beside @vitest/browser-playwright
//   root @repo/design-system                read as files by vibestack/design/test/design.test.ts
//   apps adb, openssl                       the system's own, run by apps/app/scripts/release.ts and its tests for pilot updates, readback and key custody
//   apps @capacitor/android                 native Android Gradle/Capacitor sync dependency
//   apps tesseract.js, tesseract.js-core, @tesseract.js-data/eng  native/OCR runtime dependencies
//   tailwindcss (ui, design-system, studio, apps)  resolved by @tailwindcss/vite and the lint plugin from CSS
//   entry *.schema, *.contract              imported by the tests vibestack/testing/generate.ts writes under .cache/
//   design-system eslint, eslint-plugin-better-tailwindcss, typescript-eslint  loaded by name in vibestack/design/test/design.test.ts
//   cloud wrangler                          run as an executable by apps/cloud/src/operator.vibe
import vibelang from "vibelang/knip"

const app = {
  entry: ["test/**/*.test.{ts,tsx,vibe}"],
  project: ["src/**/*.{ts,tsx,vibe,vibex,css}", "test/**/*.{ts,tsx,vibe,vibex}"],
  ignoreDependencies: ["tailwindcss"],
  ignoreBinaries: ["adb", "openssl"],
}

export default {
  compilers: { vibe: vibelang, vibex: vibelang },
  "ignore": [
    "legacy/**",
    "vibestack/examples/**",
    "**/test/fixtures/**"
  ],
  "ignoreExportsUsedInFile": true,
  "ignoreIssues": {
    "vibestack/studio/src/server.vibe": ["exports"]
  },
  "workspaces": {
    ".": {
      "entry": [
        "vibestack/design/cli.ts",
        "vibestack/stories/cli.ts",
        "vibestack/remote-cache.ts",
        "vibestack/*/test/*.test.ts",
        "vibestack/testing/test/fixture/*/src/*.{schema,contract}.{ts,vibe}"
      ],
      "project": [
        "vibestack/**/*.{ts,tsx,vibe,vibex}",
        "!vibestack/studio/**"
      ],
      "ignoreDependencies": [
        "lemmascript",
        "@vitest/browser",
        "@repo/design-system"
      ]
    },
    "packages/ui": {
      "entry": [
        "src/**/*.{meta,stories}.tsx",
        "generated/stories/*.stories.tsx"
      ],
      "project": [
        "**/*.{ts,tsx,vibe,vibex,css}"
      ],
      "ignoreDependencies": [
        "tailwindcss"
      ]
    },
    "packages/design-system": {
      "ignoreDependencies": [
        "eslint",
        "eslint-plugin-better-tailwindcss",
        "tailwindcss",
        "typescript-eslint"
      ]
    },
    "packages/cli": {
      "entry": [
        "src/main.ts",
        "src/index.ts",
        "test/**/*.test.ts"
      ],
      "project": [
        "src/**/*.ts",
        "test/**/*.ts"
      ],
      "ignoreDependencies": [
        "vibestack"
      ]
    },
    "packages/eliza-harness": {
      "entry": [
        "src/index.ts",
        "src/providers/cli.ts",
        "scripts/no-bun.ts",
        "test/**/*.test.{ts,vibe}"
      ],
      "project": [
        "src/**/*.{ts,vibe,vibex}",
        "scripts/**/*.ts",
        "test/**/*.{ts,vibe,vibex}"
      ],
      "ignoreBinaries": [
        "openssl"
      ]
    },
    "apps/agent": {
      "entry": [
        "src/main.vibe",
        "test/**/*.test.{ts,vibe}"
      ],
      "project": [
        "src/**/*.{ts,vibe,vibex}",
        "test/**/*.{ts,vibe,vibex}"
      ]
    },
    "packages/deployment": {
      "entry": [
        "src/deployment.vibe",
        "test/**/*.test.{ts,vibe}"
      ],
      "project": [
        "src/**/*.{ts,vibe,vibex}",
        "test/**/*.{ts,vibe,vibex}"
      ]
    },
    "apps/cloud": {
      "entry": [
        "src/main.vibe",
        "src/index.vibe",
        "src/worker.vibe",
        "src/edge.vibe",
        "test/**/*.test.{ts,vibe}"
      ],
      "project": [
        "src/**/*.{ts,vibe,vibex}",
        "test/**/*.{ts,vibe,vibex}"
      ],
      "ignoreDependencies": [
        "wrangler"
      ]
    },
    "vibestack/studio": {
      "entry": [
        "src/main.vibe",
        "src/project.ts",
        "src/doc.ts"
      ],
      "project": [
        "src/**/*.{ts,tsx,vibe,vibex,css}",
        "test/**/*.{ts,tsx,vibe,vibex}",
        "scripts/*.mjs"
      ],
      "ignoreDependencies": [
        "tailwindcss"
      ]
    },
    "apps/*": app,
    "apps/app": {
      ...app,
      entry: [...app.entry, "src/slack-browser.tsx"],
      ignoreDependencies: [...app.ignoreDependencies, "@capacitor/android", "@tesseract.js-data/eng", "tesseract.js", "tesseract.js-core"]
    }
  }
}
