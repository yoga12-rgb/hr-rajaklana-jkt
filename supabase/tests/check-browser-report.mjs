import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const required = {
  'live-mock': [
    ['UX-REPORT-05', 'unchanged full workspace refresh preserves the report revision and a held export completes all rows without a false data-change error'],
    ["UX-REPORT-01","server reports render 25 rows per page and export all 122 matching rows through original cursor and asOf, then apply outlet filter on server"],
    ["UX-REPORT-02","failed later export page and filter or authoritative data revision changes abort the complete CSV without a partial download"],
    ["UX-REPORT-03","session revocation and SDK token rotation during a held report export deny further protected reads and prevent any CSV download"],
    ["UX-REPORT-04","late report response from account A never publishes rows after account B replaces the live SDK session"],
    ["UX-NOTIFY-01","supervisor and outlet destinations open before held read marker; pending marker does not block another notification"],
    ["UX-NOTIFY-02","read marker failure remains visible after navigation and original notification stays unread until confirmed retry"],
    ["UX-NOTIFY-03","late notification marker from account A cannot publish feedback, read state or navigation after account B takes over"],
    ["UX-NOTIFY-04","invalid notification destination cannot navigate or mark a notification read"],
    ["UX-ATTENDANCE-01","pending attendance survives modal close and same-account SPA navigation; one RPC receipt publishes the final result"],
    ["UX-ATTENDANCE-02","closing a pending form with Escape retains the later server rejection and permits only an explicit retry"],
    ["UX-ATTENDANCE-03","account switch clears attendance operation UI and rejects a late old-account receipt without leaking its record"],
    ["UX-ATTENDANCE-04","open detail derives the current attendance ID after refresh and shows unavailable state when its record disappears"],
    ["UX-ATTENDANCE-05","lost attendance reply checks scoped history once without automatic resubmission or false success"],
    ["UX-ATTENDANCE-06","same-account token rotation retains the pending capture and lease; a guarded late receipt checks history and disables already-recorded submission"],
    ["PRIVATE-MEDIA-01","workspace hydration makes no photo or attachment signing requests; opening a selfie signs on demand and failed signing retries safely"],
    ["PRIVATE-MEDIA-02","revoked live session clears an open private photo detail and rejects its late signing response"],
    ['SELFIE-ONLY-01', 'live SDK camera/GPS clock-in needs no face reference, failed photo retry succeeds and saved attendance survives reload'],
    ['SELFIE-ONLY-02', 'revoked clock permission during pending selfie API prevents final attendance RPC and preserves account guard'],
    ['RESPONSIVE-ATTENDANCE-01', 'camera/GPS RPC confirmation updates clock-in and clock-out before held background employee reads; reload retains server result'],
    ['RESPONSIVE-ATTENDANCE-02', 'final RPC rejection never publishes optimistic attendance or success while retaining retry form'],
    ['RESPONSIVE-LOGIN-01', 'validated account reaches greeting and explicit workspace loading while operational reads are held; route actions wait for complete hydration'],
    ['BR01', 'leave form textarea and dialog remain mounted and action is rejected during session validation'],
    ['BR02', 'employee inputs and draft remain mounted after token rotation'],
    ['BR03a', 'live camera video and track identity remain connected during token rotation'],
    ['BR03b', 'captured selfie blob preview and captured context survive token rotation'],
    ['BR04', 'two token rotations during delayed channel removal leave one current owner and accept newest event'],
    ['BR05', 'terminal Realtime close joins replacement and its event triggers a data read'],
    ['BR06', 'late account-A Auth context cannot replace or expose data after SDK session switches to account B'],
    ['BR06', 'late Auth context after logout cannot republish the signed-out account'],
    ['BR07', 'revoked live session redirects to login with zero protected reads and no MFA API calls'],
    ['BR08', 'allowed token rotation plus employees 503 retains form, blocks protected write, and retry succeeds'],
    ['BR08', 'ordinary same-token employees 503 retains form, blocks cached admin action, and retry applies revoked role'],
    ['BR08', 'transient read retry with revoked latest permission clears access and performs no protected write'],
    ['BR09', 'ambiguous roster receipt keeps original baseline/key/body through token rotation, reload, and retry'],
    ['BR10', 'follow-up retry after rotation and reload sends original payload/key and commits once'],
    ['BR11-CFG', 'configuration category retry after token rotation and reload preserves original key/payload and commits once'],
    ['BR11-PLAN', 'planning retry after token rotation and reload preserves original key/body; external revision conflict keeps newer local edit']
  ],
  'demo-pwa': [
    ['PWA offline shell', 'service worker controls root scope, caches static shell only, and opens offline route'],
    ['camera/GPS selfie clock-in', 'real camera and browser geolocation satisfy same-account attendance flow without face enrollment; clock-out checks GPS again'],
    ['FACE-REMOVED-01', 'retired face verification bookmarks redirect to attendance without enrollment, reference calls or camera; profile and guide use selfie attendance']
  ]
};

function acceptanceAnnotations(report) {
  const found = [];
  function visit(suites = []) {
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          const results = test.results ?? [];
          const passed = test.expectedStatus === 'passed' && results.length > 0 && results.every(result => result.status === 'passed');
          const annotations = test.annotations ?? [];
          for (const annotation of annotations) {
            if (annotation.type === 'browser-acceptance' && typeof annotation.description === 'string') {
              found.push({ description: annotation.description, passed, specTitle: spec.title ?? '', testTitle: test.title ?? '' });
            }
          }
        }
      }
      visit(suite.suites ?? []);
    }
  }
  visit(report.suites);
  return found;
}

export function validateReport(report, suiteName) {
  if (!Object.hasOwn(required, suiteName)) throw new Error(`Unknown browser suite: ${suiteName}`);
  const stats = report?.stats;
  if (!stats || stats.expected < 1 || stats.skipped !== 0 || stats.unexpected !== 0 || stats.flaky !== 0) {
    throw new Error(`Browser ${suiteName} incomplete: ${JSON.stringify(stats)}`);
  }
  const annotations = acceptanceAnnotations(report);
  const missing = required[suiteName].filter(([id, contract]) => !annotations.some(item =>
    item.description === `${suiteName}|${id}|${contract}` && item.passed));
  if (missing.length) throw new Error(`Browser ${suiteName} report is missing passed acceptance contracts: ${missing.map(([id]) => id).join(', ')}`);
  return { expected: stats.expected, acceptance: required[suiteName].map(([id]) => id) };
}

function syntheticReport(suiteName) {
  const cases = required[suiteName].map(([id, contract]) => ({
    title: `synthetic ${id}`,
    annotations: [{ type: 'browser-acceptance', description: `${suiteName}|${id}|${contract}` }],
    expectedStatus: 'passed', results: [{ status: 'passed' }]
  }));
  return { stats: { expected: cases.length, skipped: 0, unexpected: 0, flaky: 0 },
    suites: [{ title: 'synthetic suite', specs: [{ title: 'synthetic spec', tests: cases }] }] };
}

export function runSelfTests() {
  for (const suiteName of Object.keys(required)) {
    const valid = syntheticReport(suiteName);
    assert.doesNotThrow(() => validateReport(valid, suiteName), `${suiteName} accepts complete synthetic evidence`);
    const missing = structuredClone(valid);
    missing.suites[0].specs[0].tests.pop();
    assert.throws(() => validateReport(missing, suiteName), /missing passed acceptance contracts/,
      `${suiteName} rejects a missing acceptance ID`);
    for (const field of ['expected', 'skipped', 'unexpected', 'flaky']) {
      const altered = structuredClone(valid);
      altered.stats[field] = field === 'expected' ? 0 : 1;
      assert.throws(() => validateReport(altered, suiteName), /incomplete/,
        `${suiteName} rejects stats mutation ${field}`);
    }
    const wrongSuite = suiteName === 'live-mock' ? 'demo-pwa' : 'live-mock';
    assert.throws(() => validateReport(valid, wrongSuite), /missing passed acceptance contracts/,
      `${suiteName} evidence cannot satisfy ${wrongSuite}`);
  }
  const skipped = syntheticReport('live-mock');
  skipped.suites[0].specs[0].tests[0].expectedStatus = 'skipped';
  skipped.suites[0].specs[0].tests[0].results[0].status = 'skipped';
  assert.throws(() => validateReport(skipped, 'live-mock'), /missing passed acceptance contracts/,
    'acceptance tags attached to skipped tests are not evidence');
  console.log('Browser report checker self-test: missing ID, zero expected, skipped, failed, flaky and wrong suite rejected.');
}

const [reportPath, suiteName] = process.argv.slice(2);
if (reportPath === '--self-test' && !suiteName) {
  runSelfTests();
} else {
  if (!reportPath || !Object.hasOwn(required, suiteName)) {
    throw new Error('Usage: node check-browser-report.mjs <playwright-json-report> <live-mock|demo-pwa>');
  }
  runSelfTests();
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const result = validateReport(report, suiteName);
  console.log(`Browser ${suiteName}: ${result.expected} passed, 0 skipped/flaky/unexpected; contracts: ${result.acceptance.join(', ')}`);
}
