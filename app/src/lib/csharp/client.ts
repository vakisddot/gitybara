import { ChildProcessWithoutNullStreams, execFile, spawn } from 'child_process'
import { watch } from 'fs'
import { readFile, stat } from 'fs/promises'
import { basename, join } from 'path'
import { pathToFileURL } from 'url'
import {
  CancellationTokenSource,
  createMessageConnection,
  MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node'
import { decodeCSharpTokens } from './semantic-tokens'
import {
  getCSharpDocumentPath,
  getCSharpLocations,
  ICSharpProtocolLocation,
  isCSharpPosition,
} from './locations'
import {
  ICSharpDocument,
  ICSharpLocation,
  ICSharpPosition,
  ICSharpRange,
  ICSharpToken,
} from './types'

interface IInitializeResult {
  readonly capabilities: {
    readonly semanticTokensProvider?: {
      readonly legend: { readonly tokenTypes: ReadonlyArray<string> }
      readonly range?: boolean
    }
  }
}

/** One Roslyn workspace, shared across the current repository's open files. */
export interface ICSharpClient {
  synchronize: (document: ICSharpDocument) => Promise<string>
  highlight: (
    document: ICSharpDocument,
    range: ICSharpRange
  ) => Promise<ReadonlyArray<ICSharpToken>>
  navigate: (
    document: ICSharpDocument,
    position: ICSharpPosition,
    references: boolean
  ) => Promise<ReadonlyArray<ICSharpLocation>>
  dispose: () => void
}

/** Cancel timed-out LSP requests so abandoned work does not keep accumulating. */
async function request<R>(
  connection: MessageConnection,
  method: string,
  params: unknown,
  timeout = 30000
): Promise<R> {
  const cancellation = new CancellationTokenSource()
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      connection.sendRequest<R>(method, params, cancellation.token),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          cancellation.cancel()
          reject(new Error('C# support is taking too long. Try again.'))
        }, timeout)
      }),
    ])
  } finally {
    clearTimeout(timer)
    cancellation.dispose()
  }
}

function stopProcess(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.pid === undefined) {
    return
  }
  // Roslyn owns build-host children too; stop only this server's process tree.
  if (process.platform === 'win32') {
    execFile(
      'taskkill',
      ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true },
      () => {}
    )
  } else {
    child.stdin.end()
    child.kill()
  }
}

/** Start the managed Roslyn runtime and initialize the C# workspace over stdio. */
export async function startCSharpClient(
  repositoryPath: string,
  serverPath: string,
  onRefresh: () => void,
  onExit: () => void
): Promise<ICSharpClient> {
  const child = spawn(
    'dotnet',
    [serverPath, '--stdio', '--autoLoadProjects', '--telemetryLevel', 'off'],
    {
      cwd: repositoryPath,
      windowsHide: true,
      env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1' },
    }
  )
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })

  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin)
  )
  let disposed = false
  let stderr = ''
  child.stderr.on('data', (data: Buffer) => {
    stderr = (stderr + data.toString()).slice(-2000)
  })
  child.once('exit', () => {
    connection.dispose()
    if (!disposed) {
      log.warn(`Roslyn exited unexpectedly. ${stderr}`)
      onExit()
    }
  })
  const folder = {
    uri: pathToFileURL(repositoryPath).href,
    name: basename(repositoryPath),
  }
  connection.onRequest(
    'workspace/configuration',
    (params: { items: ReadonlyArray<unknown> }) => params.items.map(() => null)
  )
  connection.onRequest('workspace/workspaceFolders', () => [folder])
  connection.onRequest('client/registerCapability', () => null)
  connection.onRequest('window/workDoneProgress/create', () => null)
  connection.onRequest('workspace/semanticTokens/refresh', () => {
    onRefresh()
    return null
  })
  connection.listen()

  try {
    const initialized = await request<IInitializeResult>(
      connection,
      'initialize',
      {
        processId: process.pid,
        rootUri: folder.uri,
        clientInfo: { name: 'Gitybara', version: __APP_VERSION__ },
        workspaceFolders: [folder],
        initializationOptions: { autoLoadProjects: 500 },
        capabilities: {
          workspace: {
            configuration: true,
            workspaceFolders: true,
            didChangeWatchedFiles: { dynamicRegistration: true },
            semanticTokens: { refreshSupport: true },
          },
          textDocument: {
            definition: { linkSupport: true },
            semanticTokens: {
              requests: { range: true, full: false },
              tokenTypes: [
                'namespace',
                'type',
                'class',
                'enum',
                'interface',
                'struct',
                'typeParameter',
                'parameter',
                'variable',
                'property',
                'enumMember',
                'event',
                'function',
                'method',
                'keyword',
                'modifier',
                'comment',
                'string',
                'number',
                'operator',
                'decorator',
              ],
              tokenModifiers: [],
              formats: ['relative'],
              overlappingTokenSupport: false,
              multilineTokenSupport: false,
            },
          },
        },
      },
      60000
    )
    await connection.sendNotification('initialized', {})
    const provider = initialized.capabilities.semanticTokensProvider
    const documents = new Map<
      string,
      { text: string; version: number; isDirty: boolean }
    >()

    const synchronize = async (document: ICSharpDocument) => {
      const uri = pathToFileURL(
        getCSharpDocumentPath(repositoryPath, document.path)
      ).href
      const previous = documents.get(uri)
      const version =
        previous === undefined
          ? 1
          : previous.version + (previous.text !== document.text ? 1 : 0)
      documents.set(uri, {
        text: document.text,
        version,
        isDirty: document.isDirty === true,
      })
      if (previous === undefined) {
        await connection.sendNotification('textDocument/didOpen', {
          textDocument: {
            uri,
            languageId: 'csharp',
            version,
            text: document.text,
          },
        })
      } else if (previous.text !== document.text) {
        await connection.sendNotification('textDocument/didChange', {
          textDocument: { uri, version },
          contentChanges: [{ text: document.text }],
        })
      }
      return uri
    }

    const watcher = watch(
      repositoryPath,
      { recursive: true },
      (event, filename) => {
        if (
          filename === null ||
          /(^|[\\/])(\.git|node_modules|bin|obj)([\\/]|$)/.test(filename) ||
          !/\.(cs|csproj|sln|slnx|props|targets)$|(^|[\\/])global\.json$/i.test(
            filename
          )
        ) {
          return
        }
        const path = join(repositoryPath, filename)
        const notify = async () => {
          if (disposed) {
            return
          }
          const exists = await stat(path).then(
            () => true,
            () => false
          )
          const uri = pathToFileURL(path).href
          const opened = documents.get(uri)
          if (opened !== undefined && !opened.isDirty) {
            if (!exists) {
              documents.delete(uri)
              await connection.sendNotification('textDocument/didClose', {
                textDocument: { uri },
              })
            } else {
              const text = await readFile(path, 'utf8')
              // A user edit may have arrived while the disk was being read.
              if (documents.get(uri) === opened && !disposed) {
                await synchronize({
                  repositoryPath,
                  path: filename,
                  text: text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'),
                  isDirty: false,
                })
              }
            }
          }
          if (disposed) {
            return
          }
          await connection.sendNotification('workspace/didChangeWatchedFiles', {
            changes: [
              {
                uri,
                type: event === 'change' ? 2 : exists ? 1 : 3,
              },
            ],
          })
          onRefresh()
        }
        notify().catch(error => log.warn(`C# file watch: ${error}`))
      }
    )
    watcher.on('error', error => log.warn(`C# file watch: ${error.message}`))

    return {
      synchronize,
      highlight: async (document, range) => {
        const uri = await synchronize(document)
        if (provider?.range !== true) {
          return []
        }
        const result = await request<{ data: ReadonlyArray<number> } | null>(
          connection,
          'textDocument/semanticTokens/range',
          { textDocument: { uri }, range }
        )
        return decodeCSharpTokens(
          result?.data ?? [],
          provider.legend.tokenTypes
        )
      },
      navigate: async (document, position, references) => {
        if (!isCSharpPosition(position)) {
          return []
        }
        const uri = await synchronize(document)
        const result = await request<
          | ICSharpProtocolLocation
          | ReadonlyArray<ICSharpProtocolLocation>
          | null
        >(
          connection,
          references ? 'textDocument/references' : 'textDocument/definition',
          {
            textDocument: { uri },
            position,
            ...(references ? { context: { includeDeclaration: false } } : {}),
          }
        )
        const locations =
          result === null ? [] : isLocationArray(result) ? result : [result]
        return getCSharpLocations(repositoryPath, locations)
      },
      dispose: () => {
        disposed = true
        watcher.close()
        connection.dispose()
        stopProcess(child)
      },
    }
  } catch (error) {
    disposed = true
    connection.dispose()
    stopProcess(child)
    throw error
  }
}

function isLocationArray(
  result: ICSharpProtocolLocation | ReadonlyArray<ICSharpProtocolLocation>
): result is ReadonlyArray<ICSharpProtocolLocation> {
  return Array.isArray(result)
}
