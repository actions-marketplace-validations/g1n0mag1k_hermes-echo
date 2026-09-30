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
 * Parse the first script from pyproject.toml [project.scripts] or
 * [tool.poetry.scripts] tables.
 */
export function parsePyprojectConsoleScript(content) {
    const tables = [
        /\[project\.scripts\]([\s\S]*?)(?=\n\[|\s*$)/,
        /\[tool\.poetry\.scripts\]([\s\S]*?)(?=\n\[|\s*$)/,
    ];
    for (const tableRe of tables) {
        const match = content.match(tableRe);
        if (!match)
            continue;
        const lines = match[1].split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) {
                continue;
            }
            // myapp = "pkg.cli:main"  or  myapp = 'pkg.cli:main'
            const kv = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=/);
            if (kv)
                return kv[1];
        }
    }
    // Also support setuptools entry-points style in pyproject:
    // [project.entry-points."console_scripts"]
    // myapp = "pkg.cli:main"
    const entryPoints = content.match(/\[project\.entry-points\.(?:"console_scripts"|'console_scripts'|console_scripts)\]([\s\S]*?)(?=\n\[|\s*$)/);
    if (entryPoints) {
        const lines = entryPoints[1].split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) {
                continue;
            }
            const kv = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=/);
            if (kv)
                return kv[1];
        }
    }
    return null;
}
export const NO_COMMAND_ERROR = "No command specified and no console_scripts found in setup.py or pyproject.toml. Add 'command: myapp' to your workflow.";
/**
 * Detect the first console script name from setup.py or pyproject.toml
 * in the repository root. Prefer setup.py when both exist.
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
        // absent or unreadable — try pyproject.toml
    }
    const pyprojectPath = path.join(repoRoot, 'pyproject.toml');
    try {
        const content = await fs.readFile(pyprojectPath, 'utf8');
        return parsePyprojectConsoleScript(content);
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
