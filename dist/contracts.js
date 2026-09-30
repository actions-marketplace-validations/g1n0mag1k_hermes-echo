import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dump as yamlDump, load as yamlLoad } from 'js-yaml';
import { structuredDiff } from './diff.js';
import { areEquivalent } from './normalize.js';
const PROBE_NAME_RE = /^[A-Za-z0-9_-]+$/;
function projectRoot() {
    return process.env.HERMES_ECHO_PROJECT_ROOT ?? process.cwd();
}
function contractsDirAbs() {
    return path.join(projectRoot(), '.hermes', 'contracts');
}
function packageVersionLabel() {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return `hermes-echo v${pkg.version}`;
}
function storeOutput(text) {
    return text === '' ? null : text;
}
function outputValue(value) {
    return (value ?? '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
}
export function probeNameFromProbe(probe) {
    const parts = [];
    for (let i = 1; i < probe.args.length; i++) {
        const arg = probe.args[i];
        if (!arg || arg === '--help') {
            break;
        }
        // Stop before flags, paths, and filenames — those are probe args, not names
        if (arg.startsWith('-') || arg.includes('.') || arg.includes('/')) {
            break;
        }
        parts.push(arg);
    }
    if (parts.length === 0) {
        return 'help';
    }
    return parts.join('-');
}
export function contractPath(probeName) {
    if (!probeName) {
        throw new Error('Probe name is required');
    }
    if (!PROBE_NAME_RE.test(probeName)) {
        throw new Error(`Invalid probe name '${probeName}': use only letters, numbers, hyphens, and underscores`);
    }
    return `.hermes/contracts/${probeName}.yml`;
}
function contractFileAbs(probeName) {
    return path.join(contractsDirAbs(), `${probeName}.yml`);
}
export function ensureContractsDir() {
    mkdirSync(contractsDirAbs(), { recursive: true });
}
export function writeContract(probe, observation) {
    if (observation.exitCode === null || observation.exitCode === undefined) {
        throw new Error('Cannot write contract: probe has not been executed successfully');
    }
    const probeName = probeNameFromProbe(probe);
    const acceptedAt = new Date().toISOString();
    const contract = {
        probe: probeName,
        command: probe.args.join(' '),
        accepted_at: acceptedAt,
        accepted_by: packageVersionLabel(),
        observations: {
            exit_code: observation.exitCode,
            stdout: storeOutput(observation.stdout),
            stderr: storeOutput(observation.stderr),
        },
        notes: '',
    };
    ensureContractsDir();
    const filePath = contractFileAbs(probeName);
    const header = `# Echo Contract — accepted ${acceptedAt}\n`;
    const body = yamlDump(contract, { lineWidth: 120, noRefs: true });
    writeFileSync(filePath, header + body, 'utf8');
    return contractPath(probeName);
}
export function readContract(probeName) {
    const filePath = contractFileAbs(probeName);
    if (!existsSync(filePath)) {
        return null;
    }
    const raw = readFileSync(filePath, 'utf8');
    const withoutHeader = raw.replace(/^#.*\n/, '');
    const parsed = yamlLoad(withoutHeader);
    if (!parsed || typeof parsed !== 'object') {
        throw new Error(`Corrupted contract file: ${filePath}`);
    }
    return parsed;
}
export function listContracts() {
    const dir = contractsDirAbs();
    if (!existsSync(dir)) {
        return [];
    }
    return readdirSync(dir)
        .filter((name) => name.endsWith('.yml'))
        .map((name) => name.slice(0, -4))
        .sort();
}
export function compareToContract(contract, observation) {
    const exitCodeMatch = observation.exitCode !== null &&
        observation.exitCode === contract.observations.exit_code;
    const expectedStdout = outputValue(contract.observations.stdout);
    const expectedStderr = outputValue(contract.observations.stderr);
    const actualStdout = outputValue(observation.stdout);
    const actualStderr = outputValue(observation.stderr);
    const stdoutMatch = areEquivalent(expectedStdout, actualStdout);
    const stderrMatch = areEquivalent(expectedStderr, actualStderr);
    const emptyDiff = (text) => ({
        added: [],
        removed: [],
        changed: [],
        unchanged: text === '' ? 0 : text.split('\n').length,
    });
    const stdoutDiff = stdoutMatch
        ? emptyDiff(expectedStdout)
        : structuredDiff(expectedStdout, actualStdout);
    const stderrDiff = stderrMatch
        ? emptyDiff(expectedStderr)
        : structuredDiff(expectedStderr, actualStderr);
    const notes = [];
    if (!exitCodeMatch) {
        notes.push(`Exit code was ${observation.exitCode ?? 'unknown'}, contract expects ${contract.observations.exit_code}`);
    }
    if (!stdoutMatch) {
        const parts = [];
        if (stdoutDiff.removed.length > 0) {
            parts.push(`${stdoutDiff.removed.length} line(s) removed`);
        }
        if (stdoutDiff.added.length > 0) {
            parts.push(`${stdoutDiff.added.length} line(s) added`);
        }
        if (stdoutDiff.changed.length > 0) {
            parts.push(`${stdoutDiff.changed.length} line(s) changed`);
        }
        notes.push(parts.length > 0
            ? `Stdout drifted: ${parts.join(', ')}`
            : 'Stdout drifted from accepted contract');
    }
    if (!stderrMatch) {
        const parts = [];
        if (stderrDiff.removed.length > 0) {
            parts.push(`${stderrDiff.removed.length} line(s) removed`);
        }
        if (stderrDiff.added.length > 0) {
            parts.push(`${stderrDiff.added.length} line(s) added`);
        }
        if (stderrDiff.changed.length > 0) {
            parts.push(`${stderrDiff.changed.length} line(s) changed`);
        }
        notes.push(parts.length > 0
            ? `Stderr drifted: ${parts.join(', ')}`
            : 'Stderr drifted from accepted contract');
    }
    return {
        matches: exitCodeMatch && stdoutMatch && stderrMatch,
        exitCodeMatch,
        stdoutMatch,
        stderrMatch,
        notes,
        stdoutDiff,
        stderrDiff,
    };
}
export function contractBehaviorSummary(contract) {
    const stderr = contract.observations.stderr === null ||
        contract.observations.stderr.replace(/\s+$/, '') === ''
        ? 'empty'
        : 'present';
    return `exit ${contract.observations.exit_code}, stderr ${stderr}`;
}
