import { createRequire } from 'node:module'
import { runnerPath } from './runner-env.js'
import type { EchoObservation, EchoProbe } from './types.js'
import { normalize } from './normalize.js'

// CJS require so tests can vi.spyOn(childProcess, 'spawn') under ESM
const require = createRequire(import.meta.url)
const childProcess = require('child_process') as typeof import('child_process')

export const DAEMON_KEYWORDS = [
  'serve',
  'server',
  'start',
  'run',
  'watch',
  'daemon',
  'listen',
  'worker',
  'scheduler',
  'dev',
  'deploy',
  'push',
  'publish',
  'upload',
  'delete',
  'destroy',
  'migrate',
  'reset',
  'sync',
  'shell',
  'test',
]

const DEFAULT_TIMEOUT_MS = 30_000
const DAEMON_SKIP_REASON = 'potentially long-running or mutating command'

function buildCleanEnv(): NodeJS.ProcessEnv {
  return {
    PATH: runnerPath(),
    HOME: process.env.HOME ?? '',
    TERM: 'dumb',
    NO_COLOR: '1',
    CI: '1',
    LANG: 'en_US.UTF-8',
  }
}

function hasDaemonKeyword(args: string[]): boolean {
  return args.slice(1).some((arg) => DAEMON_KEYWORDS.includes(arg))
}

function getPythonVersion(): Promise<string> {
  return new Promise((resolve) => {
    const child = childProcess.spawn('python3', ['--version'], {
      env: buildCleanEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', () => resolve(''))
    child.on('close', () => {
      resolve((stdout || stderr).trim())
    })
  })
}

function buildEnvironment(
  commit: string,
  python: string
): EchoObservation['environment'] {
  return {
    platform: process.platform,
    commit,
    timestamp: new Date().toISOString(),
    python,
  }
}

export async function executeProbe(
  probe: EchoProbe,
  options?: {
    timeoutMs?: number
    commit?: string
  }
): Promise<EchoObservation> {
  const commit = options?.commit ?? 'unknown'

  // PROPERTY 3: daemon detection BEFORE any spawn
  if (hasDaemonKeyword(probe.args)) {
    return {
      probe,
      exitCode: null,
      stdout: '',
      stderr: '',
      stdoutNormalized: '',
      stderrNormalized: '',
      timedOut: false,
      skipped: true,
      skipReason: DAEMON_SKIP_REASON,
      durationMs: 0,
      environment: buildEnvironment(commit, ''),
    }
  }

  const python = await getPythonVersion()
  const environment = buildEnvironment(commit, python)
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const [command, ...args] = probe.args
  const start = Date.now()

  return new Promise((resolve) => {
    let settled = false
    let timedOut = false
    let stdout = ''
    let stderr = ''

    const finish = (observation: EchoObservation) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(observation)
    }

    const child = childProcess.spawn(command, args, {
      env: buildCleanEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', () => {
      if (timedOut) {
        finish({
          probe,
          exitCode: null,
          stdout,
          stderr,
          stdoutNormalized: normalize(stdout),
          stderrNormalized: normalize(stderr),
          timedOut: true,
          skipped: false,
          durationMs: Date.now() - start,
          environment,
        })
        return
      }

      finish({
        probe,
        exitCode: null,
        stdout,
        stderr,
        stdoutNormalized: normalize(stdout),
        stderrNormalized: normalize(stderr),
        timedOut: false,
        skipped: false,
        durationMs: Date.now() - start,
        environment,
      })
    })

    child.on('close', (code) => {
      if (timedOut) {
        finish({
          probe,
          exitCode: null,
          stdout,
          stderr,
          stdoutNormalized: normalize(stdout),
          stderrNormalized: normalize(stderr),
          timedOut: true,
          skipped: false,
          durationMs: Date.now() - start,
          environment,
        })
        return
      }

      finish({
        probe,
        exitCode: code,
        stdout,
        stderr,
        stdoutNormalized: normalize(stdout),
        stderrNormalized: normalize(stderr),
        timedOut: false,
        skipped: false,
        durationMs: Date.now() - start,
        environment,
      })
    })
  })
}
