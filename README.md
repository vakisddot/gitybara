<h1 align="center">Gitybara</h1>

<p align="center">
  <img src="app/static/logos/gitybara.svg" width="144" height="144" alt="Gitybara capybara logo" />
</p>

<p align="center">
  <strong>Review changes. Browse files. Edit code.</strong><br />
  All in one Git app.
</p>

<p align="center">
  <a href="#what-gitybara-adds">Features</a> &middot;
  <a href="#run-it-locally">Run locally</a> &middot;
  <a href="#work-on-gitybara">Contribute</a> &middot;
  <a href="#credits-and-license">License</a>
</p>

---

Gitybara is a version of [GitHub Desktop](https://github.com/desktop/desktop)
with a built-in code editor, a file browser, and more ways to review changes. It
keeps the familiar tools for commits, branches, and pull requests.

## What Gitybara adds

| Feature              | What you can do                                                                         |
| -------------------- | --------------------------------------------------------------------------------------- |
| **Files tab**        | Browse your repository by folder. Filter the file list to find what you need.           |
| **Code editing**     | Edit and save text files inside the app. Hide blocks of code to focus on what you need. |
| **Full-file review** | See changes in the whole file. Show the old lines and jump between changes.             |
| **Text search**      | Find text in the open file and move between matches.                                    |
| **Clearer previews** | Preview SVG images and browse changed files in a folder tree, including in History.     |
| **Catppuccin Mocha** | Choose a dark theme with soft colors in the appearance settings.                        |

## Run it locally

Use the Node.js version in [`.nvmrc`](.nvmrc). Yarn is included in this
repository. On Windows, you also need Git, Python 3, and the Visual C++ Build
Tools. See the [setup guides](docs/contributing/setup.md) for more help with
your system. Those guides come from GitHub Desktop and still use its name.

Clone this repository, open a terminal in its folder, and run:

```sh
node vendor/yarn-1.21.1.js install
node vendor/yarn-1.21.1.js build:dev
node vendor/yarn-1.21.1.js start
```

Build once before starting the app. After that, use the last command to start
it. On Windows x64, the build is in `dist/Gitybara-dev-win32-x64`.

> **Build notes:** `build:dev` clears the `dist` folder before building. The dev
> server uses port 3000 by default. Stop it before starting another copy.

## Work on Gitybara

The app uses TypeScript, React, and Electron.

| Folder                                               | What is there                |
| ---------------------------------------------------- | ---------------------------- |
| [`app/src/`](app/src/)                               | App code                     |
| [`app/src/ui/changes/ide/`](app/src/ui/changes/ide/) | File browser and code editor |
| [`app/styles/`](app/styles/)                         | Styles and themes            |
| [`app/test/`](app/test/)                             | App tests                    |
| [`script/`](script/)                                 | Build and test tools         |

Read the [code guide](.github/copilot-instructions.md) before making changes.
Check types with:

```sh
npx tsc --noEmit -p .
```

Run tests for the file or folder you changed:

```sh
node script/test.mjs <file-or-folder>
```

For build script changes, also run `npx tsc --noEmit -p script/tsconfig.json`.

## Credits and license

Built on the work of the
[GitHub Desktop contributors](https://github.com/desktop/desktop). Gitybara is a
separate project, not an official GitHub app.

The code is under the [MIT license](LICENSE). GitHub's names and logos remain
GitHub's trademarks and are not covered by that license.
