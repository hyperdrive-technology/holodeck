#!/usr/bin/env node
/**
 * Smoke test for the built Holodeck package entry (run after `pnpm build`;
 * part of `pnpm smoke`):
 *
 *   node scripts/smoke-holodeck-package.mjs
 *
 * 1. holodeck.package.json passes the SDK's validateHolodeckPackageManifest,
 *    and its permissions.network equals the provider's origins.
 * 2. The manifest `entry` (dist/holodeck-package.js) loads as an ES module
 *    from its path, the way a host that only has the package directory loads it.
 * 3. `@holodeck/provider-aws/holodeck-package` resolves by name; each default
 *    export installs into a HolodeckHost, registers `aws.cloudwatch`, and reads
 *    a metric and an alarm through a ProviderHub session. The AWS SDK runs for
 *    real (serialisation, SigV4 signing with fake keys); the hub's `fetch` is
 *    an in-process fake AWS endpoint, and the global fetch throws, so nothing
 *    reaches a network.
 * 4. The package is ESM only. Node's `require(esm)` of the entry works (no
 *    top-level await) and returns the same module instance as `import`.
 * 5. `npm pack --dry-run` publishes the manifest and the entry, and no tests.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(PKG_DIR, 'holodeck.package.json'), 'utf8'));
const require = createRequire(join(PKG_DIR, 'package.json'));

const failures = [];
const fail = (msg) => failures.push(msg);

globalThis.fetch = async (input) => {
  throw new Error(`smoke: unexpected network access to ${typeof input === 'string' ? input : input.url}`);
};

/** In-process stand-in for CloudWatch (AWS JSON 1.0). */
const fakeAws = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  if (!/^monitoring\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname)) throw new Error(`smoke: unexpected host ${url.hostname}`);
  if (!/^AWS4-HMAC-SHA256 Credential=AKIASMOKEFAKE0000001\//.test(request.headers.get('authorization') ?? '')) throw new Error('smoke: request not signed');
  const op = (request.headers.get('x-amz-target') ?? '').split('.').pop();
  const body = JSON.parse(await request.text());
  const json = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/x-amz-json-1.0' } });
  if (op === 'GetMetricData') {
    return json({ MetricDataResults: body.MetricDataQueries.map((q) => ({ Id: q.Id, Timestamps: [Date.now() / 1000], Values: [73.5], StatusCode: 'Complete' })) });
  }
  if (op === 'DescribeAlarms') return json({ MetricAlarms: body.AlarmNames.map((n) => ({ AlarmName: n, StateValue: 'ALARM' })) });
  throw new Error(`smoke: unexpected operation ${op}`);
};

const METRIC = 'cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-smoke';
const ALARM = 'alarm:eu-west-1/smoke-alarm';

async function checkInstall(label, sdk, mod) {
  const entry = mod?.default ?? mod;
  if (typeof entry?.createExtension !== 'function') {
    fail(`${label}: default export has no createExtension()`);
    return;
  }
  try {
    const host = new sdk.HolodeckHost({ name: 'smoke' });
    await host.installPackage(manifest, entry);
    const provider = host.registry.get('holodeck.provider', 'aws.cloudwatch');
    if (!provider) fail(`${label}: provider not registered`);
    else if (JSON.stringify(provider.origins) !== JSON.stringify(manifest.permissions.network)) fail(`${label}: provider origins differ from permissions.network`);
    const secrets = { accessKeyId: 'AKIASMOKEFAKE0000001', secretAccessKey: 'smokeFakeSecret000000000000000000000001' };
    const hub = host.createProviderHub({ fetch: fakeAws, secret: async (_id, key) => secrets[key] });
    hub.setConnections([{ id: 'prod', provider: 'aws.cloudwatch', config: { region: 'eu-west-1', maxAttempts: 1 } }]);
    await hub.settled();
    const [metric, alarm] = await hub.session('prod').read([METRIC, ALARM]);
    if (metric?.value !== 73.5) fail(`${label}: metric read returned ${JSON.stringify(metric)}`);
    if (alarm?.value !== 'ALARM') fail(`${label}: alarm read returned ${JSON.stringify(alarm)}`);
    await hub.dispose();
    console.log(`${label}: installed ${manifest.id}@${manifest.version}, read ${metric?.value} / ${alarm?.value}`);
  } catch (err) {
    fail(`${label}: install/read threw: ${err.stack ?? err}`);
  }
}

const sdk = await import('@holodeck/sdk');
const manifestErrors = sdk.validateHolodeckPackageManifest(manifest);
if (manifestErrors.length) fail(`holodeck.package.json is invalid:\n  ${manifestErrors.join('\n  ')}`);

const mainEsm = await import(pkg.name);
if (JSON.stringify(mainEsm.AWS_ORIGINS) !== JSON.stringify(manifest.permissions?.network)) fail('AWS_ORIGINS and permissions.network differ');
const entryPath = join(PKG_DIR, manifest.entry);
try {
  await checkInstall(`entry ${manifest.entry}`, sdk, await import(pathToFileURL(entryPath).href));
} catch (err) {
  fail(`importing ${manifest.entry} threw: ${err.stack ?? err}`);
}
try {
  await checkInstall('esm ./holodeck-package', sdk, await import(`${pkg.name}/holodeck-package`));
} catch (err) {
  fail(`import ${pkg.name}/holodeck-package threw: ${err.stack ?? err}`);
}
try {
  const required = require(entryPath);
  const imported = await import(pathToFileURL(entryPath).href);
  if (required.default !== imported.default) fail('require(esm) returned a different module instance than import');
  if (require(join(PKG_DIR, pkg.exports['.'].import)).createAwsProvider !== mainEsm.createAwsProvider) {
    fail('require(esm) of the main entry returned a different module instance than import');
  }
  await checkInstall('require(esm) entry', sdk, required);
} catch (err) {
  fail(`require(esm) of ${manifest.entry} failed: ${err.stack ?? err}`);
}

const pack = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--loglevel=error'], { cwd: PKG_DIR, encoding: 'utf8' }),
);
const packed = new Set(pack[0].files.map((f) => f.path));
for (const file of ['holodeck.package.json', manifest.entry, 'dist/holodeck-package.d.ts', 'README.md', 'LICENSE']) {
  if (!packed.has(file)) fail(`npm pack would not publish ${file}`);
}
for (const file of packed) {
  if (/\.test\.ts$|test-support\//.test(file)) fail(`npm pack would publish test file ${file}`);
}

if (failures.length) {
  console.error(`\nsmoke-holodeck-package FAILED (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`smoke-holodeck-package OK: ${manifest.id}@${manifest.version} (${manifest.entry})`);
