# Gitybara

A fork of GitHub Desktop (Electron, TypeScript, React), renamed Gitybara. Read
`.github/copilot-instructions.md` for the code style and conventions.

## Running the app

- Start it with the `Dev` profile, which runs `yarn start`. The profiles are in
  `.gitybara/run.json` (read by Gitybara's Run button) and `.claude/run.json` (read by a Claude
  Code runner). Keep the two files the same.
- `yarn start` only runs an existing dev build, from `dist/Gitybara-dev-win32-x64`. If
  that folder is missing, it exits with code 1. Use the `Rebuild` profile, or run
  `node vendor/yarn-1.21.1.js build:dev` (about 3 minutes).
- Rebuild after changing the product name (`app/package.json`) or the executable name
  (`getWindowsIdentifierName()` in `script/dist-info.ts`). The dev build is named from
  these, so an old build no longer matches.
- `build:dev` deletes everything in `dist` first. `build:prod` and `package` do too, which removes
  the dev build. After either, `yarn start` exits with code 1 ("Couldn't launch the app") until
  you run the `Rebuild` profile again.
- The dev server uses port 3000. Only one copy can run, so stop the app before starting it again.

## Checking changes

- Types: `npx tsc --noEmit -p .` (about 20 seconds). For `script/`: `npx tsc --noEmit -p script/tsconfig.json`.
- Tests: `node script/test.mjs <file or folder>`. Run the tests for what you touched.
- Format: `npx prettier --write <files>`.
- Lint: `npx eslint --rulesdir ./eslint-rules <files>`.
- Before pushing, run `yarn lint` (Prettier and ESLint over the whole repo). CI runs the same
  check and fails on any error.

## Releasing

- Change the version only when asked, to the version you were given. If none was given, ask.
  It is in `app/package.json`. Commit it on its own as "Set the app version to X.Y.Z" and push.
- Tag that commit `vX.Y.Z` and push the tag. `.github/workflows/release.yml` checks that the tag
  matches the version, builds the Windows installer and creates a draft release.
- When the run finishes, check the draft and publish it (`gh release edit vX.Y.Z --draft=false`).
  Installed apps update from the latest published release, so a draft reaches no one.

## Working in this repo

- The IDE view and the Gitybara diff display (once called Full file) are in
  `app/src/ui/changes/ide/`, with styles in `app/styles/ui/changes/_ide-file-viewer.scss`.
- Other people's changes may be in the working tree. Check `git status` first, stage files by
  name (not `git add -A`), and don't revert changes you didn't make.
- Don't commit, push or rename the app unless asked.
- The repo is public. Everything pushed (code, comments, commit messages, PR text, release
  notes) can be read by anyone. Don't include anything that isn't about Gitybara itself, such as
  names or paths from other projects or details of the machine you work on, without asking first.
