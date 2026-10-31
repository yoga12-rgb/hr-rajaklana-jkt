import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const required = {
  'live-mock': [
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
    ['camera/GPS biometric clock-in', 'real camera and browser geolocation satisfy same-account attendance flow; clock-out checks GPS again']
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
