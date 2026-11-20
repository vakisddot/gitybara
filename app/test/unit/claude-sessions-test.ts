import { describe, it } from 'node:test'
import assert from 'node:assert'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import * as Path from 'path'
import {
  describeSession,
  findClaudeSessions,
  findLastBranch,
  getTranscriptPath,
  IClaudeSession,
  isInFolder,
  parseSessionFile,
  pickDefaultSession,
} from '../../src/lib/claude-code/sessions'

const sessionJson = (fields: Record<string, unknown>) =>
  JSON.stringify({
    sessionId: 'session-1',
    cwd: Path.resolve('/repos/app'),
    messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-1',
    entrypoint: 'claude-desktop',
    name: 'Add the login page',
    status: 'idle',
    updatedAt: 200,
    ...fields,
  })

const session = (fields: Partial<IClaudeSession>): IClaudeSession => ({
  sessionId: 'session-1',
  pid: 1,
  cwd: '/repos/app',
  name: 'Chat',
  status: 'idle',
  app: 'desktop',
  socketPath: 'pipe',
  updatedAt: 1,
  lastBranch: null,
  ...fields,
})

describe('parseSessionFile', () => {
  it('reads a chat that has an inbox', () => {
    assert.deepStrictEqual(
      parseSessionFile(sessionJson({ name: '  Add the login page ' }), 42),
      {
        sessionId: 'session-1',
        pid: 42,
        cwd: Path.resolve('/repos/app'),
        name: 'Add the login page',
        status: 'idle',
        app: 'desktop',
        socketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-1',
        updatedAt: 200,
      }
    )
  })

  it('tells terminal chats apart and falls back to the start time', () => {
    const entry = parseSessionFile(
      sessionJson({
        entrypoint: 'cli',
        name: undefined,
        updatedAt: undefined,
        startedAt: 100,
      }),
      1
    )

    assert.equal(entry?.app, 'terminal')
    assert.equal(entry?.name, null)
    assert.equal(entry?.updatedAt, 100)
  })

  it('skips chats without an inbox and files that are not JSON', () => {
    assert.equal(
      parseSessionFile(sessionJson({ messagingSocketPath: undefined }), 1),
      null
    )
    assert.equal(parseSessionFile('{', 1), null)
    assert.equal(parseSessionFile('[]', 1), null)
  })
})

describe('isInFolder', () => {
  it('matches the folder and the folders inside it', () => {
    assert.ok(isInFolder('/repos/app', '/repos/app/', false))
    assert.ok(isInFolder('/repos/app/src', '/repos/app', false))
    assert.ok(!isInFolder('/repos/app-other', '/repos/app', false))
    assert.ok(!isInFolder('/repos', '/repos/app', false))
  })

  it('ignores case when asked to', () => {
    assert.ok(isInFolder('/Repos/App', '/repos/app', true))
    assert.ok(!isInFolder('/Repos/App', '/repos/app', false))
  })
})

describe('findLastBranch', () => {
  it('finds the branch of the last message', () => {
    const transcript = [
      '{"type":"user","gitBranch":"main"}',
      '{"type":"assistant","gitBranch":"feature/\\"quoted\\""}',
      '{"type":"system"}',
    ].join('\n')

    assert.equal(findLastBranch(transcript), 'feature/"quoted"')
    assert.equal(findLastBranch('{"type":"user","gitBranch":""}'), null)
    assert.equal(findLastBranch('no branches here'), null)
  })
})

describe('findClaudeSessions', () => {
  const configDirectory = mkdtempSync(Path.join(tmpdir(), 'claude-config-'))
  const sessions = Path.join(configDirectory, 'sessions')
  mkdirSync(sessions)

  const repository = Path.resolve('/repos/app')
  const worktree = Path.resolve('/repos/app-worktree')

  const file = (name: string, text: string) =>
    writeFileSync(Path.join(sessions, name), text)

  file('11.json', sessionJson({ sessionId: 'older', updatedAt: 100 }))
  file('11.' + 'a'.repeat(64) + '.key', '{"peerToken":"x"}')
  file('12.json', sessionJson({ sessionId: 'newer', updatedAt: 300 }))
  file('13.json', sessionJson({ sessionId: 'closed' }))
  file('14.json', sessionJson({ sessionId: 'other', cwd: '/repos/other' }))
  file('15.json', sessionJson({ sessionId: 'worktree', cwd: worktree }))
  file('16.json', 'not json')
  file('notes.txt', 'not a session')

  const transcript = getTranscriptPath(configDirectory, repository, 'older')
  mkdirSync(Path.dirname(transcript), { recursive: true })
  writeFileSync(transcript, '{"gitBranch":"feature/login"}\n')

  const running = new Set([11, 12, 14, 15, 16])
  const options = {
    configDirectory,
    isRunning: (pid: number) => running.has(pid),
  }

  it('finds the running chats of the folders, newest first', async () => {
    const found = await findClaudeSessions([repository, worktree], options)

    assert.deepStrictEqual(
      found.map(s => [s.sessionId, s.pid, s.lastBranch]),
      [
        ['newer', 12, null],
        ['worktree', 15, null],
        ['older', 11, 'feature/login'],
      ]
    )
  })

  it('finds nothing without a sessions folder', async () => {
    const empty = mkdtempSync(Path.join(tmpdir(), 'claude-config-'))
    assert.deepStrictEqual(
      await findClaudeSessions([repository], { configDirectory: empty }),
      []
    )
  })
})

describe('pickDefaultSession', () => {
  const newest = session({ sessionId: 'newest', lastBranch: 'main' })
  const onBranch = session({ sessionId: 'on-branch', lastBranch: 'feature' })

  it('prefers the newest chat on the branch, then the newest', () => {
    assert.equal(pickDefaultSession([newest, onBranch], 'feature'), onBranch)
    assert.equal(pickDefaultSession([newest, onBranch], 'other'), newest)
    assert.equal(pickDefaultSession([newest, onBranch], null), newest)
    assert.equal(pickDefaultSession([], 'feature'), null)
  })
})

describe('describeSession', () => {
  it('names the chat, where it runs and its branch', () => {
    assert.equal(
      describeSession(session({ name: 'Login page', lastBranch: 'feature' })),
      'Login page (Claude app, idle, feature)'
    )
    assert.equal(
      describeSession(
        session({
          name: null,
          app: 'terminal',
          status: null,
          sessionId: 'abcdef1234',
        })
      ),
      'Chat abcdef12 (terminal)'
    )
  })
})
