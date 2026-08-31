const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STATE = Object.freeze({ schemaVersion:1, pagesPerDocument:80, consecutiveLongRuns:0, consecutiveHealthyRuns:0, lastDurationSeconds:null, lastOutcome:null, updatedAt:null });
function validate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Adaptive throughput state must be an object.');
  const keys = Object.keys(DEFAULT_STATE); const extras = Object.keys(value).filter((key) => !keys.includes(key));
  if (extras.length || value.schemaVersion !== 1 || ![40, 80].includes(value.pagesPerDocument)) throw new Error('Adaptive throughput state is invalid.');
  for (const key of ['consecutiveLongRuns', 'consecutiveHealthyRuns']) if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw new Error('Adaptive throughput counters are invalid.');
  if (value.lastDurationSeconds !== null && (!Number.isFinite(value.lastDurationSeconds) || value.lastDurationSeconds < 0)) throw new Error('Adaptive throughput duration is invalid.');
  if (value.lastOutcome !== null && !['healthy', 'long', 'timed_out'].includes(value.lastOutcome)) throw new Error('Adaptive throughput outcome is invalid.');
  if (value.updatedAt !== null && !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('Adaptive throughput timestamp is invalid.');
  return structuredClone(value);
}
function read(file) { return fs.existsSync(file) ? validate(JSON.parse(fs.readFileSync(file, 'utf8'))) : structuredClone(DEFAULT_STATE); }
function write(file, state) { const checked=validate(state); fs.mkdirSync(path.dirname(file),{recursive:true}); const temporary=`${file}.${process.pid}.tmp`; fs.writeFileSync(temporary,`${JSON.stringify(checked,null,2)}\n`,{flag:'wx',mode:0o600}); fs.renameSync(temporary,file); return checked; }
function plan(state, { previousConclusion, now = new Date().toISOString() } = {}) {
  const next=validate(state);
  if (previousConclusion === 'timed_out') { next.pagesPerDocument=40; next.consecutiveLongRuns=0; next.consecutiveHealthyRuns=0; next.lastOutcome='timed_out'; next.updatedAt=now; }
  return next;
}
function complete(state, durationSeconds, now = new Date().toISOString()) {
  const next=validate(state); if (!Number.isFinite(durationSeconds) || durationSeconds < 0) throw new Error('durationSeconds must be non-negative.');
  next.lastDurationSeconds=durationSeconds; next.updatedAt=now;
  if (durationSeconds > 900) { next.lastOutcome='long'; next.consecutiveLongRuns += 1; next.consecutiveHealthyRuns=0; if (next.consecutiveLongRuns >= 2) next.pagesPerDocument=40; }
  else { next.lastOutcome='healthy'; next.consecutiveLongRuns=0; next.consecutiveHealthyRuns += 1; if (next.pagesPerDocument === 40 && durationSeconds <= 600 && next.consecutiveHealthyRuns >= 3) { next.pagesPerDocument=80; next.consecutiveHealthyRuns=0; } }
  return next;
}
if (require.main === module) {
  const [command,file,value]=process.argv.slice(2); if (!command || !file) throw new Error('Usage: adaptive-throughput.js <plan|complete> <state-file> [previous-conclusion|duration-seconds]');
  const state=command==='plan'?plan(read(file),{previousConclusion:value}):command==='complete'?complete(read(file),Number(value)):null;
  if (!state) throw new Error('Unknown adaptive-throughput command.'); write(file,state); console.log(JSON.stringify(state));
}
module.exports={ DEFAULT_STATE, validate, read, write, plan, complete };
