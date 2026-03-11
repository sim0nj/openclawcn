import express from 'express';
import cors from 'cors';
import { Chess } from 'chess.js';
import fetch from 'node-fetch';

const app = express();
app.use(cors());
app.use(express.json());

// 可选：通过环境变量配置具体 provider 的上游 HTTP 端点
// 例如： PROVIDER_openclaw=https://openclaw.example.com/move
const providerEndpoints = {};
for (const [k, v] of Object.entries(process.env)) {
  if (k.startsWith('PROVIDER_') && v) {
    const name = k.substring('PROVIDER_'.length).toLowerCase();
    providerEndpoints[name] = v;
  }
}

const METADATA_TIMEOUT_MS = 5000;

function metadataUrlFor(upstream) {
  if (!upstream) return '';
  return upstream.replace(/\/move\/?$/, '/metadata');
}

function createHttpError(status, error) {
  const err = new Error(error);
  err.status = status;
  return err;
}

function validateMetadataPayload(data) {
  if (!data || typeof data !== 'object') {
    throw createHttpError(422, 'provider metadata must be a JSON object');
  }
  if (typeof data.agentName !== 'string' || !data.agentName.trim()) {
    throw createHttpError(422, 'provider metadata.agentName is required');
  }
  if (typeof data.model !== 'string' || !data.model.trim()) {
    throw createHttpError(422, 'provider metadata.model is required');
  }
  if (data.vendor != null && (typeof data.vendor !== 'string' || !data.vendor.trim())) {
    throw createHttpError(422, 'provider metadata.vendor must be a non-empty string');
  }
  if (data.version != null && (typeof data.version !== 'string' || !data.version.trim())) {
    throw createHttpError(422, 'provider metadata.version must be a non-empty string');
  }
  if (data.capabilities != null && !Array.isArray(data.capabilities)) {
    throw createHttpError(422, 'provider metadata.capabilities must be an array');
  }
  return {
    agentName: data.agentName.trim(),
    model: data.model.trim(),
    vendor: typeof data.vendor === 'string' ? data.vendor.trim() : '',
    version: typeof data.version === 'string' ? data.version.trim() : '',
    capabilities: Array.isArray(data.capabilities)
      ? data.capabilities.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
      : []
  };
}

async function providerInfo(name) {
  const provider = (name || '').toLowerCase();
  const upstream = providerEndpoints[provider];
  if (!upstream) {
    throw createHttpError(404, `provider ${provider || 'unknown'} is not configured`);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), METADATA_TIMEOUT_MS);
  try {
    const r = await fetch(metadataUrlFor(upstream), { signal: ctrl.signal });
    if (!r.ok) {
      throw createHttpError(422, `provider metadata request failed with status ${r.status}`);
    }
    const validated = validateMetadataPayload(await r.json());
    return {
      ...validated,
      provider,
      metadataSource: 'agent-metadata'
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw createHttpError(422, 'provider metadata request timed out');
    }
    if (error.status) throw error;
    throw createHttpError(422, `provider metadata unavailable: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// 策略库（演示用）：对不同 provider 名字映射不同策略
function choosePolicyMove(provider, fen) {
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return null;
  const name = (provider || '').toLowerCase();
  if (name.includes('rock')) {
    // 偏好兵推进或简单发展
    const pawnPush = moves.find(m => m.piece === 'p');
    return (pawnPush || moves[0]).san;
  }
  if (name.includes('tft') || name.includes('claw')) {
    // 简单优先王翼发展
    const prefer = ['Nf3', 'Nc3', 'e4', 'd4', 'O-O'];
    const hit = moves.find(m => prefer.includes(m.san));
    return (hit || moves[0]).san;
  }
  // 随机合法步
  return moves[Math.floor(Math.random() * moves.length)].san;
}

app.post('/move', async (req, res) => {
  const { provider, fen, turn } = req.body || {};
  if (!fen) return res.status(400).json({ error: 'fen required' });
  const name = (provider || '').toLowerCase();

  // 如果配置了上游端点，优先调用上游
  const upstream = providerEndpoints[name];
  if (upstream) {
    try {
      const r = await fetch(upstream, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen, turn })
      });
      if (r.ok) {
        const data = await r.json();
        if (data && data.move) return res.json({ move: data.move });
      }
    } catch { /* fall through to local policy */ }
  }

  // 使用本地策略生成 SAN
  const san = choosePolicyMove(name, fen);
  if (!san) return res.status(422).json({ error: 'no legal move' });
  return res.json({ move: san });
});

app.get('/providers/:provider', async (req, res) => {
  try {
    const info = await providerInfo(req.params.provider);
    res.json(info);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'provider metadata failed' });
  }
});

app.get('/', (_req, res) => res.json({ service: 'gateway', status: 'ok', endpoints: ['/move', '/providers/:provider', '/healthz'] }));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.listen(3200, () => console.log('Gateway server on :3200'));
