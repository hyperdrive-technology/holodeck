#!/usr/bin/env node
/**
 * Local JSON server for the connections e2e (holodeck.http provider), so the
 * suite never touches a real network service.
 *
 *   GET /public  -> { pumps: [{ rpm: 1200 }], tank: { level: 0.73 } }
 *   GET /secure  -> same, but only with `Authorization: Bearer e2e-token`
 *                   (401 otherwise): proves the secret reaches the provider.
 *   GET /health  -> "ok" (Playwright's readiness probe)
 *
 * CORS is open: the studio runs on another port.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.HTTP_FIXTURE_PORT ?? 4181);
const TOKEN = 'e2e-token';
const BODY = JSON.stringify({ pumps: [{ rpm: 1200 }], tank: { level: 0.73 } });

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return void res.writeHead(204).end();
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path === '/health') return void res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
  if (path === '/public') return void res.writeHead(200, { 'content-type': 'application/json' }).end(BODY);
  if (path === '/secure') {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      return void res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"unauthorized"}');
    }
    return void res.writeHead(200, { 'content-type': 'application/json' }).end(BODY);
  }
  res.writeHead(404).end();
});
server.listen(PORT, '127.0.0.1', () => console.log(`http fixture on http://127.0.0.1:${PORT}`));
