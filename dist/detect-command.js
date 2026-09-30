import { promises as fs } from 'node:fs';
import path from 'node:path';
/**
 * Extract the console script name from an entry like "myapp=pkg.cli:main".
 */
function scriptNameFromEntry(entry) {
    const trimmed = entry.trim();
    if (!trimmed)
        return null;
    const eq = trimmed.indexOf('=');
    if (eq === -1)
        return trimmed.replace(/^['"]|['"]$/g, '') || null;
    const name = trimmed.slice(0, eq).trim().replace(/^['"]|['"]$/g, '');
    return name || null;
}
/**
 * First key from a TOML table body (`name = "module:func"` lines).
 */
function firstTomlScriptKey(body) {
    const lines = body.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) {
            continue;
        }
        const kv = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=/);
        if (kv)
            return kv[1];
    }
    return null;
}
/**
 * Parse the first console_scripts entry from setup.py content.
 * Handles forms like:
 *   entry_points={'console_scripts': ['myapp=pkg:main']}
 *   entry_points={"console_scripts": ["myapp = pkg:main"]}
 */
export function parseSetupPyConsoleScript(content) {
    const section = content.match(/console_scripts['"]\s*:\s*\[([\s\S]*?)\]/);
    if (!section)
        return null;
    const entries = section[1].match(/['"]([^'"]+)['"]/g);
    if (!entries || entries.length === 0)
        return null;
    for (const raw of entries) {
        const name = scriptNameFromEntry(raw.slice(1, -1));
        if (name)
            return name;
    }
    return null;
}
/**
 * Parse the first script from pyproject.toml:
 *   [project.scripts]
 *   scripts.name = "..."  (dotted PEP 621 under [project])
 *   [tool.poetry.scripts]
 *   [tool.setuptools.entry-points."console_scripts"]
 *   [project.entry-points."console_scripts"]
 */
export function parsePyprojectConsoleScript(content) {
    const projectScripts = content.match(/\[project\.scripts\]([\s\S]*?)(?=\n\[|\s*$)/);
    if (projectScripts) {
        const name = firstTomlScriptKey(projectScripts[1]);
        if (name)
            return name;
    }
    // PEP 621 dotted keys inside [project]: scripts.tox = "tox.run:run"
    const projectTable = content.match(/\[project\]([\s\S]*?)(?=\n\[|\s*$)/);
    if (projectTable) {
        const dotted = projectTable[1].match(/^scripts\.([A-Za-z0-9_.-]+)\s*=/m);
        if (dotted)
            return dotted[1];
    }
    const poetryScripts = content.match(/\[tool\.poetry\.scripts\]([\s\S]*?)(?=\n\[|\s*$)/);
    if (poetryScripts) {
        const name = firstTomlScriptKey(poetryScripts[1]);
        if (name)
            return name;
    }
    const setuptoolsEp = content.match(/\[tool\.setuptools\.entry-points\.(?:"console_scripts"|'console_scripts'|console_scripts)\]([\s\S]*?)(?=\n\[|\s*$)/);
    if (setuptoolsEp) {
        const name = firstTomlScriptKey(setuptoolsEp[1]);
        if (name)
            return name;
    }
    const projectEp = content.match(/\[project\.entry-points\.(?:"console_scripts"|'console_scripts'|console_scripts)\]([\s\S]*?)(?=\n\[|\s*$)/);
    if (projectEp) {
        const name = firstTomlScriptKey(projectEp[1]);
        if (name)
            return name;
    }
    return null;
}
/**
 * Parse console_scripts from setup.cfg [options.entry_points].
 *
 *   [options.entry_points]
 *   console_scripts =
 *       pre-commit = pre_commit.main:main
 */
export function parseSetupCfgConsoleScript(content) {
    const section = content.match(/\[options\.entry_points\]([\s\S]*?)(?=\n\[|\s*$)/);
    if (!section)
        return null;
    const lines = section[1].split('\n');
    let inConsoleScripts = false;
    for (const line of lines) {
        if (!inConsoleScripts) {
            const header = line.match(/^\s*console_scripts\s*=\s*(.*)$/);
            if (!header)
                continue;
            inConsoleScripts = true;
            const sameLine = header[1].trim();
            if (sameLine) {
                const name = scriptNameFromEntry(sameLine);
                if (name)
                    return name;
            }
            continue;
        }
        // Continuation lines are indented
        if (/^[ \t]+\S/.test(line)) {
            const name = scriptNameFromEntry(line.trim());
            if (name)
                return name;
            continue;
        }
        if (!line.trim() || line.trim().startsWith('#'))
            continue;
        // Next unindented option — leave console_scripts
        break;
    }
    return null;
}
export const NO_COMMAND_ERROR = "No command specified and no console_scripts found in setup.py, pyproject.toml, or setup.cfg. Add 'command: myapp' to your workflow.";
/**
 * Detect the first console script name from setup.py, pyproject.toml, or
 * setup.cfg in the repository root. Prefer setup.py when it defines scripts.
 */
export async function detectCommand(repoRoot) {
    const setupPath = path.join(repoRoot, 'setup.py');
    try {
        const content = await fs.readFile(setupPath, 'utf8');
        const fromSetup = parseSetupPyConsoleScript(content);
        if (fromSetup)
            return fromSetup;
    }
    catch {
        // absent or unreadable — try pyproject.toml / setup.cfg
    }
    const pyprojectPath = path.join(repoRoot, 'pyproject.toml');
    try {
        const content = await fs.readFile(pyprojectPath, 'utf8');
        const fromPyproject = parsePyprojectConsoleScript(content);
        if (fromPyproject)
            return fromPyproject;
    }
    catch {
        // absent or unreadable — try setup.cfg
    }
    const setupCfgPath = path.join(repoRoot, 'setup.cfg');
    try {
        const content = await fs.readFile(setupCfgPath, 'utf8');
        return parseSetupCfgConsoleScript(content);
    }
    catch {
        return null;
    }
}
/**
 * Resolve the CLI command: explicit input wins; otherwise auto-detect.
 * Throws NO_COMMAND_ERROR when neither is available.
 */
export async function resolveCommandInput(repoRoot, explicit) {
    const trimmed = explicit?.trim();
    if (trimmed) {
        return { command: trimmed, discovered: false };
    }
    const detected = await detectCommand(repoRoot);
    if (detected) {
        return { command: detected, discovered: true };
    }
    throw new Error(NO_COMMAND_ERROR);
}
