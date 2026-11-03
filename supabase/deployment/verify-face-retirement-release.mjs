// Read-only release gate for the isolated face-retirement release. No hosted
// adapter, credentials, catalog writes or migration-history repair.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

function replaceExactlyOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, 'reviewed baseline marker must appear exactly once: ' + before);
  return source.replace(before, after);
}
export async function faceRetirementReleaseStatements() {
  let baseline = await readFile(new URL('./verify-authenticator-removed-preview.sql', import.meta.url), 'utf8');
  // Keep every authorization/RLS/helper/tombstone test verbatim. The only
  // changes are appending the one reviewed migration to the two independently
  // enumerated history maps and the corresponding ordered-name inventory.
  baseline = replaceExactlyOnce(baseline, 'begin read only;', '');
  baseline = replaceExactlyOnce(baseline, '\ncommit;', '');
  baseline = replaceExactlyOnce(baseline,
    "'privileged_account_mfa_enforcement','retire_application_authenticator'",
    "'privileged_account_mfa_enforcement','retire_application_authenticator','remove_face_verification'");
  for (const version of ['20261030031318', '20261030033256']) {
    baseline = replaceExactlyOnce(baseline, "'" + version + "/retire_application_authenticator'",
      "'" + version + "/retire_application_authenticator','20261103021143/remove_face_verification'");
  }
  baseline = replaceExactlyOnce(baseline, 'ordered 26-name contract', 'ordered 27-name face-retirement release contract');
  return baseline + '\n' + await readFile(new URL('./verify-face-retirement-release.sql', import.meta.url), 'utf8');
}
export async function faceRetirementReleaseProbe() {
  return 'begin read only;\n' + await faceRetirementReleaseStatements() + '\ncommit;\n';
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--print') throw new Error('Usage: node supabase/deployment/verify-face-retirement-release.mjs --print (read-only SQL only)');
  process.stdout.write(await faceRetirementReleaseProbe());
}
