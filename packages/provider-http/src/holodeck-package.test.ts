import {
  HOLODECK_KINDS,
  HolodeckHost,
  packageRoles,
  validateHolodeckPackageManifest,
  type HolodeckProvider,
} from '@holodeck/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import manifestJson from '../holodeck.package.json';
import pkgJson from '../package.json';
import entry, { createHttpProviderPackage, HTTP_PACKAGE_MANIFEST, httpProviderPackage } from './holodeck-package';
import * as main from './index';
import { HTTP_PROVIDER_ID } from './provider';
import { startTestServer, waitFor, type TestServer } from './test-support/server';

describe('holodeck.package.json', () => {
  it('is a valid holodeck.package.v1 manifest matching package.json', () => {
    expect(validateHolodeckPackageManifest(manifestJson)).toEqual([]);
    expect(manifestJson.version).toBe(pkgJson.version);
    expect(manifestJson.id).toBe('holodeck.http');
    expect(manifestJson.providers).toEqual([HTTP_PROVIDER_ID]);
    expect(packageRoles(HTTP_PACKAGE_MANIFEST)).toEqual(['provider']);
    // The tsup entry and the manifest entry agree.
    expect(manifestJson.entry).toBe('dist/holodeck-package.js');
    expect(pkgJson.exports['./holodeck-package'].import).toBe('./dist/holodeck-package.js');
  });

  it('the default export is the package module and the main entry re-exports it', () => {
    expect(entry).toBe(httpProviderPackage);
    expect(main.httpProviderPackage).toBe(httpProviderPackage);
    expect(entry.manifest).toBe(HTTP_PACKAGE_MANIFEST);
  });
});

describe('installing into a HolodeckHost', () => {
  it('registers the provider', async () => {
    const host = new HolodeckHost({ name: 'test' });
    const report = await host.installPackage(manifestJson, entry);
    expect(report.unresolvedEngines).toEqual([]);
    const provider = host.registry.get(HOLODECK_KINDS.provider, HTTP_PROVIDER_ID) as HolodeckProvider | undefined;
    expect(provider?.capabilities).toEqual({ read: true, write: true, browse: true });
    expect(provider?.origins).toBeUndefined();
  });

  it('a restricted package declares its origins in permissions.network and installs with that manifest', async () => {
    const origins = ['https://*.example.com', 'wss://feed.example.com'];
    const restricted = createHttpProviderPackage({ origins });
    expect(restricted.manifest.permissions).toEqual({ network: origins });
    expect(validateHolodeckPackageManifest(restricted.manifest)).toEqual([]);
    // The default manifest is not modified.
    expect(HTTP_PACKAGE_MANIFEST.permissions).toBeUndefined();
    const host = new HolodeckHost({ name: 'test' });
    await host.installPackage(restricted.manifest, restricted);
    expect((host.registry.get(HOLODECK_KINDS.provider, HTTP_PROVIDER_ID) as HolodeckProvider).origins).toEqual(origins);
  });

  it('a restricted module with the default manifest is refused (origins not covered)', async () => {
    const restricted = createHttpProviderPackage({ origins: ['https://api.example.com'] });
    const host = new HolodeckHost({ name: 'test' });
    await expect(host.installPackage(manifestJson, restricted)).rejects.toMatchObject({ code: 'MANIFEST_MISMATCH' });
  });

  it('copies options and rejects bad origins at creation', () => {
    const origins = ['https://api.example.com'];
    const restricted = createHttpProviderPackage({ origins });
    origins.push('https://evil.example.com');
    expect(restricted.manifest.permissions?.network).toEqual(['https://api.example.com']);
    expect(() => createHttpProviderPackage({ origins: ['https://example.*'] })).toThrow(/invalid origin pattern/);
  });
});

describe('end to end through a ProviderHub', () => {
  let server: TestServer;
  beforeEach(async () => {
    server = await startTestServer();
  });
  afterEach(async () => {
    await server.close();
  });

  it('drives document bindings from a polled JSON endpoint with a secret from the host vault', async () => {
    let cpu = 42;
    server.route('GET', '/metrics', (req, res) => {
      if (req.headers.authorization !== 'Bearer vault-token') {
        res.writeHead(401).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ servers: { web: { cpu, state: 'OK' } } }));
    });
    const host = new HolodeckHost({ name: 'test' });
    await host.installPackage(manifestJson, entry);
    const hub = host.createProviderHub({ secret: async (connectionId, key) => (connectionId === 'api' && key === 'token' ? 'vault-token' : undefined) });
    hub.setConnections([{ id: 'api', provider: HTTP_PROVIDER_ID, config: { url: `${server.url}/metrics`, intervalMs: 50, auth: { scheme: 'bearer' } } }]);
    hub.setBindings([
      { objectId: 'web', param: 'label', binding: { connection: 'api', source: '/servers/web/cpu', transform: { kind: 'format', template: '{value} %', digits: 0 } } },
      { objectId: 'web', param: 'color', binding: { connection: 'api', source: '$.servers.web.state', transform: { kind: 'map', cases: { OK: 'green' }, default: 'grey' } } },
    ]);
    await hub.settled();
    await waitFor(() => hub.getSnapshot().metrics.web?.label === '42 %', 3000, 'first value');
    expect(hub.getSnapshot().metrics.web?.color).toBe('green');
    expect(hub.getSnapshot().connections.api?.status.state).toBe('live');
    cpu = 87;
    await waitFor(() => hub.getSnapshot().metrics.web?.label === '87 %', 3000, 'updated value');
    await hub.dispose();
    const count = server.requestsTo('/metrics').length;
    await new Promise((r) => setTimeout(r, 200));
    expect(server.requestsTo('/metrics').length).toBeLessThanOrEqual(count + 1);
  });
});
