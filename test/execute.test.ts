import { describe, test, expect, vi, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { executeProbe } from '../src/execute.js'

const require = createRequire(import.meta.url)
const childProcess = require('child_process') as typeof import('child_process')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('execute', () => {
  test('captures stdout on exit 0', async () => {
    const observation = await executeProbe({
      args: ['echo', 'hello world'],
      confidence: 90,
      source: 'baseline',
    })

    expect(observation.exitCode).toBe(0)
    expect(observation.stdout).toContain('hello world')
    expect(observation.timedOut).toBe(false)
    expect(observation.skipped).toBe(false)
  })

  test('captures exit code 1', async () => {
    const observation = await executeProbe({
      args: ['sh', '-c', 'exit 1'],
      confidence: 90,
      source: 'baseline',
    })

    expect(observation.exitCode).toBe(1)
    expect(observation.timedOut).toBe(false)
    expect(observation.skipped).toBe(false)
  })

  test('captures stderr separately from stdout', async () => {
    const observation = await executeProbe({
      args: ['sh', '-c', 'echo errormsg >&2'],
      confidence: 90,
      source: 'baseline',
    })

    expect(observation.stderr).toContain('errormsg')
    expect(observation.exitCode).toBe(0)
  })

  test('times out and resolves cleanly', async () => {
    const started = Date.now()
    const observation = await executeProbe(
      {
        args: ['sleep', '60'],
        confidence: 90,
        source: 'baseline',
      },
      { timeoutMs: 500 }
    )
    const elapsed = Date.now() - started

    expect(observation.timedOut).toBe(true)
    expect(observation.exitCode).toBeNull()
    expect(elapsed).toBeLessThan(3000)
  })

  test('skips daemon keyword without spawning process', async () => {
    const spawnSpy = vi.spyOn(childProcess, 'spawn')

    const observation = await executeProbe({
      args: ['testcli', 'serve'],
      confidence: 50,
      source: 'baseline',
    })

    expect(observation.skipped).toBe(true)
    expect(
      observation.skipReason?.includes('serve') ||
        observation.skipReason?.includes('long-running')
    ).toBe(true)
    expect(spawnSpy).not.toHaveBeenCalled()
  })

  test('skips mutating command', async () => {
    const observation = await executeProbe({
      args: ['myapp', 'deploy', 'production'],
      confidence: 50,
      source: 'baseline',
    })

    expect(observation.skipped).toBe(true)
  })

  test('runs testcli validate and captures output', async () => {
    const observation = await executeProbe({
      args: ['testcli', 'validate', 'testcli/base/fixtures/valid.yml'],
      confidence: 90,
      source: 'fixture',
    })

    expect(observation.exitCode).toBe(0)
    expect(observation.stdout).toContain('Valid configuration')
  })

  test('stores both raw and normalized in observation', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const observation = await executeProbe({
      args: ['sh', '-c', `echo "id: ${uuid}"`],
      confidence: 90,
      source: 'baseline',
    })

    expect(observation.stdout).toContain(uuid)
    expect(observation.stdoutNormalized).toContain('<UUID>')
    expect(observation.stdout).not.toBe(observation.stdoutNormalized)
  })

  test('clean environment strips extra vars', async () => {
    process.env.SECRET_VAR = 'should-not-appear'
    try {
      const observation = await executeProbe({
        args: ['sh', '-c', 'echo $SECRET_VAR'],
        confidence: 90,
        source: 'baseline',
      })

      expect(observation.stdout).not.toContain('should-not-appear')
    } finally {
      delete process.env.SECRET_VAR
    }
  })
})
