import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { installProject } from './install.js'
import { withRunnerPath } from './runner-env.js'
import { discoverProbes } from './discover.js'

export interface DoctorCheck {
  name: string
  passed: boolean
  detail: string
  fix?: string
}

export interface DoctorReport {
  checks: DoctorCheck[]
  ready: boolean
  probeCount: number
  qualifyingProbeCount: number
  estimatedRuntimeSeconds: number
}

interface CommandResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

function runCommand(
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number }
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let settled = false
    let timedOut = false
    let stdout = ''
    let stderr = ''

    const finish = (result: CommandResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const child = spawn(command, args, {
      cwd: options?.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      // withRunnerPath extends PATH (incl. Windows Python Scripts) and
      // avoids Path/PATH key collisions that break inheritance on Windows.
      env: withRunnerPath(),
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, options?.timeoutMs ?? 30_000)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', () => {
      finish({ exitCode: null, stdout, stderr })
    })

    child.on('close', (code) => {
      if (timedOut) {
        finish({ exitCode: null, stdout, stderr })
        return
      }
      finish({ exitCode: code, stdout, stderr })
    })
  })
}

async function hasGitAt(repoRoot: string): Promise<boolean> {
  try {
    await fs.access(path.join(repoRoot, '.git'))
    return true
  } catch {
    // Nested package roots (e.g. testcli/base) sit inside the repo.
    let current = path.resolve(repoRoot)
    for (;;) {
      try {
        await fs.access(path.join(current, '.git'))
        return true
      } catch {
        const parent = path.dirname(current)
        if (parent === current) return false
        current = parent
      }
    }
  }
}

function pipVersionLabel(output: string): string {
  const match = output.trim().match(/^pip\s+\S+/i)
  return match ? match[0] : 'pip'
}

export async function runDoctor(
  command: string,
  repoRoot: string
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = []

  // CHECK 1: Git repository
  const gitOk = await hasGitAt(repoRoot)
  checks.push({
    name: 'Git repository',
    passed: gitOk,
    detail: gitOk ? 'Git repository detected' : 'Git repository not detected',
    fix: gitOk ? undefined : 'Run from inside a git repository.',
  })

  // CHECK 2: Python available
  const python = await runCommand('python3', ['--version'])
  const pythonOk = python.exitCode === 0
  const pythonLabel = (python.stdout || python.stderr).trim() || 'Python 3'
  checks.push({
    name: 'Python available',
    passed: pythonOk,
    detail: pythonOk
      ? `${pythonLabel} available`
      : 'Python 3 not available',
    fix: pythonOk
      ? undefined
      : 'Python 3 is required. The ubuntu-latest GitHub Actions runner includes Python 3 by default.',
  })

  // CHECK 3: pip available
  const pip = await runCommand('pip', ['--version'])
  const pipOk = pip.exitCode === 0
  const pipLabel = pipOk ? pipVersionLabel(pip.stdout || pip.stderr) : 'pip'
  checks.push({
    name: 'pip available',
    passed: pipOk,
    detail: pipOk ? `${pipLabel} available` : 'pip not available',
    fix: pipOk ? undefined : 'Run: python3 -m ensurepip --upgrade',
  })

  // CHECK 4: Project installs
  const install = await installProject(repoRoot)
  checks.push({
    name: 'Project installs',
    passed: install.success,
    detail: install.success
      ? 'Project installed successfully'
      : 'Project installation failed',
    fix: install.success
      ? undefined
      : 'Check that setup.py or pyproject.toml is present and all dependencies are available.',
  })

  // CHECK 5: Command found in PATH
  // Windows uses `where`; Unix uses `which`.
  const finder = process.platform === 'win32' ? 'where' : 'which'
  const which = await runCommand(finder, [command])
  const whichOk = which.exitCode === 0
  checks.push({
    name: 'Command found in PATH',
    passed: whichOk,
    detail: whichOk
      ? `${command} found in PATH`
      : `${command} not found in PATH`,
    fix: whichOk
      ? undefined
      : `'${command}' was not found after installation. Verify that setup.py defines a console_scripts entry point named '${command}'.`,
  })

  // CHECK 6: --help succeeds
  const help = await runCommand(command, ['--help'])
  const helpOk = help.exitCode === 0
  checks.push({
    name: '--help succeeds',
    passed: helpOk,
    detail: helpOk
      ? `${command} --help succeeded`
      : `${command} --help failed`,
    fix: helpOk
      ? undefined
      : `Verify '${command} --help' works locally before running Hermes Echo.`,
  })

  // CHECK 7: Probes discovered
  const discovery = await discoverProbes(command, repoRoot)
  const probeCount = discovery.totalCandidates
  const qualifyingProbeCount = discovery.probes.length
  const probesOk = qualifyingProbeCount > 0
  checks.push({
    name: 'Probes discovered',
    passed: probesOk,
    detail: `${probeCount} probes discovered (${qualifyingProbeCount} qualifying)`,
    fix: probesOk
      ? undefined
      : 'No probes were discovered with confidence >= 70. Add example invocations to your README.md in a fenced code block, or add fixture files to fixtures/, examples/, or testdata/.',
  })

  const ready = checks.every((c) => c.passed)

  return {
    checks,
    ready,
    probeCount,
    qualifyingProbeCount,
    estimatedRuntimeSeconds: qualifyingProbeCount * 5,
  }
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = []

  for (const check of report.checks) {
    if (check.passed) {
      lines.push(`  ✓ ${check.detail}`)
    } else {
      lines.push(`  ❌ ${check.detail}`)
      if (check.fix) {
        lines.push(`  Fix: ${check.fix}`)
      }
      break
    }
  }

  if (report.ready) {
    lines.push(
      `  Ready. Estimated runtime: ~${report.estimatedRuntimeSeconds} seconds.`
    )
  }

  return lines.join('\n')
}
