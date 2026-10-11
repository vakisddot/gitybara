# Gitybara

A fork of GitHub Desktop (Electron, TypeScript, React), renamed Gitybara. Read
`.github/copilot-instructions.md` for the code style and conventions.

## Running the app

- Start it with the `Dev` profile of `.claude/run.json`, which runs `yarn start`.
- `yarn start` only runs an existing dev build, from `dist/Gitybara-dev-win32-x64`. If
  that folder is missing, it exits with code 1. Use the `Rebuild` profile, or run
  `node vendor/yarn-1.21.1.js build:dev` (about 3 minutes).
- Rebuild after changing the product name (`app/package.json`) or the executable name
  (`getWindowsIdentifierName()` in `script/dist-info.ts`). The dev build is named from
  these, so an old build no longer matches.
- `build:dev` deletes everything in `dist` first.
- The dev server uses port 3000. Only one copy can run, so stop the app before starting it again.

## Checking changes

- Types: `npx tsc --noEmit -p .` (about 20 seconds). For `script/`: `npx tsc --noEmit -p script/tsconfig.json`.
- Tests: `node script/test.mjs <file or folder>`. Run the tests for what you touched.
- Format: `npx prettier --write <files>`.
- Lint: `npx eslint --rulesdir ./eslint-rules <files>`. `ide-file-viewer.tsx` (3 member-ordering errors)
  and `ide-code-editor.tsx` (1 `onMouseOver` error) already fail it, so don't count those as new.

## Working in this repo

- The IDE and full-file views are in `app/src/ui/changes/ide/`, with styles in
  `app/styles/ui/changes/_ide-file-viewer.scss`.
- Other people's changes may be in the working tree. Check `git status` first, stage files by
  name (not `git add -A`), and don't revert changes you didn't make.
- Don't commit, push or rename the app unless asked.
