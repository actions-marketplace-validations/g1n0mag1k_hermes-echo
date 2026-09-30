import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  detectCommand,
  parsePyprojectConsoleScript,
  parseSetupCfgConsoleScript,
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

  test('extracts from dotted scripts.name under [project]', () => {
    const content = `
[project]
name = "tox"
scripts.tox = "tox.run:run"
`
    expect(parsePyprojectConsoleScript(content)).toBe('tox')
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

  test('extracts from [tool.setuptools.entry-points."console_scripts"]', () => {
    const content = `
[tool.setuptools.entry-points."console_scripts"]
stapp = "st.cli:main"
`
    expect(parsePyprojectConsoleScript(content)).toBe('stapp')
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

describe('parseSetupCfgConsoleScript', () => {
  test('extracts from setup.cfg console_scripts', () => {
    const content = `
[options.entry_points]
console_scripts =
    pre-commit = pre_commit.main:main
    other = other.main:main
`
    expect(parseSetupCfgConsoleScript(content)).toBe('pre-commit')
  })

  test('extracts same-line console_scripts value', () => {
    const content = `
[options.entry_points]
console_scripts = myapp = myapp.cli:main
`
    expect(parseSetupCfgConsoleScript(content)).toBe('myapp')
  })

  test('returns null when no console_scripts', () => {
    expect(
      parseSetupCfgConsoleScript('[options]\npackages = find:\n')
    ).toBeNull()
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

  test('detects from pyproject.toml [project.scripts]', async () => {
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

  test('detects from pyproject.toml [tool.poetry.scripts]', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      `[tool.poetry.scripts]
poetapp = "demo.cli:main"
`
    )
    expect(await detectCommand(tmpDir)).toBe('poetapp')
  })

  test('detects from pyproject.toml [tool.setuptools] entry-points', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      `[tool.setuptools.entry-points."console_scripts"]
stapp = "st.cli:main"
`
    )
    expect(await detectCommand(tmpDir)).toBe('stapp')
  })

  test('detects from setup.cfg console_scripts', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'setup.cfg'),
      `[options.entry_points]
console_scripts =
    cfgapp = cfg.cli:main
`
    )
    expect(await detectCommand(tmpDir)).toBe('cfgapp')
  })

  test('detects from setup.cfg when setup.py has empty setup()', async () => {
    fs.writeFileSync(path.join(tmpDir, 'setup.py'), 'from setuptools import setup\nsetup()\n')
    fs.writeFileSync(
      path.join(tmpDir, 'setup.cfg'),
      `[options.entry_points]
console_scripts =
    pre-commit = pre_commit.main:main
`
    )
    expect(await detectCommand(tmpDir)).toBe('pre-commit')
  })

  test('prefers setup.py when both setup.py and pyproject.toml exist', async () => {
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

  test('returns null when no scripts found anywhere', async () => {
    fs.writeFileSync(path.join(tmpDir, 'setup.py'), 'setup(name="x")\n')
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '[project]\nname = "x"\n')
    fs.writeFileSync(path.join(tmpDir, 'setup.cfg'), '[metadata]\nname = x\n')
    expect(await detectCommand(tmpDir)).toBeNull()
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
