import { describe, test, expect, vi } from 'vitest';
import { formatDemoOutput, formatNotReadyComment, handleDoctor, handleRun, parseRepoName, parseRunEnv, RUN_GUIDANCE_LINES, } from './cli.js';
import { HERMES_ECHO_MARKER } from './github.js';
function mockObservation(overrides = {}) {
    const args = overrides.args ?? ['testcli', '--help'];
    const { args: _args, probe: _probe, ...rest } = overrides;
    return {
        probe: {
            args,
            confidence: 90,
            source: 'baseline',
            ...(overrides.probe ?? {}),
        },
        exitCode: 0,
        stdout: 'usage: testcli',
        stderr: '',
        stdoutNormalized: 'usage: testcli',
        stderrNormalized: '',
        timedOut: false,
        skipped: false,
        durationMs: 10,
        environment: {
            platform: 'linux',
            commit: 'abc',
            timestamp: '2026-01-01T00:00:00.000Z',
        },
        ...rest,
    };
}
function mockProbe(args = ['testcli', '--help']) {
    return { args, confidence: 90, source: 'baseline' };
}
function fullRunEnv(overrides = {}) {
    return {
        GITHUB_TOKEN: 'gh-token',
        GITHUB_REPOSITORY: 'owner/repo',
        PR_NUMBER: '42',
        BASE_SHA: 'base-sha',
        HEAD_SHA: 'head-sha',
        GITHUB_WORKSPACE: '/tmp/workspace',
        ...overrides,
    };
}
function readyReport() {
    return {
        checks: [],
        ready: true,
        probeCount: 2,
        qualifyingProbeCount: 2,
        estimatedRuntimeSeconds: 10,
    };
}
describe('formatDemoOutput', () => {
    test('includes repo banner and baseline footer', () => {
        const output = formatDemoOutput('hermes-echo', [
            mockObservation({ args: ['testcli', '--help'] }),
        ]);
        expect(output).toContain('HERMES ECHO DEMO — hermes-echo');
        expect(output).toContain('ECHO BASELINE ESTABLISHED');
        expect(output).toContain('1 behavioral observations captured');
        expect(output).toContain('uses: g1n0mag1k/hermes-echo@v1');
    });
    test('renders raw observation fields and truncates to 80 chars', () => {
        const longStdout = 'S'.repeat(100);
        const longStderr = 'E'.repeat(100);
        const output = formatDemoOutput('demo-repo', [
            mockObservation({
                args: ['testcli', 'validate', 'fixtures/valid.yml'],
                exitCode: 1,
                stdout: longStdout,
                stderr: longStderr,
            }),
        ]);
        expect(output).toContain('[testcli validate fixtures/valid.yml]  ✓ observation captured');
        expect(output).toContain('exit: 1');
        expect(output).toContain(`stdout: ${'S'.repeat(80)}`);
        expect(output).toContain(`stderr: ${'E'.repeat(80)}`);
        expect(output).not.toContain('S'.repeat(81));
    });
    test('shows (empty) for blank stdout and stderr', () => {
        const output = formatDemoOutput('empty-repo', [
            mockObservation({ stdout: '', stderr: '' }),
        ]);
        expect(output).toContain('stdout: (empty)');
        expect(output).toContain('stderr: (empty)');
    });
    test('reports discovered probe count', () => {
        const output = formatDemoOutput('count-repo', [
            mockObservation({ args: ['a'] }),
            mockObservation({ args: ['b'] }),
            mockObservation({ args: ['c'] }),
        ]);
        expect(output).toContain('Discovered 3 echo probes');
        expect(output).toContain('3 behavioral observations captured');
    });
});
describe('handleDoctor', () => {
    test('prints formatDoctorReport output and exits 0 when ready', async () => {
        const report = {
            checks: [],
            ready: true,
            probeCount: 5,
            qualifyingProbeCount: 3,
            estimatedRuntimeSeconds: 15,
        };
        const formatDoctorReport = vi.fn(() => 'formatted doctor report');
        const runDoctor = vi.fn(async () => report);
        const detectPackageTarget = vi.fn(async () => ({
            packageRoot: process.cwd(),
            command: 'testcli',
        }));
        const logs = [];
        const code = await handleDoctor(process.cwd(), {
            runDoctor,
            formatDoctorReport,
            detectPackageTarget,
            log: (msg) => logs.push(msg),
            chdir: () => { },
            getCwd: () => process.cwd(),
        });
        expect(formatDoctorReport).toHaveBeenCalledWith(report);
        expect(logs).toEqual(['formatted doctor report']);
        expect(code).toBe(0);
    });
    test('exits 1 when doctor reports not ready', async () => {
        const report = {
            checks: [],
            ready: false,
            probeCount: 0,
            qualifyingProbeCount: 0,
            estimatedRuntimeSeconds: 0,
        };
        const formatDoctorReport = vi.fn(() => 'not ready report');
        const runDoctor = vi.fn(async () => report);
        const detectPackageTarget = vi.fn(async () => ({
            packageRoot: process.cwd(),
            command: 'testcli',
        }));
        const code = await handleDoctor(process.cwd(), {
            runDoctor,
            formatDoctorReport,
            detectPackageTarget,
            log: () => { },
            chdir: () => { },
            getCwd: () => process.cwd(),
        });
        expect(formatDoctorReport).toHaveBeenCalledWith(report);
        expect(code).toBe(1);
    });
});
describe('parseRunEnv', () => {
    test('reports missing GITHUB_TOKEN', () => {
        const result = parseRunEnv(fullRunEnv({ GITHUB_TOKEN: '' }));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.missing).toContain('GITHUB_TOKEN');
        }
    });
    test('reports missing GITHUB_REPOSITORY', () => {
        const env = fullRunEnv();
        delete env.GITHUB_REPOSITORY;
        const result = parseRunEnv(env);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.missing).toContain('GITHUB_REPOSITORY');
        }
    });
    test('parses optional thresholds with defaults', () => {
        const result = parseRunEnv(fullRunEnv());
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.CONFIDENCE_THRESHOLD).toBe(70);
            expect(result.value.MAX_PROBES).toBe(30);
        }
    });
});
describe('handleRun', () => {
    test('missing GITHUB_TOKEN logs clear error and exits 1', async () => {
        const logs = [];
        const errors = [];
        const env = fullRunEnv();
        delete env.GITHUB_TOKEN;
        const code = await handleRun({
            env,
            log: (msg) => logs.push(msg),
            error: (msg) => errors.push(msg),
        });
        expect(code).toBe(1);
        expect(logs).toEqual([...RUN_GUIDANCE_LINES]);
        expect(errors.some((e) => e.includes('GITHUB_TOKEN'))).toBe(true);
    });
    test('missing GITHUB_REPOSITORY logs clear error and exits 1', async () => {
        const errors = [];
        const env = fullRunEnv();
        delete env.GITHUB_REPOSITORY;
        const code = await handleRun({
            env,
            log: () => { },
            error: (msg) => errors.push(msg),
        });
        expect(code).toBe(1);
        expect(errors.some((e) => e.includes('GITHUB_REPOSITORY'))).toBe(true);
    });
    test('no Actions env at all prints guidance and exits 0', async () => {
        const logs = [];
        const errors = [];
        const code = await handleRun({
            env: {},
            log: (msg) => logs.push(msg),
            error: (msg) => errors.push(msg),
        });
        expect(code).toBe(0);
        expect(logs).toEqual([...RUN_GUIDANCE_LINES]);
        expect(errors.some((e) => e.includes('GITHUB_TOKEN'))).toBe(true);
    });
    test('doctor ready:false posts not-ready comment and exits 0', async () => {
        const report = {
            checks: [],
            ready: false,
            probeCount: 0,
            qualifyingProbeCount: 0,
            estimatedRuntimeSeconds: 0,
        };
        const upsertPRComment = vi.fn(async () => { });
        const formatDoctorReport = vi.fn(() => 'doctor failed detail');
        const discoverProbes = vi.fn();
        const installProject = vi.fn();
        const executeProbe = vi.fn();
        const code = await handleRun({
            env: fullRunEnv(),
            log: () => { },
            error: () => { },
            detectPackageTarget: async () => ({
                packageRoot: '/tmp/workspace',
                command: 'testcli',
            }),
            runDoctor: async () => report,
            formatDoctorReport,
            discoverProbes,
            installProject,
            executeProbe,
            upsertPRComment,
            chdir: () => { },
            getCwd: () => '/tmp',
        });
        expect(code).toBe(0);
        expect(discoverProbes).not.toHaveBeenCalled();
        expect(installProject).not.toHaveBeenCalled();
        expect(executeProbe).not.toHaveBeenCalled();
        expect(upsertPRComment).toHaveBeenCalledTimes(1);
        const [, , , body] = upsertPRComment.mock.calls[0];
        expect(body).toContain(HERMES_ECHO_MARKER);
        expect(body).toContain('Could not run');
        expect(body).toContain('doctor failed detail');
    });
    test('full happy path calls diffObservations and upsertPRComment', async () => {
        const probe = mockProbe(['testcli', '--help']);
        const baseObs = mockObservation({
            args: probe.args,
            exitCode: 0,
            stdout: 'ok',
            stdoutNormalized: 'ok',
        });
        const headObs = mockObservation({
            args: probe.args,
            exitCode: 0,
            stdout: 'ok',
            stdoutNormalized: 'ok',
        });
        const diffObservations = vi.fn(() => ({
            id: 'abc',
            probe,
            observation: headObs,
            classification: 'unchanged',
            generatedAt: '2026-01-01T00:00:00.000Z',
        }));
        const generateComment = vi.fn(() => 'comment-body');
        const upsertPRComment = vi.fn(async () => { });
        const gitCheckout = vi.fn(async () => true);
        const executeProbe = vi
            .fn()
            .mockResolvedValueOnce(headObs)
            .mockResolvedValueOnce(baseObs);
        const code = await handleRun({
            env: fullRunEnv(),
            log: () => { },
            error: () => { },
            detectPackageTarget: async () => ({
                packageRoot: '/tmp/workspace',
                command: 'testcli',
            }),
            runDoctor: async () => readyReport(),
            formatDoctorReport: () => 'ready',
            discoverProbes: async () => ({
                probes: [probe],
                skipped: [],
                discoveredSubcommands: [],
                totalCandidates: 1,
            }),
            installProject: async () => ({
                success: true,
                strategy: 'pip install -e',
                durationMs: 1,
            }),
            executeProbe,
            diffObservations,
            generateComment,
            upsertPRComment,
            gitCheckout,
            chdir: () => { },
            getCwd: () => '/tmp',
        });
        expect(code).toBe(0);
        expect(gitCheckout).toHaveBeenCalledWith('base-sha', '/tmp/workspace');
        expect(gitCheckout).toHaveBeenCalledWith('head-sha', '/tmp/workspace');
        expect(diffObservations).toHaveBeenCalledWith(probe, baseObs, headObs);
        expect(generateComment).toHaveBeenCalled();
        expect(upsertPRComment).toHaveBeenCalledWith('gh-token', 'owner/repo', 42, 'comment-body');
    });
    test('ECHO VERIFIED path — comment contains ECHO VERIFIED', async () => {
        const probe = mockProbe();
        const obs = mockObservation({
            args: probe.args,
            stdout: 'same',
            stdoutNormalized: 'same',
        });
        const upsertPRComment = vi.fn(async () => { });
        const code = await handleRun({
            env: fullRunEnv(),
            log: () => { },
            error: () => { },
            detectPackageTarget: async () => ({
                packageRoot: '/tmp/workspace',
                command: 'testcli',
            }),
            runDoctor: async () => readyReport(),
            formatDoctorReport: () => 'ready',
            discoverProbes: async () => ({
                probes: [probe],
                skipped: [],
                discoveredSubcommands: [],
                totalCandidates: 1,
            }),
            installProject: async () => ({
                success: true,
                durationMs: 1,
            }),
            executeProbe: async () => obs,
            upsertPRComment,
            gitCheckout: async () => true,
            chdir: () => { },
            getCwd: () => '/tmp',
        });
        expect(code).toBe(0);
        const body = upsertPRComment.mock.calls[0][3];
        expect(body).toContain('ECHO VERIFIED');
    });
    test('ECHO DETECTED A CHANGE path — comment contains ECHO DETECTED A CHANGE', async () => {
        const probe = mockProbe(['testcli', 'validate', 'x.yml']);
        const baseObs = mockObservation({
            args: probe.args,
            exitCode: 0,
            stdout: 'ok',
            stdoutNormalized: 'ok',
            stderr: '',
            stderrNormalized: '',
        });
        const headObs = mockObservation({
            args: probe.args,
            exitCode: 1,
            stdout: 'ok',
            stdoutNormalized: 'ok',
            stderr: 'Missing region: field region is required',
            stderrNormalized: 'Missing region: field region is required',
        });
        const upsertPRComment = vi.fn(async () => { });
        const executeProbe = vi
            .fn()
            .mockResolvedValueOnce(headObs)
            .mockResolvedValueOnce(baseObs);
        const code = await handleRun({
            env: fullRunEnv(),
            log: () => { },
            error: () => { },
            detectPackageTarget: async () => ({
                packageRoot: '/tmp/workspace',
                command: 'testcli',
            }),
            runDoctor: async () => readyReport(),
            formatDoctorReport: () => 'ready',
            discoverProbes: async () => ({
                probes: [probe],
                skipped: [],
                discoveredSubcommands: [],
                totalCandidates: 1,
            }),
            installProject: async () => ({
                success: true,
                durationMs: 1,
            }),
            executeProbe,
            upsertPRComment,
            gitCheckout: async () => true,
            chdir: () => { },
            getCwd: () => '/tmp',
        });
        expect(code).toBe(0);
        const body = upsertPRComment.mock.calls[0][3];
        expect(body).toContain('ECHO DETECTED A CHANGE');
    });
    test('formatNotReadyComment includes marker and doctor report', () => {
        const body = formatNotReadyComment('  ❌ Python not found');
        expect(body).toContain(HERMES_ECHO_MARKER);
        expect(body).toContain('Could not run');
        expect(body).toContain('Python not found');
    });
    test('reads INPUT_GITHUB_TOKEN when GITHUB_TOKEN is absent', async () => {
        const errors = [];
        const env = fullRunEnv();
        delete env.GITHUB_TOKEN;
        env.INPUT_GITHUB_TOKEN = 'from-action-input';
        const upsertPRComment = vi.fn(async () => { });
        const code = await handleRun({
            env,
            log: () => { },
            error: (msg) => errors.push(msg),
            detectPackageTarget: async () => null,
            upsertPRComment,
            chdir: () => { },
            getCwd: () => '/tmp',
        });
        expect(code).toBe(0);
        expect(errors.some((e) => e.includes('GITHUB_TOKEN'))).toBe(false);
        expect(upsertPRComment).toHaveBeenCalledWith('from-action-input', 'owner/repo', 42, expect.stringContaining('Could not run'));
    });
});
describe('parseRepoName', () => {
    test('extracts repo name from GitHub URL', () => {
        expect(parseRepoName('https://github.com/g1n0mag1k/hermes-echo')).toBe('hermes-echo');
        expect(parseRepoName('https://github.com/g1n0mag1k/hermes-echo.git')).toBe('hermes-echo');
    });
});
