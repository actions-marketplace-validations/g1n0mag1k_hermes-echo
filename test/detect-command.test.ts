import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  detectCommand,
  parsePyprojectConsoleScript,
  parseSetupPyConsoleScript,
  resolveCommandInput,
  NO_COMMAND_ERROR,
} from '../src/detect-command.js'

describe('parseSetupPyConsoleScript', () => {
  test('extracts first console_scripts name from setup.py', () => {
    const content = `
from setuptools import setup
setup(
    entry_points={
        'console_scripts': ['myapp=mypkg.cli:main'],
    },
)
`
    expect(parseSetupPyConsoleScript(content)).toBe('myapp')
  })

  test('handles double quotes and spaces around equals', () => {
    const content = `
entry_points={
    "console_scripts": ["cool-cli = cool.cli:main", "other=cool.other:main"],
},
`
    expect(parseSetupPyConsoleScript(content)).toBe('cool-cli')
  })

  test('returns null when no console_scripts', () => {
    expect(parseSetupPyConsoleScript('setup(name="x")')).toBeNull()
  })
})

describe('parsePyprojectConsoleScript', () => {
  test('extracts from [project.scripts]', () => {
    const content = `
[project]
name = "demo"

[project.scripts]
demo-cli = "demo.cli:main"
other = "demo.other:main"
`
    expect(parsePyprojectConsoleScript(content)).toBe('demo-cli')
  })

  test('extracts from [tool.poetry.scripts]', () => {
    const content = `
[tool.poetry]
name = "demo"

[tool.poetry.scripts]
poetapp = "demo.cli:main"
`
    expect(parsePyprojectConsoleScript(content)).toBe('poetapp')
  })

  test('extracts from [project.entry-points."console_scripts"]', () => {
    const content = `
[project.entry-points."console_scripts"]
epapp = "ep.cli:main"
`
    expect(parsePyprojectConsoleScript(content)).toBe('epapp')
  })

  test('returns null when no scripts tables', () => {
    expect(parsePyprojectConsoleScript('[project]\nname = "x"\n')).toBeNull()
  })
})

describe('detectCommand / resolveCommandInput', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-detect-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('detects from setup.py on disk', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'setup.py'),
      `from setuptools import setup
setup(entry_points={'console_scripts': ['testcli=testcli.cli:main']})
`
    )
    expect(await detectCommand(tmpDir)).toBe('testcli')
  })

  test('detects from pyproject.toml when setup.py absent', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      `[project]
name = "x"

[project.scripts]
pyapp = "x.cli:main"
`
    )
    expect(await detectCommand(tmpDir)).toBe('pyapp')
  })

  test('prefers setup.py when both exist', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'setup.py'),
      `setup(entry_points={'console_scripts': ['from-setup=a:b']})`
    )
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      `[project.scripts]\nfrom-toml = "a:b"\n`
    )
    expect(await detectCommand(tmpDir)).toBe('from-setup')
  })

  test('resolveCommandInput uses explicit command without discovery', async () => {
    const result = await resolveCommandInput(tmpDir, 'explicit')
    expect(result).toEqual({ command: 'explicit', discovered: false })
  })

  test('resolveCommandInput discovers and marks discovered', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      `[project.scripts]\nauto = "pkg:main"\n`
    )
    const result = await resolveCommandInput(tmpDir, '')
    expect(result).toEqual({ command: 'auto', discovered: true })
  })

  test('resolveCommandInput fails with clear error when nothing found', async () => {
    await expect(resolveCommandInput(tmpDir, undefined)).rejects.toThrow(
      NO_COMMAND_ERROR
    )
  })
})
