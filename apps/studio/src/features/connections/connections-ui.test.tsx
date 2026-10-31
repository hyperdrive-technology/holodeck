import type { ConnectionState, HolodeckHost, HolodeckProvider, ProviderHub, SignalBinding } from '@holodeck/sdk';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { connectionFingerprint } from '../../connections/fingerprint';
import { SessionSecretStore } from '../../connections/secrets';
import { createIsoDocument } from '../../documents/new-document';
import { createStudioHost } from '../../host/studio-host';
import { CREDENTIAL_CASES, withPart } from '../../test-support';
import { BindingDialog } from './BindingDialog';
import { ConnectionsPanel } from './ConnectionsPanel';

let host: HolodeckHost;
beforeAll(async () => {
  host = await createStudioHost();
});

function memorySecrets() {
  const map = new Map<string, string>();
  return new SessionSecretStore({
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  });
}

const live = (state: string): ConnectionState => ({ provider: 'holodeck.sim', status: { state: state as never, since: 0 } });

function panel(over: { connections?: Array<{ id: string; provider: string; config?: Record<string, unknown> }>; bound?: boolean; statuses?: Record<string, ConnectionState> } = {}) {
  const doc = createIsoDocument('Plant', 'p');
  if (over.connections) doc.connections = over.connections;
  if (over.bound) {
    doc.body = withPart(doc.body, host.registry, 'tank').scene;
    doc.body.objects[0]!.bindings = { level: { connection: 'sim', source: 'sine:5' } };
  }
  const onSave = vi.fn();
  const onRemove = vi.fn();
  const secrets = memorySecrets();
  render(<ConnectionsPanel host={host} doc={doc} statuses={over.statuses ?? { sim: live('live') }} secrets={secrets} onSave={onSave} onRemove={onRemove} />);
  return { onSave, onRemove, secrets };
}

const pick = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('<ConnectionsPanel /> + <ConnectionDialog />', () => {
  it('adds a holodeck.sim connection (no settings, no secrets)', async () => {
    const { onSave } = panel();
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    pick('Provider', 'holodeck.sim');
    pick('Id', 'plant');
    fireEvent.click(within(screen.getByTestId('connection-dialog')).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ connection: { id: 'plant', provider: 'holodeck.sim' }, secrets: {} }, true));
  });

  it('adds an HTTP connection: settings to the document, the token only as a secret', async () => {
    const { onSave } = panel();
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    pick('Provider', 'holodeck.http');
    pick('Id', 'api');
    pick('Url *', 'http://127.0.0.1:4180/metrics');
    pick('Interval Ms', '500');
    pick('Auth', 'bearer');
    pick('API token', 'tok-123');
    fireEvent.click(within(screen.getByTestId('connection-dialog')).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [{ connection, secrets }] = onSave.mock.calls[0]!;
    expect(connection).toEqual({ id: 'api', provider: 'holodeck.http', config: { url: 'http://127.0.0.1:4180/metrics', intervalMs: 500, auth: { scheme: 'bearer' } } });
    expect(JSON.stringify(connection)).not.toContain('tok-123');
    expect(secrets).toEqual({ token: 'tok-123' });
  });

  it('lists every problem and saves nothing for an invalid connection', async () => {
    const { onSave } = panel({ connections: [{ id: 'sim', provider: 'holodeck.sim' }] });
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    pick('Provider', 'holodeck.http');
    pick('Id', 'sim');
    pick('Interval Ms', '10');
    fireEvent.click(within(screen.getByTestId('connection-dialog')).getByRole('button', { name: 'Add' }));
    const problems = await screen.findByTestId('connection-problems');
    expect(problems).toHaveTextContent('already used');
    expect(problems).toHaveTextContent('Url: required');
    expect(onSave).not.toHaveBeenCalled();
  });

  // holodeck#163 review (P1): the dialog refuses credentials typed into any field or the advanced JSON.
  it.each(CREDENTIAL_CASES.filter((c) => c.provider !== 'acme.custom').map((c) => [c.name, c] as const))('dialog refuses %s', async (_name, c) => {
    const { onSave } = panel();
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    pick('Provider', c.provider);
    pick('Id', 'leak');
    const { url, region, mode, ...rest } = c.config as Record<string, unknown>;
    if (typeof url === 'string') pick('Url *', url);
    if (typeof region === 'string') pick('Region *', region);
    if (typeof mode === 'string') pick('Mode', mode);
    // Fields the form shows as inputs are typed there; everything else goes in the advanced JSON.
    const formKeys = new Set(['method', 'credentials']);
    const advanced = Object.fromEntries(Object.entries(rest).filter(([k]) => !formKeys.has(k)));
    if (rest.method) pick('Method', String(rest.method));
    if (rest.credentials) {
      const creds = rest.credentials as Record<string, unknown>;
      pick('Credentials', String(creds.type));
      const { type: _t, ...extra } = creds;
      if (Object.keys(extra).length) advanced.credentials = creds;
    }
    if (advanced.credentials) {
      // credentials is a form field: put the leaky copy in the advanced box under another key to also check the scan.
      advanced.extra = advanced.credentials;
      delete advanced.credentials;
    }
    if (Object.keys(advanced).length) fireEvent.change(screen.getByLabelText('Advanced'), { target: { value: JSON.stringify(advanced) } });
    fireEvent.click(within(screen.getByTestId('connection-dialog')).getByRole('button', { name: 'Add' }));
    expect(await screen.findByTestId('connection-problems')).toBeInTheDocument();
    expect(screen.getByTestId('connection-problems').textContent).not.toContain('SECRET');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('dialog refuses a label that carries a credential (holodeck#170)', async () => {
    const { onSave } = panel();
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    pick('Provider', 'holodeck.sim');
    pick('Id', 'plant');
    pick('Label', 'https://admin:SECRET@x.test');
    fireEvent.click(within(screen.getByTestId('connection-dialog')).getByRole('button', { name: 'Add' }));
    expect(await screen.findByTestId('connection-problems')).toHaveTextContent('label');
    expect(onSave).not.toHaveBeenCalled();
  });

  // Review of #163 @ 51da21b: a schemaless provider is configured through the advanced JSON.
  it('offers the advanced JSON for a provider without a schema and saves it', async () => {
    if (!host.registry.get('holodeck.provider', 'test.schemaless')) {
      host.registry.install({
        id: 'test.schemaless-pkg',
        version: '1.0.0',
        contributions: {
          'holodeck.provider': [
            { id: 'test.schemaless', label: 'Schemaless', capabilities: { read: true }, connect: async () => Promise.reject(new Error('not used')) } as HolodeckProvider,
          ],
        },
      });
    }
    const { onSave } = panel();
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    pick('Provider', 'test.schemaless');
    pick('Id', 'feed');
    fireEvent.change(screen.getByLabelText('Advanced'), { target: { value: '{"endpoint":"https://feed.example.test/v1","pollMs":500}' } });
    fireEvent.click(within(screen.getByTestId('connection-dialog')).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0].connection).toEqual({ id: 'feed', provider: 'test.schemaless', config: { endpoint: 'https://feed.example.test/v1', pollMs: 500 } });
  });

  it('AWS: region + credential mode in the form; access keys are secrets', async () => {
    const { onSave } = panel();
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    pick('Provider', 'aws.cloudwatch');
    pick('Id', 'prod');
    pick('Region *', 'eu-west-1');
    expect(screen.getByLabelText('Credentials')).toHaveValue('static');
    expect(within(screen.getByTestId('connection-secrets')).getByLabelText(/secret access key/i)).toHaveAttribute('type', 'password');
    fireEvent.change(within(screen.getByTestId('connection-secrets')).getByLabelText(/access key id/i), { target: { value: 'AKIA-TEST' } });
    fireEvent.click(within(screen.getByTestId('connection-dialog')).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [{ connection, secrets }] = onSave.mock.calls[0]!;
    // The credentials mode was left at the schema default (static): not written, the provider applies it.
    expect(connection.config).toEqual({ region: 'eu-west-1' });
    expect(secrets).toEqual({ accessKeyId: 'AKIA-TEST' });
  });

  it('never shows a stored secret: editing shows only that one is set, and can clear it', async () => {
    const api = { id: 'api', provider: 'holodeck.http', config: { url: 'http://x.test/a', auth: { scheme: 'bearer' } } };
    const { onSave, secrets } = panel({ connections: [api] });
    secrets.set('p', 'api', 'token', 'super-secret', connectionFingerprint(api));
    fireEvent.click(screen.getByRole('button', { name: 'Edit connection api' }));
    const token = screen.getByLabelText('API token');
    expect(token).toHaveValue('');
    expect(token).toHaveAttribute('placeholder', expect.stringContaining('set'));
    expect(document.body.innerHTML).not.toContain('super-secret');
    fireEvent.click(screen.getByLabelText('Clear'));
    fireEvent.click(within(screen.getByTestId('connection-dialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0].secrets).toEqual({ token: '' });
    expect(onSave.mock.calls[0]![1]).toBe(false);
  });

  // holodeck#166: pointing the connection elsewhere un-sets its secrets in the dialog.
  it('editing the URL to another origin says the secrets must be entered again', () => {
    const api = { id: 'api', provider: 'holodeck.http', config: { url: 'http://x.test/a', auth: { scheme: 'bearer' } } };
    const { secrets } = panel({ connections: [api] });
    secrets.set('p', 'api', 'token', 'super-secret', connectionFingerprint(api));
    fireEvent.click(screen.getByRole('button', { name: 'Edit connection api' }));
    expect(screen.getByLabelText('API token')).toHaveAttribute('placeholder', expect.stringContaining('set'));
    // Same origin, other path: still the same endpoint for secrets.
    pick('Url *', 'http://x.test/other');
    expect(screen.queryByTestId('secrets-endpoint-changed')).toBeNull();
    pick('Url *', 'http://evil.test/a');
    expect(screen.getByTestId('secrets-endpoint-changed')).toBeInTheDocument();
    expect(screen.getByLabelText('API token')).not.toHaveAttribute('placeholder', expect.stringContaining('set'));
  });

  it('shows status badges and refuses to remove a connection that bindings use', () => {
    const { onRemove } = panel({ connections: [{ id: 'sim', provider: 'holodeck.sim' }], bound: true });
    expect(screen.getByTestId('connection-status-sim')).toHaveAttribute('data-state', 'live');
    fireEvent.click(screen.getByRole('button', { name: 'Remove connection sim' }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('tank-1.level');
  });

  it('points out secrets this tab lacks when the connection fails, without showing values', () => {
    const connections = [{ id: 'api', provider: 'holodeck.http', config: { url: 'http://x.test', auth: { scheme: 'bearer' } } }];
    panel({ connections, statuses: { api: live('error') } });
    expect(screen.getByTestId('connection-api')).toHaveTextContent('Not set in this tab: API token, Password');
  });

  it('says nothing about optional secrets while the connection is fine', () => {
    const connections = [{ id: 'api', provider: 'holodeck.http', config: { url: 'http://x.test' } }];
    panel({ connections, statuses: { api: live('live') } });
    expect(screen.getByTestId('connection-api')).not.toHaveTextContent('Not set in this tab');
  });

  it('removes an unused connection', () => {
    const { onRemove } = panel({ connections: [{ id: 'sim', provider: 'holodeck.sim' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove connection sim' }));
    expect(onRemove).toHaveBeenCalledWith('sim');
  });
});

describe('<BindingDialog />', () => {
  const connections = [
    { id: 'sim', provider: 'holodeck.sim' },
    { id: 'api', provider: 'holodeck.http', config: { url: 'http://x.test' } },
  ];
  const providerOf = (c: { provider: string } | undefined) => (c ? host.registry.get('holodeck.provider', c.provider) : undefined) as never;

  function open(current?: SignalBinding, hub?: ProviderHub, paramRange?: { min: number; max: number }) {
    const onSave = vi.fn();
    render(
      <BindingDialog paramLabel="Level" paramRange={paramRange} connections={connections} current={current} hub={hub} providerOf={providerOf} onSave={onSave} onClose={() => undefined} />,
    );
    return onSave;
  }

  it('lists the top level of an open connection as soon as it opens, and scales a percent leaf onto the param range', async () => {
    const browse = vi.fn(async () => [
      { path: 'sine:10', label: 'Sine, 10 s, 0–100', source: 'sine:10', type: 'number' as const },
      { path: '/tank/level', label: 'level', source: '/tank/level', type: 'number' as const },
    ]);
    const hub = { session: () => ({ browse }) } as unknown as ProviderHub;
    const onSave = open(undefined, hub, { min: 0, max: 1 });
    fireEvent.click(await screen.findByText('Sine, 10 s, 0–100'));
    expect(browse).toHaveBeenCalledWith(undefined);
    expect(screen.getByTestId('binding-suggested-scale')).toHaveTextContent('Scaled 0–100 to Level’s range 0–1');
    fireEvent.click(screen.getByRole('button', { name: 'Bind' }));
    expect(onSave).toHaveBeenCalledWith({ connection: 'sim', source: 'sine:10', transform: { kind: 'scale', inMin: 0, inMax: 100, outMin: 0, outMax: 1 } });
  });

  it('binds a numeric leaf that declares no percent range as is (an HTTP level already 0..1)', async () => {
    const browse = vi.fn(async () => [{ path: '/tank/level', label: 'level', source: '/tank/level', type: 'number' as const }]);
    const onSave = open(undefined, { session: () => ({ browse }) } as unknown as ProviderHub, { min: 0, max: 1 });
    fireEvent.click(await screen.findByText('level'));
    expect(screen.queryByTestId('binding-suggested-scale')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Bind' }));
    expect(onSave).toHaveBeenCalledWith({ connection: 'sim', source: '/tank/level' });
  });

  // holodeck#243: a suggestion made for one leaf must not stick to the next source.
  describe('the suggested scale follows the picked source', () => {
    const leaves = [
      { path: 'sine:10', label: 'Sine, 10 s, 0–100', source: 'sine:10', type: 'number' as const },
      { path: '/tank/level', label: 'level', source: '/tank/level', type: 'number' as const },
    ];
    const hub = () => ({ session: () => ({ browse: vi.fn(async () => leaves) }) }) as unknown as ProviderHub;

    it('picking a non-percent leaf after a percent one drops the suggestion', async () => {
      const onSave = open(undefined, hub(), { min: 0, max: 1 });
      fireEvent.click(await screen.findByText('Sine, 10 s, 0–100'));
      expect(screen.getByLabelText('Transform kind')).toHaveValue('scale');
      fireEvent.click(screen.getByText('level'));
      expect(screen.queryByTestId('binding-suggested-scale')).toBeNull();
      expect(screen.getByLabelText('Transform kind')).toHaveValue('none');
      fireEvent.click(screen.getByRole('button', { name: 'Bind' }));
      expect(onSave).toHaveBeenCalledWith({ connection: 'sim', source: '/tank/level' });
    });

    it('typing a source or switching connection drops the suggestion', async () => {
      const onSave = open(undefined, hub(), { min: 0, max: 1 });
      fireEvent.click(await screen.findByText('Sine, 10 s, 0–100'));
      fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'const:0.5' } });
      expect(screen.getByLabelText('Transform kind')).toHaveValue('none');
      fireEvent.click(await screen.findByText('Sine, 10 s, 0–100'));
      expect(screen.getByLabelText('Transform kind')).toHaveValue('scale');
      pick('Connection', 'api');
      expect(screen.getByLabelText('Transform kind')).toHaveValue('none');
      fireEvent.change(screen.getByLabelText('Source'), { target: { value: '/tank/level' } });
      fireEvent.click(screen.getByRole('button', { name: 'Bind' }));
      expect(onSave).toHaveBeenCalledWith({ connection: 'api', source: '/tank/level' });
    });

    it('a transform the user edited is kept when another leaf is picked', async () => {
      const onSave = open(undefined, hub(), { min: 0, max: 1 });
      fireEvent.click(await screen.findByText('Sine, 10 s, 0–100'));
      fireEvent.change(screen.getByLabelText('Transform in max'), { target: { value: '200' } });
      fireEvent.click(screen.getByText('level'));
      fireEvent.click(screen.getByRole('button', { name: 'Bind' }));
      expect(onSave).toHaveBeenCalledWith({ connection: 'sim', source: '/tank/level', transform: { kind: 'scale', inMin: 0, inMax: 200, outMin: 0, outMax: 1 } });
    });

    it('picking another percent leaf keeps a (recomputed) suggestion', async () => {
      const onSave = open(undefined, hub(), { min: 0, max: 1 });
      fireEvent.click(await screen.findByText('Sine, 10 s, 0–100'));
      fireEvent.click(screen.getByText('level'));
      fireEvent.click(screen.getByText('Sine, 10 s, 0–100'));
      fireEvent.click(screen.getByRole('button', { name: 'Bind' }));
      expect(onSave).toHaveBeenCalledWith({ connection: 'sim', source: 'sine:10', transform: { kind: 'scale', inMin: 0, inMax: 100, outMin: 0, outMax: 1 } });
    });
  });

  it('a connection that is not open yet lists nothing on open and says so on Browse', async () => {
    open(undefined, { session: () => undefined } as unknown as ProviderHub, { min: 0, max: 1 });
    expect(screen.queryByText(/Sine/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Browse/ }));
    expect(await screen.findByText(/not open yet/)).toBeInTheDocument();
  });

  it('binds with a scale transform validated by the SDK', () => {
    const onSave = open();
    pick('Source', 'sine:10');
    pick('Transform kind', 'scale');
    fireEvent.change(screen.getByLabelText('Transform in max'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bind' }));
    expect(onSave).toHaveBeenCalledWith({ connection: 'sim', source: 'sine:10', transform: { kind: 'scale', inMin: 0, inMax: 200, outMin: 0, outMax: 1 } });
  });

  it('refuses an empty source and a bad transform', () => {
    const onSave = open();
    pick('Transform kind', 'format');
    fireEvent.change(screen.getByLabelText('Transform template ({value})'), { target: { value: 'no value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bind' }));
    expect(screen.getByTestId('binding-problems')).toHaveTextContent('source: required');
    expect(screen.getByTestId('binding-problems')).toHaveTextContent('{value}');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('picks a source from the provider browse tree', async () => {
    const browse = vi.fn(async (path?: string) =>
      path === '/pumps'
        ? [{ path: '/pumps/0/rpm', label: 'rpm', source: '/pumps/0/rpm', type: 'number' as const }]
        : [{ path: '/pumps', label: 'pumps', hasChildren: true }],
    );
    const hub = { session: () => ({ browse }) } as unknown as ProviderHub;
    const onSave = open(undefined, hub);
    pick('Connection', 'api');
    fireEvent.click(screen.getByRole('button', { name: /Browse/ }));
    fireEvent.click(await screen.findByText('pumps'));
    fireEvent.click(await screen.findByText('rpm'));
    expect(screen.getByLabelText('Source')).toHaveValue('/pumps/0/rpm');
    fireEvent.click(screen.getByRole('button', { name: 'Bind' }));
    expect(onSave).toHaveBeenCalledWith({ connection: 'api', source: '/pumps/0/rpm' });
    expect(browse).toHaveBeenCalledWith(undefined);
    expect(browse).toHaveBeenCalledWith('/pumps');
  });

  // holodeck#173: a slow response must not overwrite newer navigation.
  it('ignores a stale browse response that arrives after the user navigated elsewhere', async () => {
    let releaseSlow: (nodes: Array<{ path: string; label: string; source?: string }>) => void = () => undefined;
    const browse = vi.fn((path?: string) => {
      if (path === '/pumps/slow') return new Promise<never>((resolve) => (releaseSlow = resolve as never));
      if (path === '/pumps') return Promise.resolve([{ path: '/pumps/slow', label: 'slow', hasChildren: true }]);
      return Promise.resolve([{ path: '/pumps', label: 'pumps', hasChildren: true }]);
    });
    open(undefined, { session: () => ({ browse }) } as unknown as ProviderHub);
    pick('Connection', 'api');
    fireEvent.click(screen.getByRole('button', { name: /Browse/ }));
    fireEvent.click(await screen.findByText('pumps'));
    fireEvent.click(await screen.findByText('slow'));
    // While /pumps/slow is in flight, go Up to the root listing.
    fireEvent.click(screen.getByRole('button', { name: /Up/ }));
    await screen.findByText('pumps');
    await act(async () => releaseSlow([{ path: '/pumps/slow/x', label: 'stale-node', source: '/x' }]));
    expect(screen.queryByText('stale-node')).toBeNull();
    expect(screen.getByText('pumps')).toBeInTheDocument();
    expect(within(screen.getByTestId('source-browser')).queryByText('/pumps/slow')).toBeNull();
  });

  it('removes an existing binding', () => {
    const onSave = open({ connection: 'sim', source: 'const:1' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove binding' }));
    expect(onSave).toHaveBeenCalledWith(undefined);
  });
});
