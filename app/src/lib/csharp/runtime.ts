import { spawn } from 'child_process'
import { access, cp, mkdir, readdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'

/** The tested server version; app upgrades control server upgrades. */
export const RoslynVersion = '5.12.0-1.26475.2'

const installations = new Map<string, Promise<string>>()

async function findServer(directory: string): Promise<string | null> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return []
      }
      throw error
    }
  )

  for (const entry of entries) {
    if (entry.isFile() && entry.name === 'roslyn-language-server.dll') {
      return join(directory, entry.name)
    }
    if (entry.isDirectory()) {
      const found = await findServer(join(directory, entry.name))
      if (found !== null) {
        return found
      }
    }
  }
  return null
}

async function installServer(directory: string): Promise<string> {
  const serverPath = join(directory, 'server', 'roslyn-language-server.dll')
  const installedMarker = join(directory, 'installed')
  const cached = await Promise.all([
    access(installedMarker),
    access(serverPath),
  ]).then(
    () => true,
    () => false
  )
  if (cached) {
    return serverPath
  }

  const packageDirectory = join(directory, 'package')
  await mkdir(packageDirectory, { recursive: true })
  const configPath = join(directory, 'NuGet.Config')
  // Do not inherit a repository's private feeds or tool manifest for setup.
  await writeFile(
    configPath,
    '<?xml version="1.0" encoding="utf-8"?><configuration><packageSources><clear/><add key="nuget.org" value="https://api.nuget.org/v3/index.json"/></packageSources></configuration>'
  )

  const downloadedMarker = join(directory, 'downloaded')
  const downloaded = await access(downloadedMarker).then(
    () => true,
    () => false
  )
  if (!downloaded) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'dotnet',
        [
          'tool',
          'install',
          'roslyn-language-server',
          '--tool-path',
          packageDirectory,
          '--version',
          RoslynVersion,
          '--configfile',
          configPath,
        ],
        {
          cwd: directory,
          windowsHide: true,
          env: {
            ...process.env,
            DOTNET_CLI_TELEMETRY_OPTOUT: '1',
            DOTNET_NOLOGO: '1',
          },
        }
      )
      let output = ''
      const collect = (data: Buffer) => {
        output = (output + data.toString()).slice(-4000)
      }
      child.stdout.on('data', collect)
      child.stderr.on('data', collect)
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('Downloading C# support timed out. Try again.'))
      }, 180000)
      child.once('error', error => {
        clearTimeout(timer)
        reject(
          new Error(
            `C# support needs the .NET 10 SDK. Make sure dotnet is installed and on PATH. ${error.message}`
          )
        )
      })
      child.once('exit', code => {
        clearTimeout(timer)
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Could not install C# support. ${output.trim()}`))
        }
      })
    })
    await writeFile(downloadedMarker, RoslynVersion)
  }

  const installed = await findServer(packageDirectory)
  if (installed === null) {
    throw new Error('Roslyn was installed but its server could not be found.')
  }
  // The .NET tool store nests versions and RIDs deeply. Roslyn launches a child
  // executable there, which can exceed Windows' process path limit. Keep the
  // complete payload together at a short path instead.
  await cp(dirname(installed), dirname(serverPath), { recursive: true })
  await writeFile(installedMarker, RoslynVersion)
  return serverPath
}

/** Download Roslyn once into Gitybara's own versioned cache, never globally. */
export function ensureRoslynRuntime(cacheRoot: string): Promise<string> {
  const directory = join(cacheRoot, 'csharp', RoslynVersion)
  const current = installations.get(directory)
  if (current !== undefined) {
    return current
  }

  const installation = installServer(directory).catch(error => {
    installations.delete(directory)
    throw error
  })
  installations.set(directory, installation)
  return installation
}
