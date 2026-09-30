import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dump as yamlDump, load as yamlLoad } from 'js-yaml';
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
export function probeNameFromProbe(probe) {
    const subcommand = probe.args[1];
    if (!subcommand || subcommand === '--help') {
        return 'help';
    }
    return subcommand;
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
function stdoutPattern(stdout) {
    const trimmed = stdout.replace(/\n+$/, '');
    if (trimmed === '')
        return null;
    return trimmed.slice(0, 60);
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
            stdout_pattern: stdoutPattern(observation.stdout),
            stderr_empty: observation.stderr.replace(/\s+$/, '') === '',
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
    const stderrEmpty = observation.stderr.replace(/\s+$/, '') === '';
    const stderrMatch = stderrEmpty === contract.observations.stderr_empty;
    const notes = [];
    if (!exitCodeMatch) {
        notes.push(`Exit code was ${observation.exitCode ?? 'unknown'}, contract expects ${contract.observations.exit_code}`);
    }
    if (!stderrMatch) {
        const observed = stderrEmpty ? 'empty' : 'present';
        const expected = contract.observations.stderr_empty ? 'empty' : 'present';
        notes.push(`Stderr was ${observed}, contract expects ${expected}`);
    }
    return {
        matches: exitCodeMatch && stderrMatch,
        exitCodeMatch,
        stderrMatch,
        notes,
    };
}
export function contractBehaviorSummary(contract) {
    const stderr = contract.observations.stderr_empty ? 'empty' : 'present';
    return `exit ${contract.observations.exit_code}, stderr ${stderr}`;
}
