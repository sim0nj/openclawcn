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

app.get('/', (_req, res) => res.json({ service: 'gateway', status: 'ok', endpoints: ['/move', '/healthz'] }));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.listen(3200, () => console.log('Gateway server on :3200'));

