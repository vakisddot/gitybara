import { ChildProcess, execFile, spawn } from 'child_process'
import { WebContents } from 'electron'
import { readFile } from 'fs/promises'
import * as Path from 'path'
import {
  IAppRunnerStatus,
  IRunProfile,
  RunConfigResult,
  idleStatus,
  parseRunConfig,
  resolveProgram,
  resolveWorkingDirectory,
  runConfigPath,
  summarizeBuildFailure,
} from '../lib/app-runner'
import * as ipcMain from './ipc-main'
import { send } from './ipc-webcontents'

const buildTimeoutMs = 10 * 60 * 1000

/** What is running for one repository. */
interface IRun {
  status: IAppRunnerStatus

  /** The window to tell when the status changes. */
  readonly sender: WebContents

  /** The build or the app, whichever is going. */
  child: ChildProcess | null

  /** Set when the user stopped it, so that its exit isn't reported as a failure. */
  isStopping: boolean
}

async function readRunConfig(repositoryPath: string): Promise<RunConfigResult> {
  try {
    const text = await readFile(
      Path.join(repositoryPath, runConfigPath),
      'utf8'
    )
    return parseRunConfig(text)
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { kind: 'missing' }
    }
    return { kind: 'invalid', message: `Could not read ${runConfigPath}.` }
  }
}

/** Stop a process and everything it started. */
function killTree(child: ChildProcess) {
  if (child.pid === undefined) {
    return
  }

  if (__WIN32__) {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], error => {
      if (error) {
        log.error(`Could not stop process ${child.pid}`, error)
      }
    })
  } else {
    child.kill()
  }
}

/**
 * Run a command to the end in the repository, giving its output (or the reason
 * it couldn't run) if it fails.
 *
 * The profile's `cwd` is only for starting the app. Commands like
 * `dotnet build Project/Project.csproj` are written relative to the repository.
 */
function runToCompletion(
  run: IRun,
  command: ReadonlyArray<string>,
  repositoryPath: string
): Promise<string | null> {
  return new Promise(resolve => {
    const [program, ...args] = command
    let output = ''

    const child = spawn(resolveProgram(repositoryPath, program), args, {
      cwd: repositoryPath,
      windowsHide: true,
    })
    run.child = child

    const timeout = setTimeout(() => killTree(child), buildTimeoutMs)
    const collect = (data: Buffer) => (output += data.toString())
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)

    child.on('error', error => {
      clearTimeout(timeout)
      resolve(`Could not run ${program}: ${error.message}`)
    })
    child.on('close', code => {
      clearTimeout(timeout)
      resolve(code === 0 ? null : summarizeBuildFailure(output))
    })
  })
}

export function installAppRunnerHandlers() {
  const runs = new Map<string, IRun>()

  const setStatus = (
    repositoryPath: string,
    run: IRun,
    status: IAppRunnerStatus
  ) => {
    run.status = status
    if (!run.sender.isDestroyed()) {
      send(run.sender, 'app-runner-status', repositoryPath, status)
    }
  }

  const finish = (
    repositoryPath: string,
    run: IRun,
    profile: IRunProfile,
    error: string | null
  ) => {
    // A process that fails to start reports both an error and an exit.
    if (runs.get(repositoryPath) !== run) {
      return
    }
    runs.delete(repositoryPath)

    const failure = run.isStopping ? null : error
    setStatus(repositoryPath, run, {
      ...idleStatus,
      profile: failure === null ? null : profile.name,
      error: failure,
    })
  }

  const launch = async (
    repositoryPath: string,
    run: IRun,
    profile: IRunProfile
  ) => {
    if (profile.build) {
      setStatus(repositoryPath, run, {
        phase: 'building',
        profile: profile.name,
        error: null,
      })

      const failure = await runToCompletion(run, profile.build, repositoryPath)
      if (run.isStopping || failure !== null) {
        if (!run.isStopping) {
          log.warn(`[AppRunner] ${profile.name}: build failed\n${failure}`)
        }
        finish(repositoryPath, run, profile, `Build failed.\n${failure ?? ''}`)
        return
      }
    }

    const [program, ...args] = profile.run
    const child = spawn(resolveProgram(repositoryPath, program), args, {
      cwd: resolveWorkingDirectory(repositoryPath, profile),
      stdio: 'ignore',
      // The app's own window is the point, and a console app gets one too.
      windowsHide: false,
    })
    run.child = child

    let hasStarted = false

    child.on('spawn', () => {
      hasStarted = true
      setStatus(repositoryPath, run, {
        phase: 'running',
        profile: profile.name,
        error: null,
      })
    })
    child.on('error', error => {
      log.warn(`[AppRunner] ${profile.name}: ${program}: ${error.message}`)
      // Once the app is running, how it ends is up to whoever closes it.
      finish(
        repositoryPath,
        run,
        profile,
        hasStarted ? null : `Could not run ${program}: ${error.message}`
      )
    })
    child.on('exit', (code, signal) => {
      log.info(
        `[AppRunner] ${profile.name} exited with code ${code} (signal ${signal})`
      )
      finish(repositoryPath, run, profile, null)
    })
  }

  const requireAbsolute = (repositoryPath: string) => {
    if (!Path.isAbsolute(repositoryPath)) {
      throw new Error('Running an app requires an absolute repository path.')
    }
  }

  ipcMain.handle('app-runner-get-config', (_, repositoryPath) => {
    requireAbsolute(repositoryPath)
    return readRunConfig(repositoryPath)
  })

  ipcMain.handle('app-runner-get-status', async (_, repositoryPath) => {
    requireAbsolute(repositoryPath)
    return runs.get(repositoryPath)?.status ?? idleStatus
  })

  ipcMain.handle(
    'app-runner-start',
    async ({ sender }, repositoryPath, profileName) => {
      requireAbsolute(repositoryPath)
      if (runs.has(repositoryPath)) {
        return
      }

      const run: IRun = {
        status: idleStatus,
        sender,
        child: null,
        isStopping: false,
      }
      runs.set(repositoryPath, run)

      const config = await readRunConfig(repositoryPath)
      const profile =
        config.kind === 'ok'
          ? config.profiles.find(p => p.name === profileName)
          : undefined

      if (profile === undefined) {
        const reason =
          config.kind === 'invalid'
            ? config.message
            : `There is no profile named "${profileName}" in ${runConfigPath}.`
        runs.delete(repositoryPath)
        setStatus(repositoryPath, run, { ...idleStatus, error: reason })
        return
      }

      // Not awaited: the call returns once it has begun, and the status events
      // carry the rest.
      void launch(repositoryPath, run, profile)
    }
  )

  ipcMain.handle('app-runner-stop', async (_, repositoryPath) => {
    requireAbsolute(repositoryPath)
    const run = runs.get(repositoryPath)
    if (run?.child) {
      run.isStopping = true
      killTree(run.child)
    }
  })
}
