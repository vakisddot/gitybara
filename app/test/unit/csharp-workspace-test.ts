import assert from 'node:assert/strict'
import { before, beforeEach, describe, it, mock } from 'node:test'
import { EventEmitter } from 'events'
import { resolve } from 'path'
import { ICSharpClient } from '../../src/lib/csharp/client'
import {
  ICSharpDocument,
  ICSharpHighlightResult,
  ICSharpNavigationResult,
  ICSharpPosition,
  ICSharpRange,
} from '../../src/lib/csharp/types'

interface ITestWindow extends EventEmitter {
  readonly id: number
  isDestroyed: () => boolean
}
interface ITestEvent {
  readonly sender: ITestWindow
}
type IHighlightHandler = (
  event: ITestEvent,
  document: ICSharpDocument,
  range: ICSharpRange
) => Promise<ICSharpHighlightResult>
type INavigateHandler = (
  event: ITestEvent,
  document: ICSharpDocument,
  position: ICSharpPosition,
  references: boolean
) => Promise<ICSharpNavigationResult>
type IUpdateHandler = (event: ITestEvent, document: ICSharpDocument) => void
type ICloseHandler = (event: ITestEvent, repositoryPath: string) => void

let highlight: IHighlightHandler
let navigate: INavigateHandler
let update: IUpdateHandler
let close: ICloseHandler
let installHandlers: () => void
let install: () => Promise<string> = async () => 'server.dll'
let client: ICSharpClient
const ensure = mock.fn(() => install())
const start = mock.fn(
  async (
    _root: string,
    _server: string,
    _refresh: () => void,
    _exit: () => void
  ) => client
)
const appEvents = new EventEmitter()

before(async () => {
  mock.restoreAll()
  mock.module('electron', {
    namedExports: {
      app: {
        getPath: () => resolve('cache'),
        once: appEvents.once.bind(appEvents),
      },
    },
  })
  mock.module('../../src/main-process/ipc-main.ts', {
    namedExports: {
      handle: (
        channel: string,
        handler: IHighlightHandler & INavigateHandler
      ) => {
        if (channel === 'csharp-highlight') {
          highlight = handler
        }
        if (channel === 'csharp-navigate') {
          navigate = handler
        }
      },
      on: (channel: string, handler: IUpdateHandler & ICloseHandler) => {
        if (channel === 'csharp-update') {
          update = handler
        }
        if (channel === 'csharp-close') {
          close = handler
        }
      },
    },
  })
  mock.module('../../src/main-process/ipc-webcontents.ts', {
    namedExports: { send: mock.fn() },
  })
  mock.module('../../src/lib/csharp/runtime.ts', {
    namedExports: { ensureRoslynRuntime: ensure },
  })
  mock.module('../../src/lib/csharp/client.ts', {
    namedExports: { startCSharpClient: start },
  })
  installHandlers = (await import('../../src/main-process/csharp'))
    .installCSharpHandlers
})

beforeEach(() => {
  appEvents.removeAllListeners()
  ensure.mock.resetCalls()
  start.mock.resetCalls()
  install = async () => 'server.dll'
  client = {
    synchronize: mock.fn(async () => 'file:///Cloud.cs'),
    highlight: mock.fn(async () => []),
    navigate: mock.fn(async () => []),
    dispose: mock.fn(),
  }
  installHandlers()
})

const document: ICSharpDocument = {
  repositoryPath: resolve('source'),
  path: 'Cloud.cs',
  text: 'class Cloud {}',
}
const range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 14 },
}
const event = () => ({
  sender: Object.assign(new EventEmitter(), {
    id: 1,
    isDestroyed: () => false,
  }),
})
const tick = () => new Promise<void>(done => setImmediate(done))

describe('C# workspace lifecycle', () => {
  it('shares a server across files and releases it when the viewer closes', async () => {
    const source = event()
    await highlight(source, document, range)
    await navigate(source, { ...document, path: 'Base.cs' }, range.start, false)
    assert.equal(ensure.mock.callCount(), 1)
    assert.equal(start.mock.callCount(), 1)
    const dispose = mock.method(client, 'dispose')
    close(source, document.repositoryPath)
    await tick()
    assert.equal(dispose.mock.callCount(), 1)
  })

  it('does not launch a server if the viewer closes during installation', async () => {
    let complete = (_server: string) => {}
    install = () =>
      new Promise(resolve => {
        complete = resolve
      })
    const source = event()
    const pending = highlight(source, document, range)
    close(source, document.repositoryPath)
    complete('server.dll')
    assert.match((await pending).error ?? '', /closed/)
    assert.equal(start.mock.callCount(), 0)
  })

  it('uses the latest unsaved document when installation completes', async () => {
    let complete = (_server: string) => {}
    install = () =>
      new Promise(resolve => {
        complete = resolve
      })
    const source = event()
    const pending = highlight(source, document, range)
    const draft = { ...document, text: 'class Rain {}' }
    const analyze = mock.method(client, 'highlight', async () => [])
    update(source, draft)
    complete('server.dll')
    await pending
    assert.deepEqual(analyze.mock.calls[0].arguments[0], draft)
    close(source, document.repositoryPath)
    update(source, document)
    await tick()
    assert.equal(start.mock.callCount(), 1)
  })

  it('allows an explicit retry after installation fails', async () => {
    const source = event()
    install = async () => {
      throw new Error('Offline')
    }
    assert.equal((await highlight(source, document, range)).error, 'Offline')
    install = async () => 'server.dll'
    assert.equal((await highlight(source, document, range)).error, null)
    assert.equal(ensure.mock.callCount(), 2)
    source.sender.emit('destroyed')
    await tick()
  })

  it('closes the owned server when its window is destroyed', async () => {
    const source = event()
    await highlight(source, document, range)
    const dispose = mock.method(client, 'dispose')
    source.sender.emit('destroyed')
    await tick()
    assert.equal(dispose.mock.callCount(), 1)
  })
})
