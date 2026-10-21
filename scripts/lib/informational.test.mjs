import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInformational } from './informational.mjs';

test('passes a successful value through without warning', async () => {
  const warnings = [];
  const r = await runInformational('x', async () => ['problem'], { warn: (m) => warnings.push(m) });
  assert.deepEqual(r, { ok: true, value: ['problem'] });
  assert.deepEqual(warnings, []);
});

test('turns a rejection into a warning instead of throwing (holodeck#48)', async () => {
  const warnings = [];
  const r = await runInformational(
    'dev (no exclude)',
    async () => {
      throw new Error('fixture never became ready: Timeout 60000ms exceeded');
    },
    { warn: (m) => warnings.push(m) },
  );
  assert.equal(r.ok, false);
  assert.match(r.error.message, /Timeout/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^WARNING: dev \(no exclude\) \(informational, not a failure\) could not run: .*Timeout/);
});

test('turns a synchronous throw and a non-Error rejection into warnings', async () => {
  const warnings = [];
  const warn = (m) => warnings.push(m);
  assert.equal((await runInformational('sync', () => { throw new TypeError('boom'); }, { warn })).ok, false);
  assert.equal((await runInformational('str', () => Promise.reject('net::ERR_FAILED'), { warn })).ok, false);
  assert.match(warnings[0], /boom/);
  assert.match(warnings[1], /net::ERR_FAILED/);
});
