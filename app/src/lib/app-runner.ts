import * as Path from 'path'

/** Where a repository describes how to build and run itself. */
export const runConfigPath = '.gitybara/run.json'

/** One way to start the app in a repository, as written in the config. */
export interface IRunProfile {
  readonly name: string

  /** A command to run to completion before `run`, as the program and its arguments. */
  readonly build?: ReadonlyArray<string>

  /** The command that starts the app, as the program and its arguments. */
  readonly run: ReadonlyArray<string>

  /**
   * The folder to start `run` in, relative to the repository. Defaults to the
   * repository. The `build` command always runs in the repository.
   */
  readonly cwd?: string
}

/** The result of looking for the run config of a repository. */
export type RunConfigResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'ok'; readonly profiles: ReadonlyArray<IRunProfile> }

export type AppRunnerPhase = 'idle' | 'building' | 'running'

/** What the runner is doing for a repository. */
export interface IAppRunnerStatus {
  readonly phase: AppRunnerPhase

  /** The profile being built or run, if any. */
  readonly profile: string | null

  /** Why the last start failed, if it did. Cleared by the next start. */
  readonly error: string | null
}

export const idleStatus: IAppRunnerStatus = {
  phase: 'idle',
  profile: null,
  error: null,
}

function isCommand(value: unknown): value is ReadonlyArray<string> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(part => typeof part === 'string' && part.length > 0)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseProfile(value: unknown, index: number): IRunProfile | string {
  const where = `profiles[${index}]`
  if (!isRecord(value)) {
    return `${where} must be an object.`
  }

  const { name, build, run, cwd } = value

  if (typeof name !== 'string' || name.trim() === '') {
    return `${where} needs a "name".`
  }
  if (!isCommand(run)) {
    return `${where} ("${name}") needs a "run" command, like ["node", "app.js"].`
  }
  if (build !== undefined && !isCommand(build)) {
    return `${where} ("${name}") has a "build" that is not a command.`
  }
  if (cwd !== undefined && typeof cwd !== 'string') {
    return `${where} ("${name}") has a "cwd" that is not text.`
  }

  return { name, build, run, cwd }
}

/** Read the profiles out of the text of a run config. */
export function parseRunConfig(text: string): RunConfigResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { kind: 'invalid', message: `${runConfigPath} is not valid JSON.` }
  }

  const entries = isRecord(json) ? json.profiles : undefined

  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      kind: 'invalid',
      message: `${runConfigPath} needs a "profiles" list with at least one profile.`,
    }
  }

  const profiles: IRunProfile[] = []
  for (const [index, entry] of entries.entries()) {
    const profile = parseProfile(entry, index)
    if (typeof profile === 'string') {
      return { kind: 'invalid', message: profile }
    }
    if (
      profiles.some(p => p.name.toLowerCase() === profile.name.toLowerCase())
    ) {
      return {
        kind: 'invalid',
        message: `Two profiles are named "${profile.name}".`,
      }
    }
    profiles.push(profile)
  }

  return { kind: 'ok', profiles }
}

/**
 * The program to start. A program with a path in it is relative to the
 * repository, as the config is, while a bare name like `node` is left for the
 * system to find.
 */
export function resolveProgram(repositoryPath: string, program: string) {
  return /[\\/]/.test(program) ? Path.resolve(repositoryPath, program) : program
}

/** The folder to run a profile in. */
export function resolveWorkingDirectory(
  repositoryPath: string,
  profile: IRunProfile
) {
  return Path.resolve(repositoryPath, profile.cwd ?? '.')
}

/** The lines of build output worth showing when a build fails. */
export function summarizeBuildFailure(output: string, maxLines = 10) {
  const lines = output.split(/\r?\n/).filter(line => line.trim() !== '')
  const errors = [...new Set(lines.filter(line => /\berror\b/i.test(line)))]
  return (errors.length > 0 ? errors : lines.slice(-maxLines))
    .slice(0, maxLines)
    .join('\n')
}
