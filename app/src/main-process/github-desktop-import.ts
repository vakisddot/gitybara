import { app, BrowserWindow, session } from 'electron'
import { cp, mkdtemp, readdir, rm, stat, writeFile } from 'fs/promises'
import * as Path from 'path'
import { pathToFileURL } from 'url'
import { IGitHubDesktopRepository } from '../lib/github-desktop-import'
import * as ipcMain from './ipc-main'

/** Where GitHub Desktop keeps its data, next to ours in the app data folder. */
const sourceProfileName = 'GitHub Desktop'

/** The IndexedDB database GitHub Desktop keeps its repositories in. */
const databaseName = 'Database'

/** Pages loaded from `file://` all share this IndexedDB folder. */
const indexedDBFolder = Path.join('IndexedDB', 'file__0.indexeddb.leveldb')

const tempPrefix = 'gitybara-import-'

const readerPageName = 'reader.html'

/** Reads the repositories out of the database, without ever creating it. */
const readRepositoriesScript = `
new Promise((resolve, reject) => {
  const open = indexedDB.open(${JSON.stringify(databaseName)})
  let created = false
  open.onupgradeneeded = () => {
    created = true
    open.transaction.abort()
  }
  open.onerror = () => (created ? resolve([]) : reject(open.error))
  open.onsuccess = () => {
    const db = open.result
    if (!db.objectStoreNames.contains('repositories')) {
      db.close()
      resolve([])
      return
    }
    const request = db
      .transaction('repositories', 'readonly')
      .objectStore('repositories')
      .getAll()
    request.onerror = () => {
      db.close()
      reject(request.error)
    }
    request.onsuccess = () => {
      db.close()
      resolve(
        request.result.map(r => ({
          path: r.path,
          alias: r.alias ?? null,
          isTutorial: r.isTutorialRepository === true,
        }))
      )
    }
  }
})
`

interface IStoredRepository extends IGitHubDesktopRepository {
  readonly isTutorial: boolean
}

async function exists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Remove folders left behind by earlier imports, which can't always be deleted. */
async function removeStaleTempFolders() {
  const temp = app.getPath('temp')
  const names = await readdir(temp).catch(() => [])
  await Promise.all(
    names
      .filter(name => name.startsWith(tempPrefix))
      .map(name =>
        rm(Path.join(temp, name), { recursive: true, force: true }).catch(
          () => {}
        )
      )
  )
}

/**
 * Read the repositories from GitHub Desktop's database.
 *
 * GitHub Desktop keeps its database open while it runs, so this opens a copy of
 * it, in a hidden window with a profile of its own, and leaves the original
 * alone.
 */
async function readGitHubDesktopRepositories(): Promise<
  ReadonlyArray<IGitHubDesktopRepository>
> {
  const source = Path.join(
    app.getPath('appData'),
    sourceProfileName,
    indexedDBFolder
  )

  if (!(await exists(source))) {
    throw new Error(
      'GitHub Desktop has no data on this computer, so there is nothing to import.'
    )
  }

  await removeStaleTempFolders()
  const profile = await mkdtemp(Path.join(app.getPath('temp'), tempPrefix))

  try {
    // The lock file is held by GitHub Desktop while it is running.
    await cp(source, Path.join(profile, indexedDBFolder), {
      recursive: true,
      filter: path => Path.basename(path) !== 'LOCK',
    }).catch(() => {
      throw new Error(
        'Could not read the data from GitHub Desktop. Close it and try again.'
      )
    })

    const readerPage = Path.join(profile, readerPageName)
    await writeFile(readerPage, '<!doctype html><meta charset="utf-8">')

    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        session: session.fromPath(profile),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    try {
      await window.loadURL(pathToFileURL(readerPage).toString())
      const stored: ReadonlyArray<IStoredRepository> =
        await window.webContents.executeJavaScript(readRepositoriesScript)

      return stored
        .filter(r => !r.isTutorial && typeof r.path === 'string')
        .map(r => ({ path: r.path, alias: r.alias }))
    } catch (e) {
      log.error('Could not read the repositories from GitHub Desktop', e)
      throw new Error('Could not read the repositories from GitHub Desktop.')
    } finally {
      window.destroy()
    }
  } finally {
    // The profile can stay locked until the app exits. It is removed on the
    // next import instead if so.
    await rm(profile, { recursive: true, force: true }).catch(() => {})
  }
}

export function installGitHubDesktopImportHandler() {
  ipcMain.handle('read-github-desktop-repositories', () =>
    readGitHubDesktopRepositories()
  )
}
