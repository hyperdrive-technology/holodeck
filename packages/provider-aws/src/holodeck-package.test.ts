import {
  HOLODECK_KINDS,
  HolodeckHost,
  originMatches,
  packageRoles,
  validateHolodeckPackageManifest,
  type HolodeckProvider,
} from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import manifestJson from '../holodeck.package.json';
import pkgJson from '../package.json';
import { AWS_ORIGINS } from './clients';
import entry, { AWS_PACKAGE_MANIFEST, awsProviderPackage, createAwsProviderPackage } from './holodeck-package';
import * as main from './index';
import { AWS_PROVIDER_ID } from './provider';
import { createFakeAws, metricDataHandler } from './test-support/fake-aws';
import { FAKE_KEYS, waitFor } from './test-support/harness';

describe('holodeck.package.json', () => {
  it('is a valid holodeck.package.v1 manifest matching package.json', () => {
    expect(validateHolodeckPackageManifest(manifestJson)).toEqual([]);
    expect(manifestJson.version).toBe(pkgJson.version);
    expect(manifestJson.id).toBe('holodeck.provider-aws');
    expect(manifestJson.providers).toEqual([AWS_PROVIDER_ID]);
    expect(packageRoles(AWS_PACKAGE_MANIFEST)).toEqual(['provider']);
    expect(manifestJson.entry).toBe('dist/holodeck-package.js');
    expect(pkgJson.exports['./holodeck-package'].import).toBe('./dist/holodeck-package.js');
  });

  it('permissions.network is exactly the provider origins', () => {
    expect(manifestJson.permissions.network).toEqual([...AWS_ORIGINS]);
    // Sanity: the regional endpoints the SDK resolves are covered.
    for (const origin of ['https://monitoring.eu-west-1.amazonaws.com', 'https://tagging.ap-southeast-2.amazonaws.com', 'https://sts.us-east-1.amazonaws.com', 'https://monitoring.cn-northwest-1.amazonaws.com.cn']) {
      expect(AWS_ORIGINS.some((p) => originMatches(p, origin)), origin).toBe(true);
    }
  });

  it('the default export is the package module and the main entry re-exports it', () => {
    expect(entry).toBe(awsProviderPackage);
    expect(main.awsProviderPackage).toBe(awsProviderPackage);
    expect(entry.manifest).toBe(AWS_PACKAGE_MANIFEST);
  });
});

describe('installing into a HolodeckHost', () => {
  it('registers the provider with its origins covered by the manifest', async () => {
    const host = new HolodeckHost({ name: 'test' });
    const report = await host.installPackage(manifestJson, entry);
    expect(report.unresolvedEngines).toEqual([]);
    const provider = host.registry.get(HOLODECK_KINDS.provider, AWS_PROVIDER_ID) as HolodeckProvider | undefined;
    expect(provider?.capabilities).toEqual({ read: true, browse: true, history: true, discover: true });
    expect(provider?.origins).toEqual([...AWS_ORIGINS]);
  });

  it('a manifest without the AWS origins is refused (MANIFEST_MISMATCH)', async () => {
    const host = new HolodeckHost({ name: 'test' });
    const { permissions: _drop, ...noPermissions } = structuredClone(manifestJson);
    await expect(host.installPackage(noPermissions, entry)).rejects.toMatchObject({ code: 'MANIFEST_MISMATCH' });
  });

  it('createAwsProviderPackage copies its options', async () => {
    const options = { partHints: { 'aws.ec2.instance': 'a' } as Record<string, string> };
    const pkg = createAwsProviderPackage(options);
    expect(pkg.manifest).toBe(AWS_PACKAGE_MANIFEST);
    options.partHints = { 'aws.ec2.instance': 'b' };
    const host = new HolodeckHost({ name: 'test' });
    await host.installPackage(pkg.manifest, pkg);
    expect(host.registry.get(HOLODECK_KINDS.provider, AWS_PROVIDER_ID)).toBeDefined();
  });
});

describe('end to end through a ProviderHub', () => {
  it('drives document bindings from CloudWatch metrics and alarms with secrets from the host vault', async () => {
    let cpu = 42.4;
    let state = 'OK';
    const fake = createFakeAws();
    fake.on('GetMetricData', metricDataHandler(() => cpu, () => Date.now()));
    fake.on('DescribeAlarms', () => ({ MetricAlarms: [{ AlarmName: 'web-cpu', StateValue: state }] }));
    const vault: Record<string, string> = { accessKeyId: FAKE_KEYS.accessKeyId, secretAccessKey: FAKE_KEYS.secretAccessKey };
    const host = new HolodeckHost({ name: 'test' });
    await host.installPackage(manifestJson, entry);
    const hub = host.createProviderHub({ fetch: fake.fetch, secret: async (connectionId, key) => (connectionId === 'prod' ? vault[key] : undefined) });
    hub.setConnections([{ id: 'prod', provider: AWS_PROVIDER_ID, config: { region: 'eu-west-1', minPollIntervalMs: 1000, alarmPollIntervalMs: 1000, maxAttempts: 1 } }]);
    hub.setBindings([
      {
        objectId: 'web',
        param: 'label',
        binding: { connection: 'prod', source: 'cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-1&period=1', transform: { kind: 'format', template: '{value} %', digits: 0 } },
      },
      {
        objectId: 'web',
        param: 'color',
        binding: { connection: 'prod', source: 'alarm:eu-west-1/web-cpu', transform: { kind: 'map', cases: { ALARM: '#e74c3c', OK: '#2ecc71' }, default: '#bdc3c7' } },
      },
    ]);
    await hub.settled();
    await waitFor(() => hub.getSnapshot().metrics.web?.label === '42 %' && hub.getSnapshot().metrics.web?.color === '#2ecc71');
    expect(hub.getSnapshot().connections.prod?.status.state).toBe('live');
    cpu = 87;
    state = 'ALARM';
    // Real timers here: a 1 s metric period and the 1 s poll floor.
    await waitFor(() => hub.getSnapshot().metrics.web?.label === '87 %' && hub.getSnapshot().metrics.web?.color === '#e74c3c', 5000);
    await hub.dispose();
    const count = fake.calls.length;
    await new Promise((r) => setTimeout(r, 1200));
    expect(fake.calls.length).toBe(count);
  });
});
