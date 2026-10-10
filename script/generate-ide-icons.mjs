// Generates the file and folder icons of the IDE view from Material Icon Theme
// (https://github.com/material-extensions/vscode-material-icon-theme, MIT).
//
// It copies the icons for the file types, file names and folder names listed
// below into app/static/common/ide-icons and writes how they are looked up to
// app/src/ui/changes/ide/ide-icon-data.ts.
//
// Usage: node script/generate-ide-icons.mjs <path to material-icon-theme>
// For example the folder of the VS Code extension:
//   %USERPROFILE%\.vscode\extensions\pkief.material-icon-theme-5.39.0

import { copyFile, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join, resolve } from 'path'

const extensionsWithIcons = `
cs csx csproj vbproj fsproj sln slnx props targets resx
ts tsx mts cts js jsx mjs cjs json jsonc json5
md mdx markdown txt rtf log
html htm xhtml css scss sass less styl
py pyi ipynb rs go java kt kts scala swift c h cpp cc cxx hpp hh m mm php rb lua
pl r dart zig nim ex exs erl hs clj
sh bash zsh fish ps1 psm1 psd1 bat cmd
sql db sqlite
xml xaml axaml svg xsd xsl plist
yml yaml toml ini cfg conf env properties editorconfig lock
png jpg jpeg gif webp ico bmp tga psd ai ase aseprite
mp3 wav ogg flac mp4 mov avi webm mkv
zip rar 7z tar gz tgz bz2 xz
pdf doc docx xls xlsx ppt pptx odt csv tsv
dll exe so dylib lib a o obj pdb wasm jar class nupkg msi
fx fxh hlsl glsl vert frag shader cginc compute wgsl
vue svelte astro razor cshtml
unity prefab meta asset mat anim controller scene
gd tscn tres godot tf tfvars
ttf otf woff woff2 eot
blend fbx glb gltf
`
  .split(/\s+/)
  .filter(x => x.length > 0)

const fileNamesWithIcons = `
.gitignore .gitattributes .gitmodules .gitkeep .editorconfig
.prettierrc .prettierignore .eslintrc .eslintrc.js .eslintrc.json .eslintignore
.env .env.local .npmrc .nvmrc .node-version .babelrc .dockerignore
dockerfile docker-compose.yml docker-compose.yaml makefile cmakelists.txt
license license.md license.txt readme readme.md changelog.md contributing.md
code_of_conduct.md agents.md claude.md
package.json package-lock.json yarn.lock pnpm-lock.yaml
tsconfig.json jsconfig.json webpack.config.js vite.config.ts vite.config.js
rollup.config.js babel.config.js jest.config.js
cargo.toml cargo.lock go.mod go.sum requirements.txt pyproject.toml setup.py
gemfile build.gradle pom.xml nuget.config directory.build.props
directory.build.targets global.json .gitlab-ci.yml azure-pipelines.yml
`
  .split(/\s+/)
  .filter(x => x.length > 0)

const folderNamesWithIcons = `
src source sources lib libs bin build dist out output docs doc
test tests __tests__ spec specs assets images img icons fonts media resources
res config configs conf settings scripts script tools utils util helpers
common core shared components ui views pages layouts public static templates
models controllers services api middleware routes hooks store state types
interfaces node_modules vendor packages plugins .git .github .vscode .vs .idea
.claude .husky .storybook temp tmp logs log data db database migrations content
shaders properties wwwroot docker client server app apps cli commands themes
styles css scss js ts
`
  .split(/\s+/)
  .filter(x => x.length > 0)

const themePath = process.argv[2]

if (themePath === undefined) {
  console.error(
    'Usage: node script/generate-ide-icons.mjs <material-icon-theme>'
  )
  process.exit(1)
}

const root = resolve(import.meta.dirname, '..')
const iconsOut = join(root, 'app', 'static', 'common', 'ide-icons')
const dataOut = join(
  root,
  'app',
  'src',
  'ui',
  'changes',
  'ide',
  'ide-icon-data.ts'
)

const theme = JSON.parse(
  await readFile(join(themePath, 'dist', 'material-icons.json'), 'utf8')
)

const used = new Set([theme.file, theme.folder, theme.folderExpanded])

function lookup(map, keys) {
  const result = {}
  for (const key of keys) {
    const icon = map[key.toLowerCase()]
    if (icon !== undefined) {
      result[key.toLowerCase()] = icon
      used.add(icon)
    }
  }
  return result
}

const fileExtensions = lookup(theme.fileExtensions, extensionsWithIcons)
const fileNames = lookup(theme.fileNames, fileNamesWithIcons)

const folders = {}
for (const name of folderNamesWithIcons) {
  const closed = theme.folderNames[name]
  const open = theme.folderNamesExpanded[name]
  if (closed !== undefined && open !== undefined) {
    folders[name] = [closed, open]
    used.add(closed)
    used.add(open)
  }
}

await rm(iconsOut, { recursive: true, force: true })
await mkdir(iconsOut, { recursive: true })

for (const icon of used) {
  await copyFile(
    join(themePath, 'icons', `${icon}.svg`),
    join(iconsOut, `${icon}.svg`)
  )
}

const license = await readFile(join(themePath, 'LICENSE.txt'), 'utf8')
await writeFile(
  join(iconsOut, 'LICENSE.txt'),
  'These icons are from Material Icon Theme by Material Extensions,\n' +
    'https://github.com/material-extensions/vscode-material-icon-theme\n\n' +
    license
)

const sorted = obj =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))
    ),
    null,
    2
  )

await writeFile(
  dataOut,
  `// This file is generated by script/generate-ide-icons.mjs, don't edit it.
// The icons are from Material Icon Theme (MIT), see
// app/static/common/ide-icons/LICENSE.txt

/** The icon of a file when none is specific to its name or extension. */
export const defaultFileIcon = ${JSON.stringify(theme.file)}

/** The icons of a folder when none is specific to its name. */
export const defaultFolderIcons: readonly [closed: string, open: string] = [
  ${JSON.stringify(theme.folder)},
  ${JSON.stringify(theme.folderExpanded)},
]

/** Icons by lower case file extension, without the dot. */
export const fileExtensionIcons: { readonly [extension: string]: string } = ${sorted(
    fileExtensions
  )}

/** Icons by lower case file name. */
export const fileNameIcons: { readonly [name: string]: string } = ${sorted(
    fileNames
  )}

/** The closed and open icons by lower case folder name. */
export const folderNameIcons: {
  readonly [name: string]: readonly [closed: string, open: string]
} = ${sorted(folders)}
`
)

console.log(`Copied ${used.size} icons`)
