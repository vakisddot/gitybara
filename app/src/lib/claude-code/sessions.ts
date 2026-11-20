import { open, readdir, readFile } from 'fs/promises'
import { homedir } from 'os'
import * as Path from 'path'
import { isErrnoException } from '../errno-exception'

/** Where a Claude Code chat runs. */
export type ClaudeSessionApp = 'desktop' | 'terminal' | 'other'

/** A Claude Code chat that is running on this computer and can take messages. */
export interface IClaudeSession {
  readonly sessionId: string

  /** The process that runs the chat. Its inbox key is filed under it. */
  readonly pid: number

  /** The folder the chat works in. */
  readonly cwd: string

  /** The chat's title, as shown in the Claude app, if it has one. */
  readonly name: string | null

  /** What the chat is doing, like 'idle' or 'busy', if known. */
  readonly status: string | null

  readonly app: ClaudeSessionApp

  /** The named pipe (on Windows) or socket of the chat's inbox. */
  readonly socketPath: string

  /** When the chat last changed, in milliseconds since 1970. */
  readonly updatedAt: number

  /** The Git branch of the chat's last message, if known. */
  readonly lastBranch: string | null
}

type ClaudeSessionEntry = Omit<IClaudeSession, 'lastBranch'>

/**
 * Claude Code files each running chat as `<pid>.json` in its sessions folder,
 * next to a `<pid>.<hash>.key` file with the key of the chat's inbox.
 */
const sessionFilePattern = /^(\d+)\.json$/

/** How much of the end of a transcript to search for the last branch. */
const transcriptTailBytes = 256 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The folder Claude Code keeps its settings, sessions and transcripts in. */
export function getClaudeConfigDirectory(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.CLAUDE_CONFIG_DIR
  return configured !== undefined && configured !== ''
    ? configured
    : Path.join(homedir(), '.claude')
}

/** The folder with one file for each running chat. */
export function getSessionsDirectory(configDirectory: string) {
  return Path.join(configDirectory, 'sessions')
}

/**
 * The transcript of a chat. Claude Code names the folder after the chat's
 * working folder, with every character that isn't a letter or a digit
 * replaced by a dash.
 */
export function getTranscriptPath(
  configDirectory: string,
  cwd: string,
  sessionId: string
) {
  return Path.join(
    configDirectory,
    'projects',
    cwd.replace(/[^a-zA-Z0-9]/g, '-'),
    `${sessionId}.jsonl`
  )
}

function getApp(entrypoint: unknown): ClaudeSessionApp {
  switch (entrypoint) {
    case 'claude-desktop':
      return 'desktop'
    case 'cli':
      return 'terminal'
    default:
      return 'other'
  }
}

/**
 * Read one file of the sessions folder. Returns null if it isn't a chat with
 * an inbox, such as one run by a version of Claude Code without messaging.
 */
export function parseSessionFile(
  text: string,
  pid: number
): ClaudeSessionEntry | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(json)) {
    return null
  }

  const { sessionId, cwd, name, status, entrypoint, messagingSocketPath } = json
  const { updatedAt, startedAt } = json

  if (
    typeof sessionId !== 'string' ||
    sessionId === '' ||
    typeof cwd !== 'string' ||
    cwd === '' ||
    typeof messagingSocketPath !== 'string' ||
    messagingSocketPath === ''
  ) {
    return null
  }

  return {
    sessionId,
    pid,
    cwd,
    name: typeof name === 'string' && name.trim() !== '' ? name.trim() : null,
    status: typeof status === 'string' && status !== '' ? status : null,
    app: getApp(entrypoint),
    socketPath: messagingSocketPath,
    updatedAt:
      typeof updatedAt === 'number'
        ? updatedAt
        : typeof startedAt === 'number'
        ? startedAt
        : 0,
  }
}

function normalizeFolder(path: string, ignoreCase: boolean) {
  const resolved = Path.resolve(path).replace(/[\\/]+$/, '')
  return ignoreCase ? resolved.toLowerCase() : resolved
}

/**
 * Whether `path` is `folder` or a folder inside it. Paths are compared without
 * regard to case on Windows.
 */
export function isInFolder(
  path: string,
  folder: string,
  ignoreCase: boolean = __WIN32__
) {
  const child = normalizeFolder(path, ignoreCase)
  const parent = normalizeFolder(folder, ignoreCase)
  return child === parent || child.startsWith(parent + Path.sep)
}

/** Whether a process is still running. */
export function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM means the process exists but belongs to someone else.
    return isErrnoException(e) && e.code === 'EPERM'
  }
}

/** The last branch recorded in (the end of) a transcript, if any. */
export function findLastBranch(transcript: string): string | null {
  const matches = [...transcript.matchAll(/"gitBranch":("(?:[^"\\]|\\.)*")/g)]
  for (const match of matches.reverse()) {
    try {
      const branch: unknown = JSON.parse(match[1])
      if (typeof branch === 'string' && branch !== '') {
        return branch
      }
    } catch {
      // A match cut short by the start of the tail; try the one before it.
    }
  }
  return null
}

async function readTail(path: string, bytes: number) {
  try {
    const file = await open(path, 'r')
    try {
      const { size } = await file.stat()
      const length = Math.min(size, bytes)
      const buffer = Buffer.alloc(length)
      await file.read(buffer, 0, length, size - length)
      return buffer.toString('utf8')
    } finally {
      await file.close()
    }
  } catch {
    return null
  }
}

async function readText(path: string) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

export interface IFindClaudeSessionsOptions {
  /** Defaults to the folder of {@link getClaudeConfigDirectory}. */
  readonly configDirectory?: string

  /** Defaults to {@link isProcessRunning}. */
  readonly isRunning?: (pid: number) => boolean
}

/**
 * The Claude Code chats that are running on this computer and work in one of
 * the given folders, such as a repository and its worktrees, newest first.
 */
export async function findClaudeSessions(
  folders: ReadonlyArray<string>,
  options: IFindClaudeSessionsOptions = {}
): Promise<ReadonlyArray<IClaudeSession>> {
  const configDirectory = options.configDirectory ?? getClaudeConfigDirectory()
  const isRunning = options.isRunning ?? isProcessRunning
  const directory = getSessionsDirectory(configDirectory)

  let names: ReadonlyArray<string>
  try {
    names = await readdir(directory)
  } catch {
    return []
  }

  const sessions = new Array<IClaudeSession>()
  for (const name of names) {
    const match = sessionFilePattern.exec(name)
    if (match === null) {
      continue
    }

    const pid = Number(match[1])
    const text = await readText(Path.join(directory, name))
    const entry = text === null ? null : parseSessionFile(text, pid)
    if (
      entry === null ||
      !folders.some(folder => isInFolder(entry.cwd, folder)) ||
      !isRunning(pid)
    ) {
      continue
    }

    const transcript = await readTail(
      getTranscriptPath(configDirectory, entry.cwd, entry.sessionId),
      transcriptTailBytes
    )
    const lastBranch = transcript === null ? null : findLastBranch(transcript)
    sessions.push({ ...entry, lastBranch })
  }

  return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * The chat to suggest for a review: the newest one whose last message was on
 * the given branch, or else the newest one.
 */
export function pickDefaultSession(
  sessions: ReadonlyArray<IClaudeSession>,
  branch: string | null
): IClaudeSession | null {
  const onBranch =
    branch === null ? undefined : sessions.find(s => s.lastBranch === branch)
  return onBranch ?? (sessions.length > 0 ? sessions[0] : null)
}

/** A short label for a chat, for lists. */
export function describeSession(session: IClaudeSession) {
  const title = session.name ?? `Chat ${session.sessionId.slice(0, 8)}`
  const where =
    session.app === 'desktop'
      ? 'Claude app'
      : session.app === 'terminal'
      ? 'terminal'
      : 'Claude Code'
  const details = [where, session.status, session.lastBranch].filter(
    (detail): detail is string => detail !== null && detail !== ''
  )
  return `${title} (${details.join(', ')})`
}
