import { runDoctor, formatDoctorReport } from './doctor.js'
const report = await runDoctor(
  'testcli',
  '/home/g1n0mag1k/hermes-echo/testcli/base'
)
console.log(formatDoctorReport(report))
console.log('ready:', report.ready)
