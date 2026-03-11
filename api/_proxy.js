const { Readable } = require('node:stream');

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

function buildTargetUrl(baseUrl, pathParts, query) {
  const url = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const normalizedPath = Array.isArray(pathParts) ? pathParts : (pathParts ? [pathParts] : []);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${normalizedPath.join('/')}`.replace(/\/{2,}/g, '/');
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (key === 'path') continue;
    if (Array.isArray(value)) {
      value.forEach(item => params.append(key, item));
    } else if (value != null) {
      params.set(key, value);
    }
  }
  url.search = params.toString();
  return url;
}

function buildHeaders(reqHeaders) {
  const headers = {};
  for (const [key, value] of Object.entries(reqHeaders || {})) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    if (value == null) continue;
    headers[key] = value;
  }
  return headers;
}

function buildBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  if (req.body == null) return undefined;
  if (Buffer.isBuffer(req.body) || typeof req.body === 'string') return req.body;
  return JSON.stringify(req.body);
}

async function proxyRequest(req, res, targetBaseUrl) {
  if (!targetBaseUrl) {
    res.status(500).json({ error: 'Target service URL is not configured' });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const targetUrl = buildTargetUrl(targetBaseUrl, req.query.path, req.query);
  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers: buildHeaders(req.headers),
    body: buildBody(req)
  });

  res.statusCode = upstream.status;
  for (const [key, value] of upstream.headers.entries()) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    res.setHeader(key, value);
  }

  if (!upstream.body) {
    res.end();
    return;
  }

  Readable.fromWeb(upstream.body).pipe(res);
}

module.exports = { proxyRequest };
