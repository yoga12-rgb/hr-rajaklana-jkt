import { readFileSync } from 'node:fs';

const [reportPath, suite] = process.argv.slice(2);
if (!reportPath || !['live-mock', 'demo-pwa'].includes(suite)) {
  throw new Error('Usage: node check-browser-report.mjs <playwright-json-report> <live-mock|demo-pwa>');
}

const required = {
  'live-mock': [
    ['BR01/BR02/action gate', 'SEC31 browser SDK refresh leaves populated leave and employee forms mounted with their original input nodes'],
    ['BR03a/BR03b/BR04/BR05/BR10', 'SEC31 browser SDK keeps the case draft and live camera through two rotations during delayed Realtime removal, then accepts the newest event and exact persisted retry'],
    ['BR09 roster replay', 'live UI persists and replays the original payload/key after reload when reconciliation failed'],
    ['BR07 revoked session', 'revoked live session fails closed before protected reads'],
    ['BR11 planning replay', 'Planning restores an ambiguous interval request, retries its exact body, then preserves an edit during an external refresh conflict']
  ],
  'demo-pwa': [
    ['PWA offline shell', 'production PWA installs a shell cache, excludes dynamic responses and opens offline'],
    ['camera/GPS biometric clock-in', 'cashier attendance requires inside GPS and new camera selfie; clock out checks location again']
  ]
};

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const stats = report.stats;
if (!stats || stats.expected < 1 || stats.skipped !== 0 || stats.unexpected !== 0 || stats.flaky !== 0) {
  throw new Error(`Browser ${suite} incomplete: ${JSON.stringify(stats)}`);
}

const titles = [];
function visit(suites = []) {
  for (const item of suites) {
    if (item.title) titles.push(item.title);
    for (const spec of item.specs ?? []) if (spec.title) titles.push(spec.title);
    visit(item.suites ?? []);
  }
}
visit(report.suites);

const missing = required[suite].filter(([, fragment]) => !titles.some(title => title.includes(fragment)));
if (missing.length) throw new Error(`Browser ${suite} report is missing required acceptance scenarios: ${missing.map(([id]) => id).join(', ')}`);

console.log(`Browser ${suite}: ${stats.expected} passed, 0 skipped/flaky/unexpected; required acceptance: ${required[suite].map(([id]) => id).join('; ')}`);
