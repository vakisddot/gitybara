import { describe, it } from 'node:test'
import assert from 'node:assert'
import { randomBytes } from 'crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { createServer, Server, Socket } from 'net'
import { tmpdir } from 'os'
import * as Path from 'path'
import {
  formatInboxMessage,
  readInboxKey,
  SendToClaudeError,
  sendToClaudeSession,
} from '../../src/lib/claude-code/send-message'
import type { IClaudeSession } from '../../src/lib/claude-code/sessions'

const token = '0123456789abcdef0123456789abcdef'

function makeConfigDirectory(pid: number, keyFileToken: string) {
  const configDirectory = mkdtempSync(Path.join(tmpdir(), 'claude-config-'))
  const sessions = Path.join(configDirectory, 'sessions')
  mkdirSync(sessions)
  writeFileSync(
    Path.join(sessions, `${pid}.${'b'.repeat(64)}.key`),
    JSON.stringify({ peerToken: keyFileToken, pidDomain: 'test' })
  )
  return configDirectory
}

function makeSocketPath() {
  const name = `gitybara-test-${process.pid}-${randomBytes(6).toString('hex')}`
  return __WIN32__
    ? `\\\\.\\pipe\\${name}`
    : Path.join(tmpdir(), `${name}.sock`)
}

const session = (socketPath: string): IClaudeSession => ({
  sessionId: 'session-1',
  pid: 7,
  cwd: '/repos/app',
  name: 'Chat',
  status: 'idle',
  app: 'desktop',
  socketPath,
  updatedAt: 1,
  lastBranch: null,
})

function listen(server: Server, path: string) {
  return new Promise<void>(resolve => server.listen(path, () => resolve()))
}

function close(server: Server) {
  return new Promise<void>(resolve => server.close(() => resolve()))
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (e) {
    return e instanceof SendToClaudeError ? e.failure : 'unexpected error'
  }
  return 'no error'
}

describe('formatInboxMessage', () => {
  it('writes the key line and then the message line', () => {
    const lines = formatInboxMessage(token, 'session-1', 'Fix it\nplease')
      .split('\n')
      .filter(line => line !== '')
      .map(line => JSON.parse(line))

    assert.deepStrictEqual(lines, [
      { type: 'auth', token },
      {
        type: 'user',
        message: { role: 'user', content: 'Fix it\nplease' },
        session_id: 'session-1',
        from: 'gitybara',
      },
    ])
  })
})

describe('readInboxKey', () => {
  it('reads the key of the chat process', async () => {
    assert.equal(await readInboxKey(makeConfigDirectory(7, token), 7), token)
  })

  it('fails without a usable key', async () => {
    assert.equal(
      await failureOf(readInboxKey(makeConfigDirectory(7, token), 8)),
      'no-key'
    )
    assert.equal(
      await failureOf(readInboxKey(makeConfigDirectory(7, 'not a token'), 7)),
      'no-key'
    )
  })
})

describe('sendToClaudeSession', () => {
  const configDirectory = makeConfigDirectory(7, token)

  it('delivers the message to the inbox', async () => {
    const socketPath = makeSocketPath()
    const received = new Array<string>()
    const server = createServer(socket => {
      socket.setEncoding('utf8')
      socket.on('data', data => received.push(String(data)))
    })
    await listen(server, socketPath)

    try {
      await sendToClaudeSession(session(socketPath), 'Review text', {
        configDirectory,
      })
    } finally {
      await close(server)
    }

    assert.equal(
      received.join(''),
      formatInboxMessage(token, 'session-1', 'Review text')
    )
  })

  it('reports a chat that is no longer running', async () => {
    assert.equal(
      await failureOf(
        sendToClaudeSession(session(makeSocketPath()), 'Text', {
          configDirectory,
        })
      ),
      'not-running'
    )
  })

  it(
    'gives up on an inbox that never closes',
    {
      // A named pipe closes as soon as the client is done writing
      skip: __WIN32__ ? 'needs a half-open socket' : false,
    },
    async () => {
      const socketPath = makeSocketPath()
      const connections = new Array<Socket>()
      const server = createServer({ allowHalfOpen: true }, socket => {
        connections.push(socket)
      })
      await listen(server, socketPath)

      try {
        assert.equal(
          await failureOf(
            sendToClaudeSession(session(socketPath), 'Text', {
              configDirectory,
              timeoutMs: 200,
            })
          ),
          'timeout'
        )
      } finally {
        // A half-open connection keeps the server from closing
        connections.forEach(socket => socket.destroy())
        await close(server)
      }
    }
  )
})
