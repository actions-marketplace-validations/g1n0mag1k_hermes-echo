import { spawn } from 'node:child_process'
import { withRunnerPath } from './runner-env.js'

export interface InstallResult {
  success: boolean
  strategy?: string
  error?: string
  durationMs: number
}

const STRATEGY_TIMEOUT_MS = 120_000

const INSTALL_ERROR =
  'Could not install project. Check that setup.py or pyproject.toml is present and all dependencies are available in the runner environment.'

interface Strategy {
  name: string
  command: string
  args: string[]
  cwd?: string
}

function runStrategy(strategy: Strategy): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    let timedOut = false

    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }

    const child = spawn(strategy.command, strategy.args, {
      cwd: strategy.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: withRunnerPath(),
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, STRATEGY_TIMEOUT_MS)

    child.on('error', () => finish(false))

    child.on('close', (code) => {
      if (timedOut) {
        finish(false)
        return
      }
      finish(code === 0)
    })
  })
}

export async function installProject(
  repoRoot: string
): Promise<InstallResult> {
  const start = Date.now()

  const strategies: Strategy[] = [
    {
      name: 'pip install -e',
      command: 'pip',
      args: ['install', '-e', repoRoot, '--quiet'],
    },
    {
      name: 'pip install',
      command: 'pip',
      args: ['install', repoRoot, '--quiet'],
    },
    {
      name: 'setup.py install',
      command: 'python3',
      args: ['setup.py', 'install'],
      cwd: repoRoot,
    },
  ]

  for (const strategy of strategies) {
    const ok = await runStrategy(strategy)
    if (ok) {
      return {
        success: true,
        strategy: strategy.name,
        durationMs: Date.now() - start,
      }
    }
  }

  return {
    success: false,
    error: INSTALL_ERROR,
    durationMs: Date.now() - start,
  }
}
