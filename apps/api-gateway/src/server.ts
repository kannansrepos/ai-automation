import http from 'http';
import { URL } from 'url';

const PORT = 3000;
const JIRA_TARGET = 'http://localhost:3001';
const GITHUB_TARGET = 'http://localhost:3002';

const server = http.createServer((req, res) => {
  console.log(`[Gateway] Request Received: ${req.method} ${req.url}`);
  const chunks: Buffer[] = [];
  req.on('data', (chunk) => {
    chunks.push(chunk);
  });

  req.on('end', () => {
    const body = Buffer.concat(chunks).toString();
    console.log(`[Gateway] Request Body: ${body}`);
  });
  const url = req.url || '';
  let target = '';

  // Route requests and rewrite paths based on path prefix
  let rewrittenUrl = url;
  if (url.startsWith('/ji/') || url === '/ji') {
    target = JIRA_TARGET;
    rewrittenUrl = url.slice(3);
  } else if (url.startsWith('/gh/') || url === '/gh') {
    target = GITHUB_TARGET;
    rewrittenUrl = url.slice(3);
  }

  if (!target) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Route not found in API Gateway' }));
    return;
  }

  // Normalize path to replace multiple slashes (e.g. //) with a single /
  rewrittenUrl = rewrittenUrl.replace(/\/+/g, '/');

  if (!rewrittenUrl.startsWith('/')) {
    rewrittenUrl = '/' + rewrittenUrl;
  }
  console.log(`[Gateway] Redirect URL: ${target}/${rewrittenUrl}`);
  const parsedTarget = new URL(target);
  const options = {
    hostname: parsedTarget.hostname,
    port: parsedTarget.port,
    path: rewrittenUrl,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error(`[Gateway] Error forwarding to ${target}:`, err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ error: 'Bad Gateway - Microservice is unreachable' }),
    );
  });

  req.pipe(proxyReq, { end: true });
});

server.listen(PORT, () => {
  console.log(
    `🚀 [API Gateway]: Reverse proxy listening on http://localhost:${PORT}`,
  );
  console.log(`   - Forwarding JIRA requests to ${JIRA_TARGET}`);
  console.log(`   - Forwarding GitHub requests to ${GITHUB_TARGET}`);
});
