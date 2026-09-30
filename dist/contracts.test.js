import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contractPath, ensureContractsDir, writeContract, readContract, listContracts, compareToContract, probeName, CONTRACTS_DIR, } from './contracts.js';
import { normalize } from './normalize.js';
function makeProbe(args = ['testcli', 'validate']) {
    return { args, confidence: 90, source: 'baseline' };
}
function makeObservation(overrides = {}) {
    const probe = overrides.probe ?? makeProbe();
    return {
        probe,
        exitCode: 0,
        stdout: 'Configuration valid',
        stderr: '',
        stdoutNormalized: normalize(overrides.stdout ?? 'Configuration valid'),
        stderrNormalized: normalize(overrides.stderr ?? ''),
        timedOut: false,
        skipped: false,
        durationMs: 10,
        environment: {
            platform: 'linux',
            commit: 'abc',
            timestamp: '2026-01-01T00:00:00.000Z',
        },
        ...overrides,
    };
}
describe('contracts', () => {
    let tmpDir;
    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-contracts-'));
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    test('contractPath() returns correct path', () => {
        expect(contractPath('validate')).toBe(path.join(CONTRACTS_DIR, 'validate.yml'));
    });
    test('contractPath() sanitizes probe names (invalid chars throw)', () => {
        expect(() => contractPath('validate/foo')).toThrow(/Invalid probe name/);
        expect(() => contractPath('has spaces')).toThrow(/Invalid probe name/);
        expect(() => contractPath('a.b')).toThrow(/Invalid probe name/);
    });
    test('contractPath() throws on empty probe name', () => {
        expect(() => contractPath('')).toThrow(/must not be empty/);
        expect(() => contractPath('   ')).toThrow(/must not be empty/);
    });
    test('ensureContractsDir() creates directory if missing', () => {
        const dir = path.join(tmpDir, CONTRACTS_DIR);
        expect(fs.existsSync(dir)).toBe(false);
        ensureContractsDir(tmpDir);
        expect(fs.existsSync(dir)).toBe(true);
    });
    test('ensureContractsDir() is idempotent (does not throw if exists)', () => {
        ensureContractsDir(tmpDir);
        expect(() => ensureContractsDir(tmpDir)).not.toThrow();
        expect(fs.existsSync(path.join(tmpDir, CONTRACTS_DIR))).toBe(true);
    });
    test('writeContract() writes a valid YAML file', () => {
        const probe = makeProbe(['testcli', 'validate']);
        const observation = makeObservation({ probe });
        const written = writeContract(probe, observation, { baseDir: tmpDir });
        expect(written).toBe(path.join(tmpDir, CONTRACTS_DIR, 'validate.yml'));
        expect(fs.existsSync(written)).toBe(true);
        const content = fs.readFileSync(written, 'utf8');
        expect(content).toContain('# Echo Contract — accepted');
        expect(content).toContain('probe: validate');
    });
    test('writeContract() file contains correct exit_code, accepted_at, command', () => {
        const probe = makeProbe(['testcli', 'validate', 'fixtures/valid.yml']);
        const observation = makeObservation({
            probe,
            exitCode: 0,
            stdout: 'Configuration valid',
            stderr: '',
        });
        const before = Date.now();
        const written = writeContract(probe, observation, { baseDir: tmpDir });
        const after = Date.now();
        const contract = readContract(probeName(probe), tmpDir);
        expect(contract).not.toBeNull();
        expect(contract.observations.exit_code).toBe(0);
        expect(contract.command).toBe('testcli validate fixtures/valid.yml');
        expect(contract.accepted_by).toBe('hermes-echo v0.1.0');
        expect(contract.observations.stdout_pattern).toBe('Configuration valid');
        expect(contract.observations.stderr_empty).toBe(true);
        const acceptedAt = Date.parse(contract.accepted_at);
        expect(acceptedAt).toBeGreaterThanOrEqual(before - 1000);
        expect(acceptedAt).toBeLessThanOrEqual(after + 1000);
        expect(written).toContain('validate-fixtures-valid-yml.yml');
    });
    test('writeContract() stores null stdout_pattern when stdout is empty', () => {
        const probe = makeProbe(['testcli', 'validate']);
        const observation = makeObservation({ probe, stdout: '' });
        writeContract(probe, observation, { baseDir: tmpDir });
        const contract = readContract('validate', tmpDir);
        expect(contract.observations.stdout_pattern).toBeNull();
    });
    test('writeContract() throws when exitCode is null', () => {
        const probe = makeProbe();
        const observation = makeObservation({ probe, exitCode: null });
        expect(() => writeContract(probe, observation, { baseDir: tmpDir })).toThrow(/exitCode is missing/);
    });
    test('readContract() returns null for missing file', () => {
        expect(readContract('missing-probe', tmpDir)).toBeNull();
    });
    test('readContract() returns parsed contract for existing file', () => {
        const probe = makeProbe(['testcli', 'process']);
        writeContract(probe, makeObservation({ probe, exitCode: 1, stderr: 'err' }), { baseDir: tmpDir });
        const contract = readContract('process', tmpDir);
        expect(contract).not.toBeNull();
        expect(contract.probe).toBe('process');
        expect(contract.observations.exit_code).toBe(1);
        expect(contract.observations.stderr_empty).toBe(false);
    });
    test('readContract() throws on corrupted YAML', () => {
        ensureContractsDir(tmpDir);
        fs.writeFileSync(path.join(tmpDir, CONTRACTS_DIR, 'broken.yml'), 'probe: [unterminated\nobservations: {{{', 'utf8');
        expect(() => readContract('broken', tmpDir)).toThrow(/Failed to parse|Corrupted/);
    });
    test('listContracts() returns [] when dir does not exist', () => {
        expect(listContracts(tmpDir)).toEqual([]);
    });
    test('listContracts() returns probe names for existing contracts', () => {
        writeContract(makeProbe(['testcli', 'validate']), makeObservation(), {
            baseDir: tmpDir,
        });
        writeContract(makeProbe(['testcli', 'process']), makeObservation({ probe: makeProbe(['testcli', 'process']) }), { baseDir: tmpDir });
        expect(listContracts(tmpDir)).toEqual(['process', 'validate']);
    });
    test('compareToContract() matches when exit_code and stderr both match', () => {
        const contract = {
            probe: 'validate',
            command: 'testcli validate',
            accepted_at: '2026-01-01T00:00:00.000Z',
            accepted_by: 'hermes-echo v0.1.0',
            observations: {
                exit_code: 0,
                stdout_pattern: 'ok',
                stderr_empty: true,
            },
            notes: '',
        };
        const result = compareToContract(contract, makeObservation({ exitCode: 0, stderr: '' }));
        expect(result.matches).toBe(true);
        expect(result.exitCodeMatch).toBe(true);
        expect(result.stderrMatch).toBe(true);
        expect(result.notes).toEqual([]);
    });
    test('compareToContract() detects exit_code mismatch', () => {
        const contract = {
            probe: 'validate',
            command: 'testcli validate',
            accepted_at: '2026-01-01T00:00:00.000Z',
            accepted_by: 'hermes-echo v0.1.0',
            observations: {
                exit_code: 0,
                stdout_pattern: null,
                stderr_empty: true,
            },
            notes: '',
        };
        const result = compareToContract(contract, makeObservation({ exitCode: 1, stderr: '' }));
        expect(result.matches).toBe(false);
        expect(result.exitCodeMatch).toBe(false);
        expect(result.stderrMatch).toBe(true);
        expect(result.notes.some((n) => n.includes('exit_code'))).toBe(true);
    });
    test('compareToContract() detects stderr_empty mismatch', () => {
        const contract = {
            probe: 'validate',
            command: 'testcli validate',
            accepted_at: '2026-01-01T00:00:00.000Z',
            accepted_by: 'hermes-echo v0.1.0',
            observations: {
                exit_code: 0,
                stdout_pattern: null,
                stderr_empty: true,
            },
            notes: '',
        };
        const result = compareToContract(contract, makeObservation({ exitCode: 0, stderr: 'Missing region' }));
        expect(result.matches).toBe(false);
        expect(result.exitCodeMatch).toBe(true);
        expect(result.stderrMatch).toBe(false);
        expect(result.notes.some((n) => n.includes('stderr_empty'))).toBe(true);
    });
    test('compareToContract() returns human-readable notes on mismatch', () => {
        const contract = {
            probe: 'validate',
            command: 'testcli validate',
            accepted_at: '2026-01-01T00:00:00.000Z',
            accepted_by: 'hermes-echo v0.1.0',
            observations: {
                exit_code: 0,
                stdout_pattern: null,
                stderr_empty: true,
            },
            notes: '',
        };
        const result = compareToContract(contract, makeObservation({ exitCode: 2, stderr: 'boom' }));
        expect(result.matches).toBe(false);
        expect(result.notes.length).toBe(2);
        expect(result.notes[0]).toMatch(/exit_code: contract expects 0, observed 2/);
        expect(result.notes[1]).toMatch(/stderr_empty: contract expects true, observed false/);
    });
});
