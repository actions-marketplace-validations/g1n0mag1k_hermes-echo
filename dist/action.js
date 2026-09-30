import * as core from '@actions/core';
import { Octokit } from '@octokit/rest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { installProject } from './install.js';
import { runDoctor, formatDoctorReport } from './doctor.js';
import { discoverProbes } from './discover.js';
import { executeProbe } from './execute.js';
import { diffObservations } from './diff.js';
import { compareToContract, contractBehaviorSummary, listContracts, probeNameFromProbe, readContract, } from './contracts.js';
import { generateComment, upsertPRComment, } from './github.js';
function execGit(args, cwd) {
    return new Promise((resolve) => {
        let stderr = '';
        const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', () => resolve({ code: null, stderr }));
        child.on('close', (code) => resolve({ code, stderr }));
    });
}
async function readEventPayload() {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath)
        return null;
    try {
        const raw = await fs.readFile(eventPath, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
async function resolvePullRequest() {
    const payload = await readEventPayload();
    if (!payload || payload.pull_request === undefined)
        return null;
    const pr = payload.pull_request;
    const repo = payload.repository;
    return {
        owner: repo.owner.login,
        repo: repo.name,
        number: pr.number,
        baseSha: pr.base.sha,
    };
}
async function runProbesAtGitRef(repoRoot, ref, probes) {
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-echo-base-'));
    const add = await execGit(['worktree', 'add', '--detach', worktree, ref], repoRoot);
    if (add.code !== 0) {
        throw new Error(`git worktree add failed: ${add.stderr}`);
    }
    try {
        const install = await installProject(worktree);
        if (!install.success) {
            throw new Error(install.error ?? 'Failed to install base revision');
        }
        const previousCwd = process.cwd();
        process.chdir(worktree);
        try {
            const observations = [];
            for (const probe of probes) {
                observations.push(await executeProbe(probe, { commit: ref }));
            }
            return observations;
        }
        finally {
            process.chdir(previousCwd);
        }
    }
    finally {
        await execGit(['worktree', 'remove', '--force', worktree], repoRoot);
    }
}
function buildContractStatuses(probes, headObservations) {
    const statuses = [];
    const names = listContracts();
    for (const name of names) {
        const contract = readContract(name);
        if (!contract)
            continue;
        const index = probes.findIndex((p) => probeNameFromProbe(p) === name);
        const observation = index >= 0 ? headObservations[index] : null;
        const behavior = contractBehaviorSummary(contract);
        if (!observation) {
            statuses.push({
                probe: name,
                matches: false,
                notes: ['Probe was not executed in this run'],
                behavior,
            });
            continue;
        }
        const comparison = compareToContract(contract, observation);
        statuses.push({
            probe: name,
            matches: comparison.matches,
            notes: comparison.notes,
            behavior,
            ...(comparison.stdoutMatch
                ? {}
                : {
                    expectedStdout: contract.observations.stdout ?? '',
                    actualStdout: observation.stdout,
                    stdoutDiff: comparison.stdoutDiff,
                }),
            ...(comparison.stderrMatch
                ? {}
                : {
                    expectedStderr: contract.observations.stderr ?? '',
                    actualStderr: observation.stderr,
                    stderrDiff: comparison.stderrDiff,
                }),
        });
    }
    return statuses;
}
function applyContractViolations(receipts, contractStatuses) {
    const drifted = new Set(contractStatuses.filter((c) => !c.matches).map((c) => c.probe));
    if (drifted.size === 0)
        return receipts;
    return receipts.map((receipt) => {
        const name = probeNameFromProbe(receipt.probe);
        if (!drifted.has(name))
            return receipt;
        return { ...receipt, classification: 'contract_violation' };
    });
}
async function run() {
    const command = core.getInput('command', { required: true });
    const token = core.getInput('github-token') || process.env.GITHUB_TOKEN || '';
    const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd();
    process.chdir(repoRoot);
    core.info('Installing project for Hermes Echo…');
    const install = await installProject(repoRoot);
    if (!install.success) {
        core.setFailed(install.error ?? 'Could not install project');
        return;
    }
    core.info('Running doctor…');
    const report = await runDoctor(command, repoRoot);
    if (!report.ready) {
        core.info(formatDoctorReport(report));
        core.setFailed('Hermes Echo doctor checks did not pass');
        return;
    }
    const discovery = await discoverProbes(command, repoRoot);
    const headCommit = process.env.GITHUB_SHA || 'unknown';
    const headObservations = [];
    for (const probe of discovery.probes) {
        headObservations.push(await executeProbe(probe, { commit: headCommit }));
    }
    let baseObservations = null;
    const pr = await resolvePullRequest();
    const baseSha = pr?.baseSha ||
        process.env.GITHUB_BASE_SHA ||
        process.env.GITHUB_EVENT_PULL_REQUEST_BASE_SHA;
    if (baseSha && baseSha !== headCommit) {
        try {
            core.info(`Running probes at base ${baseSha}…`);
            baseObservations = await runProbesAtGitRef(repoRoot, baseSha, discovery.probes);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            core.warning(`Could not run base comparison: ${message}`);
        }
    }
    let receipts = discovery.probes.map((probe, index) => {
        const head = headObservations[index];
        const base = baseObservations?.[index] ?? head;
        return diffObservations(probe, base, head);
    });
    const contractStatuses = buildContractStatuses(discovery.probes, headObservations);
    receipts = applyContractViolations(receipts, contractStatuses);
    const comment = generateComment(receipts, contractStatuses);
    await core.summary.addRaw(comment).write();
    if (pr && token) {
        const octokit = new Octokit({ auth: token });
        await upsertPRComment(octokit, pr.owner, pr.repo, pr.number, comment);
    }
    const hasChanges = receipts.some((r) => r.classification === 'possible_change' ||
        r.classification === 'contract_violation') || contractStatuses.some((c) => !c.matches);
    if (hasChanges) {
        core.setFailed('Hermes Echo detected behavioral changes or contract drift');
    }
    else {
        core.info('Hermes Echo verified — no unexplained behavioral changes');
    }
}
run().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    core.setFailed(message);
});
