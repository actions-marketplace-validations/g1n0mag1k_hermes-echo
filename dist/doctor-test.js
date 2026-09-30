import { runDoctor, formatDoctorReport } from './doctor.js';
const report = await runDoctor('testcli', '/home/g1n0mag1k/hermes-echo/testcli/base');
console.log(formatDoctorReport(report));
console.log('ready:', report.ready);
import { generateComment } from './github.js';
import { diffObservations } from './diff.js';
import { executeProbe } from './execute.js';
// Use the SAME probe args for both base and head.
// The behavioral change comes from which version of
// testcli is currently installed — base vs head.
// We simulate this by running the probe twice after
// switching which testcli is active.
// First install base and run probe
import { execSync } from 'child_process';
execSync('pip install -e /home/g1n0mag1k/hermes-echo/testcli/base --quiet');
const probe = {
    args: ['testcli', 'validate', 'testcli/base/fixtures/valid.yml'],
    confidence: 70,
    source: 'fixture'
};
const baseObs = await executeProbe(probe, { commit: 'base-sha' });
// Now install head and run same probe
execSync('pip install -e /home/g1n0mag1k/hermes-echo/testcli/head --quiet');
const headObs = await executeProbe(probe, { commit: 'head-sha' });
// Restore base
execSync('pip install -e /home/g1n0mag1k/hermes-echo/testcli/base --quiet');
const receipt = diffObservations(probe, baseObs, headObs);
const comment = generateComment([receipt]);
console.log('\n--- COMMENT PREVIEW ---\n');
console.log(comment);
