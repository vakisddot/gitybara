import { app, WebContents } from 'electron'
import { isAbsolute } from 'path'
import { ICSharpClient, startCSharpClient } from '../lib/csharp/client'
import {
  getCSharpDocumentPath,
  isCSharpPosition,
} from '../lib/csharp/locations'
import { ensureRoslynRuntime } from '../lib/csharp/runtime'
import { ICSharpDocument } from '../lib/csharp/types'
import * as ipcMain from './ipc-main'
import { send } from './ipc-webcontents'

interface IWorkspace {
  readonly client: Promise<ICSharpClient>
  readonly documents: Map<string, ICSharpDocument>
  closed: boolean
}

/** Roslyn is owned by the viewer's window, and released when that viewer closes. */
export function installCSharpHandlers() {
  const windows = new Map<number, Map<string, IWorkspace>>()

  const close = (workspace: IWorkspace) => {
    workspace.closed = true
    workspace.client.then(
      client => client.dispose(),
      () => {}
    )
  }

  const getWorkspace = (sender: WebContents, document: ICSharpDocument) => {
    if (!isAbsolute(document.repositoryPath)) {
      throw new Error('C# support requires an absolute repository path.')
    }
    getCSharpDocumentPath(document.repositoryPath, document.path)
    let workspaces = windows.get(sender.id)
    if (workspaces === undefined) {
      workspaces = new Map()
      windows.set(sender.id, workspaces)
      sender.once('destroyed', () => {
        windows.get(sender.id)?.forEach(close)
        windows.delete(sender.id)
      })
    }

    const existing = workspaces.get(document.repositoryPath)
    if (existing !== undefined) {
      existing.documents.set(document.path, document)
      return existing
    }

    const refresh = () => {
      if (!workspace.closed && !sender.isDestroyed()) {
        send(sender, 'csharp-refresh', document.repositoryPath)
      }
    }
    const workspace: IWorkspace = {
      closed: false,
      documents: new Map([[document.path, document]]),
      client: ensureRoslynRuntime(app.getPath('userData'))
        .then(server => {
          if (workspace.closed) {
            throw new Error('The C# workspace was closed.')
          }
          return startCSharpClient(
            document.repositoryPath,
            server,
            refresh,
            () => {
              close(workspace)
              if (
                windows.get(sender.id)?.get(document.repositoryPath) ===
                workspace
              ) {
                windows.get(sender.id)?.delete(document.repositoryPath)
                if (!sender.isDestroyed()) {
                  send(sender, 'csharp-refresh', document.repositoryPath)
                }
              }
            }
          )
        })
        .then(client => {
          if (workspace.closed) {
            client.dispose()
            throw new Error('The C# workspace was closed.')
          }
          return client
        }),
    }
    workspaces.set(document.repositoryPath, workspace)
    // Setup failures can be retried by the user, without caching a rejected client.
    workspace.client.catch(() => {
      if (windows.get(sender.id)?.get(document.repositoryPath) === workspace) {
        windows.get(sender.id)?.delete(document.repositoryPath)
      }
    })
    return workspace
  }

  ipcMain.handle('csharp-highlight', async (event, document, range) => {
    try {
      if (!isCSharpPosition(range.start) || !isCSharpPosition(range.end)) {
        throw new Error('Invalid C# highlighting range.')
      }
      const workspace = getWorkspace(event.sender, document)
      const client = await workspace.client
      const tokens = await client.highlight(
        workspace.documents.get(document.path) ?? document,
        range
      )
      return { tokens, error: null }
    } catch (error) {
      return { tokens: [], error: errorMessage(error) }
    }
  })

  ipcMain.handle(
    'csharp-navigate',
    async (event, document, position, references) => {
      try {
        const workspace = getWorkspace(event.sender, document)
        const client = await workspace.client
        const locations = await client.navigate(
          workspace.documents.get(document.path) ?? document,
          position,
          references
        )
        return { locations, error: null }
      } catch (error) {
        return { locations: [], error: errorMessage(error) }
      }
    }
  )

  ipcMain.on('csharp-update', (event, document) => {
    const workspace = windows.get(event.sender.id)?.get(document.repositoryPath)
    if (workspace === undefined || workspace.closed) {
      return
    }
    workspace.documents.set(document.path, document)
    workspace.client
      .then(client => {
        if (!workspace.closed) {
          return client.synchronize(
            workspace.documents.get(document.path) ?? document
          )
        }
        return undefined
      })
      .catch(error => log.warn(`C# document update: ${errorMessage(error)}`))
  })

  ipcMain.on('csharp-close', (event, repositoryPath) => {
    const workspaces = windows.get(event.sender.id)
    const workspace = workspaces?.get(repositoryPath)
    if (workspace !== undefined) {
      close(workspace)
      workspaces?.delete(repositoryPath)
    }
  })

  app.once('will-quit', () => {
    windows.forEach(workspaces => workspaces.forEach(close))
    windows.clear()
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
