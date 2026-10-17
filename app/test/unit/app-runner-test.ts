import { describe, it } from 'node:test'
import assert from 'node:assert'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import * as Path from 'path'
import {
  getWindowsStartCommand,
  parseRunConfig,
  programExists,
  resolveProgram,
  resolveWorkingDirectory,
  summarizeBuildFailure,
} from '../../src/lib/app-runner'

const config = (profiles: unknown) => JSON.stringify({ profiles })

describe('parseRunConfig', () => {
  it('reads profiles with and without a build', () => {
    const result = parseRunConfig(
      config([
        { name: 'Dev', run: ['node', 'start.js'] },
        { name: 'Rebuild', build: ['node', 'build.js'], run: ['node', 'a.js'] },
      ])
    )

    assert.deepStrictEqual(result, {
      kind: 'ok',
      profiles: [
        {
          name: 'Dev',
          build: undefined,
          run: ['node', 'start.js'],
          cwd: undefined,
        },
        {
          name: 'Rebuild',
          build: ['node', 'build.js'],
          run: ['node', 'a.js'],
          cwd: undefined,
        },
      ],
    })
  })

  it('reads the config the Claude Code runner uses', () => {
    const result = parseRunConfig(
      config([
        { name: 'Dev', run: ['node', 'vendor/yarn-1.21.1.js', 'start'] },
        {
          name: 'Rebuild',
          build: ['node', 'vendor/yarn-1.21.1.js', 'build:dev'],
          run: ['node', 'vendor/yarn-1.21.1.js', 'start'],
        },
      ])
    )

    assert.equal(result.kind, 'ok')
  })

  it('rejects text that is not JSON', () => {
    assert.equal(parseRunConfig('{ profiles: ').kind, 'invalid')
  })

  it('rejects a config without profiles', () => {
    assert.equal(parseRunConfig('{}').kind, 'invalid')
    assert.equal(parseRunConfig('[]').kind, 'invalid')
    assert.equal(parseRunConfig(config([])).kind, 'invalid')
  })

  it('rejects a profile that cannot be started', () => {
    for (const profile of [
      'Dev',
      { run: ['node'] },
      { name: '  ', run: ['node'] },
      { name: 'Dev' },
      { name: 'Dev', run: [] },
      { name: 'Dev', run: 'node app.js' },
      { name: 'Dev', run: ['node', 1] },
      { name: 'Dev', run: ['node'], build: 'make' },
      { name: 'Dev', run: ['node'], cwd: 3 },
    ]) {
      assert.equal(parseRunConfig(config([profile])).kind, 'invalid')
    }
  })

  it('names the profile that is wrong', () => {
    const result = parseRunConfig(
      config([{ name: 'Dev', run: ['node'] }, { name: 'Broken' }])
    )

    assert.equal(result.kind, 'invalid')
    assert.ok(result.kind === 'invalid' && result.message.includes('Broken'))
  })

  it('rejects two profiles with the same name', () => {
    const result = parseRunConfig(
      config([
        { name: 'Dev', run: ['node'] },
        { name: 'dev', run: ['node'] },
      ])
    )

    assert.equal(result.kind, 'invalid')
  })
})

describe('resolveProgram', () => {
  const root = Path.resolve('/code/app')

  it('leaves a bare program name for the system to find', () => {
    assert.equal(resolveProgram(root, 'node'), 'node')
  })

  it('makes a program with a path relative to the repository', () => {
    assert.equal(
      resolveProgram(root, 'bin/start.exe'),
      Path.resolve(root, 'bin/start.exe')
    )
  })
})

describe('resolveWorkingDirectory', () => {
  const root = Path.resolve('/code/app')
  const profile = { name: 'Dev', run: ['node'] }

  it('defaults to the repository', () => {
    assert.equal(resolveWorkingDirectory(root, profile), root)
  })

  it('is relative to the repository', () => {
    assert.equal(
      resolveWorkingDirectory(root, { ...profile, cwd: 'app' }),
      Path.resolve(root, 'app')
    )
  })
})

describe('summarizeBuildFailure', () => {
  it('keeps the lines that report errors, once each', () => {
    const output = ['compiling', 'error: a', 'error: a', 'ok', 'Error: b'].join(
      '\n'
    )

    assert.equal(summarizeBuildFailure(output), 'error: a\nError: b')
  })

  it('falls back to the end of the output', () => {
    const output = ['one', 'two', 'three'].join('\r\n')

    assert.equal(summarizeBuildFailure(output, 2), 'two\nthree')
  })
})

describe('getWindowsStartCommand', () => {
  it('starts the program in a window of its own and waits for it', () => {
    assert.equal(
      getWindowsStartCommand(
        'C:AppsMy Appapp.exe',
        ['--one', 'two words'],
        'C:AppsMy App'
      ),
      'start "" /wait /d "C:AppsMy App" "C:AppsMy Appapp.exe" "--one" "two words"'
    )
  })

  it('works without arguments', () => {
    assert.equal(
      getWindowsStartCommand('dotnet', [], 'C:code'),
      'start "" /wait /d "C:code" "dotnet"'
    )
  })

  it('refuses values with a double quote', () => {
    assert.equal(
      getWindowsStartCommand('app.exe', ['say "hi"'], 'C:code'),
      null
    )
    assert.equal(getWindowsStartCommand('a"b.exe', [], 'C:code'), null)
    assert.equal(getWindowsStartCommand('app.exe', [], 'C:co"de'), null)
  })
})

describe('programExists', () => {
  const folder = mkdtempSync(Path.join(tmpdir(), 'app-runner-'))
  writeFileSync(Path.join(folder, 'tool.exe'), '')
  mkdirSync(Path.join(folder, 'dir.exe'))
  const env = { PATH: folder, PATHEXT: '.COM;.EXE' }

  it('finds a program with a path, with or without its extension', async () => {
    assert.equal(await programExists(Path.join(folder, 'tool.exe'), env), true)
    assert.equal(await programExists(Path.join(folder, 'tool'), env), true)
  })

  it('finds a program by name in PATH', async () => {
    assert.equal(await programExists('tool', env), true)
    assert.equal(await programExists('tool.exe', env), true)
  })

  it('does not find a missing program', async () => {
    assert.equal(await programExists(Path.join(folder, 'nope.exe'), env), false)
    assert.equal(await programExists('nope', env), false)
    assert.equal(await programExists('tool', { PATH: '' }), false)
  })

  it('does not count a folder as a program', async () => {
    assert.equal(await programExists('dir', env), false)
  })
})
