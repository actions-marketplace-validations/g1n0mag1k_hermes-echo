import { existsSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function windowsPythonScriptsDirs(): string[] {
  const dirs: string[] = []
  const localAppData = process.env.LOCALAPPDATA ?? ''
  const appData = process.env.APPDATA ?? ''

  const collectScriptsUnder = (root: string) => {
    if (!root || !existsSync(root)) return
    let entries: string[]
    try {
      entries = readdirSync(root)
    } catch {
      return
    }
    for (const entry of entries) {
      const scripts = path.join(root, entry, 'Scripts')
      if (existsSync(scripts)) {
        dirs.push(scripts)
      }
    }
  }

  // New python.org / pythoncore layout:
  // %LOCALAPPDATA%\Python\pythoncore-*\Scripts
  if (localAppData) {
    collectScriptsUnder(path.join(localAppData, 'Python'))
    // Traditional python.org layout:
    // %LOCALAPPDATA%\Programs\Python\Python*\Scripts
    collectScriptsUnder(path.join(localAppData, 'Programs', 'Python'))
  }

  // pip --user installs: %APPDATA%\Python\Python*\Scripts
  if (appData) {
    collectScriptsUnder(path.join(appData, 'Python'))
    const roamingScripts = path.join(appData, 'Python', 'Scripts')
    if (existsSync(roamingScripts)) {
      dirs.push(roamingScripts)
    }
  }

  return dirs
}

export function runnerPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? os.homedir()
  const pathEntries = [process.env.PATH ?? process.env.Path ?? '']

  if (home) {
    pathEntries.push(path.join(home, '.local', 'bin'))
  }

  if (process.platform === 'win32') {
    pathEntries.push(...windowsPythonScriptsDirs())
  }

  // Deduplicate while preserving order
  const seen = new Set<string>()
  const unique: string[] = []
  for (const entry of pathEntries) {
    if (!entry) continue
    const key = process.platform === 'win32' ? entry.toLowerCase() : entry
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(entry)
  }

  return unique.join(path.delimiter)
}

/**
 * Build an env object with runner PATH applied.
 * On Windows, avoid duplicate Path/PATH keys — Node keeps only the
 * lexicographically first case-insensitive match when spawning, which
 * can drop PATH updates and break console-script discovery.
 */
export function withRunnerPath(
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv }
  const existingKeys = Object.keys(env).filter(
    (key) => key.toUpperCase() === 'PATH'
  )
  const pathKey =
    process.platform === 'win32'
      ? (existingKeys[0] ?? 'Path')
      : 'PATH'

  for (const key of existingKeys) {
    delete env[key]
  }
  env[pathKey] = runnerPath()
  return env
}
