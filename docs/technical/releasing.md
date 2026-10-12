# Releasing Gitybara

Releases are built by [`.github/workflows/release.yml`](../../.github/workflows/release.yml).
For now they are Windows x64 only and unsigned, so Windows SmartScreen shows an
"unknown publisher" warning when the installer is run.

## One-time setup

1. Register an OAuth app on GitHub (Settings > Developer settings > OAuth Apps)
   named Gitybara, with the capybara logo and this callback URL:
   `x-gitybara-auth://oauth`.
2. Add its client ID and a client secret to the repository as Actions secrets
   named `DESKTOP_OAUTH_CLIENT_ID` and `DESKTOP_OAUTH_CLIENT_SECRET`.
   See [oauth.md](oauth.md). Without them, the build falls back to GitHub
   Desktop's shared development OAuth app, which shows GitHub Desktop's name on
   the sign-in page.

## Making a release

1. Set `version` in [`app/package.json`](../../app/package.json) and commit it.
2. Tag the commit and push the tag. The tag must be `v` plus the version.

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. The workflow builds the installer and creates a **draft** release with
   `GitybaraSetup-x64.exe`, `GitybaraSetup-x64.msi`, the `.nupkg` and `RELEASES`
   attached. Review it on the Releases page, then publish it. A version with a
   suffix, like `0.1.0-beta1`, is marked as a pre-release.

Publishing is what ships the update. See [Auto-update](#auto-update).

To try the build without releasing, run the workflow by hand from the Actions
tab. It uploads the installers as a workflow artifact only.

To build locally, run `build:prod` and then `package`. The installer lands in
`dist/`. Both delete what is already in `dist/`, including the dev build, so
run the `Rebuild` profile again afterwards before `yarn start`.

## Auto-update

The app uses the Squirrel.Windows updater from GitHub Desktop. The release
workflow builds it with `DESKTOP_UPDATES_URL` set to
`https://github.com/<repo>/releases/latest/download`, so the app asks GitHub for
the `RELEASES` file of the latest published release and downloads the `.nupkg`
it lists. The app checks in the background, shows an "update available" banner,
and has "Check for updates" in the About dialog.

- **Only published releases count.** Drafts are invisible to `latest/download`.
  So are pre-releases, which is any version with a suffix like `-beta1`.
- **Keep the file names.** `RELEASES` lists the `.nupkg` by the name Squirrel
  gave it, so `script/package.ts` must not rename it.
- **No deltas.** Every update downloads the full package, about 260 MB. Deltas
  need `DESKTOP_UPDATES_URL` set when packaging too, and a published release to
  build them from.
- **A build without the URL never updates.** Local builds don't set it, so they
  don't check for updates. The `0.1.0` and `0.1.1` releases were built without
  it, so install a newer one by hand once.
- **Testing it needs two published releases.** Install the older one, publish
  the newer one, then use "Check for updates" in About.

## What is switched off

Gitybara has no servers of its own yet, so these are off rather than pointing at
GitHub Desktop's:

- **Usage stats.** `isUsageReportingEnabled` in
  [`stats-store.ts`](../../app/src/lib/stats/stats-store.ts) is `false`, and the
  checkbox in Preferences is hidden.
- **Release notes.** `changelogEndpoint` in
  [`release-notes.ts`](../../app/src/lib/release-notes.ts) is unset, so the
  "What's new" notes stay empty.
- **GitHub Desktop's links.** Gitybara only registers its own OAuth callback.
  It doesn't take over `x-github-client` ("Open with GitHub Desktop") links, so
  GitHub Desktop keeps handling them if it is installed.
