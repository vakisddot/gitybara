import { readdir, readFile } from 'fs/promises'
import { connect } from 'net'
import * as Path from 'path'
import { isErrnoException } from '../errno-exception'
import {
  getClaudeConfigDirectory,
  getSessionsDirectory,
  IClaudeSession,
} from './sessions'

/** Why a message could not be sent to a chat. */
export type SendToClaudeFailure =
  | 'not-running'
  | 'no-key'
  | 'timeout'
  | 'failed'

/** A message could not be sent to a Claude Code chat. */
export class SendToClaudeError extends Error {
  public constructor(
    public readonly failure: SendToClaudeFailure,
    message: string
  ) {
    super(message)
    this.name = 'SendToClaudeError'
  }
}

/** The sender a chat is told its message comes from. */
export const messageSender = 'gitybara'

/** How long to wait for a chat's inbox before giving up. */
const defaultTimeoutMs = 10_000

const tokenPattern = /^[0-9a-f]{32}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * What to write to a chat's inbox to deliver a message: a line with the
 * inbox's key, then the message as a user message, each as one line of JSON.
 *
 * This is the format of Claude Code's cross-session messaging, which lets its
 * chats message each other. The key line is documented; the message line is
 * the one Claude Code itself gives as an example, so it may change.
 */
export function formatInboxMessage(
  token: string,
  sessionId: string,
  text: string
) {
  const lines = [
    { type: 'auth', token },
    {
      type: 'user',
      message: { role: 'user', content: text },
      session_id: sessionId,
      from: messageSender,
    },
  ]
  return lines.map(line => `${JSON.stringify(line)}\n`).join('')
}

/**
 * The key of a chat's inbox. Claude Code writes it to a file that only the
 * user's own programs can read.
 */
export async function readInboxKey(configDirectory: string, pid: number) {
  const directory = getSessionsDirectory(configDirectory)
  const keyFilePattern = new RegExp(`^${pid}\\.[0-9a-f]{64}\\.key$`)

  let names: ReadonlyArray<string>
  try {
    names = await readdir(directory)
  } catch {
    names = []
  }

  for (const name of names.filter(n => keyFilePattern.test(n))) {
    try {
      const json: unknown = JSON.parse(
        await readFile(Path.join(directory, name), 'utf8')
      )
      if (
        isRecord(json) &&
        typeof json.peerToken === 'string' &&
        tokenPattern.test(json.peerToken)
      ) {
        return json.peerToken
      }
    } catch {
      // Being rewritten, or not a key file; try the next one.
    }
  }

  throw new SendToClaudeError(
    'no-key',
    'The chat has no inbox key. It may have closed, or its Claude Code may be too old to take messages.'
  )
}

function isNotRunning(error: Error) {
  return (
    isErrnoException(error) &&
    (error.code === 'ENOENT' ||
      error.code === 'ECONNREFUSED' ||
      error.code === 'EPIPE')
  )
}

export interface ISendToClaudeOptions {
  /** Defaults to the folder of {@link getClaudeConfigDirectory}. */
  readonly configDirectory?: string
  readonly timeoutMs?: number
}

/**
 * Send text to a running Claude Code chat. A chat that is waiting starts
 * working on it at once; a busy one takes it after its current step.
 */
export async function sendToClaudeSession(
  session: IClaudeSession,
  text: string,
  options: ISendToClaudeOptions = {}
): Promise<void> {
  const configDirectory = options.configDirectory ?? getClaudeConfigDirectory()
  const token = await readInboxKey(configDirectory, session.pid)
  const payload = formatInboxMessage(token, session.sessionId, text)

  return new Promise<void>((resolve, reject) => {
    const socket = connect(session.socketPath)

    const timer = setTimeout(() => {
      socket.destroy()
      reject(
        new SendToClaudeError('timeout', 'The chat did not answer in time.')
      )
    }, options.timeoutMs ?? defaultTimeoutMs)

    socket.once('connect', () => socket.end(payload))
    socket.once('error', error => {
      clearTimeout(timer)
      reject(
        isNotRunning(error)
          ? new SendToClaudeError('not-running', 'The chat is not running.')
          : new SendToClaudeError('failed', error.message)
      )
    })
    socket.once('close', hadError => {
      clearTimeout(timer)
      if (!hadError) {
        resolve()
      }
    })
  })
}
