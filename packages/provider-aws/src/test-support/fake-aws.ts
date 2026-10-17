/**
 * A fake AWS backend behind `ProviderContext.fetch`. Tests run the real AWS
 * SDK v3 clients (serialisation, SigV4 signing with fake keys, retries, error
 * parsing) against it, so nothing here mocks the SDK and nothing reaches a
 * network.
 *
 * Protocols (from the installed clients' runtimeConfig.shared.js):
 * - CloudWatch: AWS JSON 1.0, `X-Amz-Target: GraniteServiceVersion20100801.<Op>`,
 *   with `awsQueryCompatible` (error code also in `x-amzn-query-error`).
 * - Resource Groups Tagging API: AWS JSON 1.1, `ResourceGroupsTaggingAPI_20170126.<Op>`.
 * - Cognito Identity: AWS JSON 1.1, `AWSCognitoIdentityService.<Op>`.
 * - STS: awsQuery (form body `Action=AssumeRole&…`, XML response).
 * Timestamps in JSON protocols are epoch seconds.
 */

export interface FakeCall {
  /** Operation name, e.g. `GetMetricData`, `AssumeRole`. */
  op: string;
  /** `monitoring`, `tagging`, `sts`, `cognito-identity`. */
  service: string;
  region: string;
  url: string;
  headers: Record<string, string>;
  /** Parsed JSON body (JSON protocols) or form fields (STS). */
  body: Record<string, unknown>;
  rawBody: string;
}

export class FakeAwsError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type FakeHandler = (body: Record<string, unknown>, call: FakeCall) => unknown | Promise<unknown>;

export interface FakeAws {
  fetch: typeof fetch;
  calls: FakeCall[];
  callsTo(op: string): FakeCall[];
  /** Register (or replace) the handler for an operation. */
  on(op: string, handler: FakeHandler | Record<string, unknown>): void;
  /** Make the next `n` calls of `op` fail with an AWS error (then the handler runs again). */
  failNext(op: string, error: FakeAwsError, n?: number): void;
  /** Every byte that went over the "wire": URLs, headers, bodies. */
  wire(): string;
}

/** Epoch seconds, as AWS JSON protocols encode timestamps. */
export const epochS = (ms: number) => ms / 1000;

export function createFakeAws(): FakeAws {
  const calls: FakeCall[] = [];
  const handlers = new Map<string, FakeHandler>();
  const failures = new Map<string, Array<FakeAwsError>>();

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => (headers[k] = v));
    const rawBody = request.method === 'GET' ? '' : await request.text();
    const [service = '', region = 'us-east-1'] = url.hostname.split('.');
    let op: string;
    let body: Record<string, unknown>;
    if (service === 'sts') {
      const form = new URLSearchParams(rawBody);
      op = form.get('Action') ?? '';
      body = Object.fromEntries(form);
    } else {
      op = (headers['x-amz-target'] ?? '').split('.').pop() ?? '';
      body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
    }
    const call: FakeCall = { op, service, region: service === 'sts' && url.hostname === 'sts.amazonaws.com' ? 'us-east-1' : region, url: url.href, headers, body, rawBody };
    calls.push(call);

    const xml = service === 'sts';
    const jsonType = service === 'monitoring' ? 'application/x-amz-json-1.0' : 'application/x-amz-json-1.1';
    const errorResponse = (e: FakeAwsError) => {
      if (xml) {
        return new Response(
          `<ErrorResponse><Error><Type>Sender</Type><Code>${e.code}</Code><Message>${e.message}</Message></Error><RequestId>req-1</RequestId></ErrorResponse>`,
          { status: e.status, headers: { 'content-type': 'text/xml' } },
        );
      }
      return new Response(JSON.stringify({ __type: e.code, message: e.message }), {
        status: e.status,
        headers: { 'content-type': jsonType, 'x-amzn-query-error': `${e.code};Sender`, 'x-amzn-requestid': 'req-1' },
      });
    };

    const queued = failures.get(op);
    if (queued?.length) return errorResponse(queued.shift() as FakeAwsError);
    const handler = handlers.get(op);
    if (!handler) return errorResponse(new FakeAwsError('UnknownOperationException', `fake: no handler for ${op}`));
    try {
      const result = await handler(body, call);
      if (xml) return new Response(String(result), { status: 200, headers: { 'content-type': 'text/xml' } });
      return new Response(JSON.stringify(result ?? {}), { status: 200, headers: { 'content-type': jsonType, 'x-amzn-requestid': 'req-1' } });
    } catch (error) {
      if (error instanceof FakeAwsError) return errorResponse(error);
      throw error;
    }
  }) as typeof fetch;

  return {
    fetch: fakeFetch,
    calls,
    callsTo: (op) => calls.filter((c) => c.op === op),
    on(op, handler) {
      handlers.set(op, typeof handler === 'function' ? handler : () => handler);
    },
    failNext(op, error, n = 1) {
      const list = failures.get(op) ?? [];
      for (let i = 0; i < n; i++) list.push(error);
      failures.set(op, list);
    },
    wire: () => calls.map((c) => [c.url, ...Object.entries(c.headers).map(([k, v]) => `${k}: ${v}`), c.rawBody].join('\n')).join('\n\n'),
  };
}

/** A GetMetricData handler that answers every query from `valueFor(query)`, one datapoint at `tsMs`. */
export function metricDataHandler(
  valueFor: (q: { Id: string; MetricStat: { Metric: { Namespace: string; MetricName: string; Dimensions?: Array<{ Name: string; Value: string }> }; Period: number; Stat: string } }) =>
    | number
    | undefined
    | { values: number[]; timestamps: number[]; status?: string },
  tsMs: () => number,
): FakeHandler {
  return (body) => {
    const queries = body.MetricDataQueries as Array<Parameters<typeof valueFor>[0]>;
    return {
      MetricDataResults: queries.map((q) => {
        const v = valueFor(q);
        if (v === undefined) return { Id: q.Id, Label: q.MetricStat.Metric.MetricName, Timestamps: [], Values: [], StatusCode: 'Complete' };
        if (typeof v === 'number') return { Id: q.Id, Label: q.MetricStat.Metric.MetricName, Timestamps: [epochS(tsMs())], Values: [v], StatusCode: 'Complete' };
        return { Id: q.Id, Label: q.MetricStat.Metric.MetricName, Timestamps: v.timestamps.map(epochS), Values: v.values, StatusCode: v.status ?? 'Complete' };
      }),
      Messages: [],
    };
  };
}

export function assumeRoleXml(creds: { accessKeyId: string; secretAccessKey: string; sessionToken: string; expiration: Date }): string {
  return (
    '<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleResult>' +
    `<Credentials><AccessKeyId>${creds.accessKeyId}</AccessKeyId><SecretAccessKey>${creds.secretAccessKey}</SecretAccessKey>` +
    `<SessionToken>${creds.sessionToken}</SessionToken><Expiration>${creds.expiration.toISOString()}</Expiration></Credentials>` +
    '<AssumedRoleUser><Arn>arn:aws:sts::123456789012:assumed-role/ReadOnly/holodeck</Arn><AssumedRoleId>AROAEXAMPLE:holodeck</AssumedRoleId></AssumedRoleUser>' +
    '</AssumeRoleResult><ResponseMetadata><RequestId>req-1</RequestId></ResponseMetadata></AssumeRoleResponse>'
  );
}
