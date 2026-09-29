import path from 'node:path'

export function runnerPath(): string {
  const home = process.env.HOME ?? ''
  const pathEntries = [process.env.PATH ?? '']
  if (home) {
    pathEntries.push(path.join(home, '.local', 'bin'))
  }
  return pathEntries.filter(Boolean).join(path.delimiter)
}
