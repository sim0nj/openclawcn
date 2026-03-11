import express from 'express';
import cors from 'cors';
import { nanoid } from 'nanoid';
import { Chess } from 'chess.js';
import fetch from 'node-fetch';

const app = express();
app.use(cors());
app.use(express.json());

const matches = new Map();
const GATEWAY_URL = process.env.GATEWAY_URL || ''; // 可配置统一网关
const rooms = new Map();

app.get('/', (_req, res) => res.json({ service: 'chess-server', status: 'ok', endpoints: ['/matches', '/rooms'] }));
app.post('/matches', (req, res) => {
  const { white = 'openclaw', black = 'compatible-1', timeout = 5000 } = req.body || {};
  const id = 'chess_' + nanoid(8);
  const chess = new Chess();
  const m = {
    id, white, black, timeout,
    chess,
    listeners: new Set(),
    stopped: false
  };
  matches.set(id, m);
  res.json({ id });
  runMatch(m).catch(() => {});
});

app.get('/matches/:id/stream', (req, res) => {
  const m = matches.get(req.params.id);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  if (!m) {
    send({ type: 'status', message: 'match not found' });
    return res.end();
  }
  m.listeners.add(send);
  send({ type: 'state', fen: m.chess.fen() });
  req.on('close', () => m.listeners.delete(send));
});

// 房间：裁判创建，双方 Agent 分别加入，由裁判手动开赛
app.post('/rooms', (req, res) => {
  const { refereeName = '人类裁判', timeout = 5000 } = req.body || {};
  const id = 'room_' + nanoid(8);
  const room = {
    id,
    timeout,
    refereeToken: nanoid(12),
    inviteTokens: {
      white: nanoid(12),
      black: nanoid(12),
    },
    referee: {
      name: refereeName,
      role: 'referee',
    },
    seats: {
      white: null,
      black: null,
    },
    listeners: new Set(),
    matchId: null,
  };
  rooms.set(id, room);
  res.json({
    id,
    refereeToken: room.refereeToken,
    inviteTokens: room.inviteTokens,
  });
});

app.get('/rooms/:id/stream', (req, res) => {
  const room = rooms.get(req.params.id);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  if (!room) { send({ type: 'status', message: 'room not found' }); return res.end(); }
  room.listeners.add(send);
  send(roomSnapshot(room));
  req.on('close', () => room.listeners.delete(send));
});

app.post('/rooms/:id/join', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'room not found' });
  const { token, side, provider = 'compatible-1', agentName = provider, model = '' } = req.body || {};
  if (!['white', 'black'].includes(side)) return res.status(400).json({ error: 'side must be white or black' });
  if (token !== room.inviteTokens[side]) return res.status(403).json({ error: 'invalid token' });
  if (room.matchId) return res.json({ ok: true, matchId: room.matchId, room: roomSnapshot(room) });
  if (room.seats[side]) return res.status(409).json({ error: `${side} seat already occupied` });

  room.seats[side] = {
    side,
    provider,
    agentName,
    model,
    joinedAt: Date.now(),
  };

  broadcastRoom(room, roomSnapshot(room));
  res.json({ ok: true, matchId: room.matchId || null, room: roomSnapshot(room) });
});

app.post('/rooms/:id/start', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'room not found' });
  const { token } = req.body || {};
  if (token !== room.refereeToken) return res.status(403).json({ error: 'invalid referee token' });
  if (room.matchId) return res.json({ ok: true, matchId: room.matchId, room: roomSnapshot(room) });
  if (!room.seats.white || !room.seats.black) {
    return res.status(409).json({ error: 'both seats must be occupied before starting' });
  }

  const id = 'chess_' + nanoid(8);
  const chess = new Chess();
  const m = {
    id,
    white: room.seats.white.provider,
    black: room.seats.black.provider,
    timeout: room.timeout,
    chess,
    listeners: new Set(),
    stopped: false
  };
  matches.set(id, m);
  room.matchId = id;
  broadcastRoom(room, roomSnapshot(room));
  runMatch(m).catch(() => {});
  res.json({ ok: true, matchId: id, room: roomSnapshot(room) });
});

function broadcastRoom(room, evt) {
  room.listeners.forEach(fn => fn(evt));
}

function roomSnapshot(room) {
  return {
    type: 'room',
    id: room.id,
    status: room.matchId ? 'started' : (room.seats.white && room.seats.black ? 'ready' : 'waiting'),
    timeout: room.timeout,
    matchId: room.matchId,
    canStart: Boolean(!room.matchId && room.seats.white && room.seats.black),
    referee: room.referee,
    seats: {
      white: room.seats.white,
      black: room.seats.black,
    }
  };
}

function broadcast(m, evt) {
  m.listeners.forEach(fn => fn(evt));
}

async function chooseMoveViaGateway(provider, fen, turn, timeout) {
  if (!GATEWAY_URL) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const r = await fetch(`${GATEWAY_URL}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, fen, turn }),
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const data = await r.json();
    return data && data.move ? data.move : null; // 期望 SAN 或 UCI，视网关约定
  } catch {
    return null;
  }
}

function randomMove(chess) {
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return null;
  const mv = moves[Math.floor(Math.random() * moves.length)];
  return mv.san;
}

async function runMatch(m) {
  const { chess, timeout } = m;
  while (!chess.isGameOver() && !m.stopped) {
    const turn = chess.turn() === 'w' ? 'white' : 'black';
    const provider = turn === 'white' ? m.white : m.black;
    const fen = chess.fen();
    // 先尝试通过统一网关请求该 provider 的落子；无网关或失败则用随机合法步示范
    let san = await chooseMoveViaGateway(provider, fen, turn, timeout);
    if (!san) san = randomMove(chess);
    try {
      const move = chess.move(san, { sloppy: true });
      if (!move) {
        // 尝试从可行着法中选择
        const alt = randomMove(chess);
        if (!alt) break;
        const mv2 = chess.move(alt, { sloppy: true });
        if (!mv2) break;
        broadcast(m, { type: 'move', turn, san: mv2.san, fen: chess.fen() });
      } else {
        broadcast(m, { type: 'move', turn, san: move.san, fen: chess.fen() });
      }
    } catch {
      break;
    }
    await new Promise(r => setTimeout(r, 400));
  }
  let result = 'draw';
  if (chess.isCheckmate()) {
    result = chess.turn() === 'w' ? 'black wins' : 'white wins';
  } else if (chess.isStalemate() || chess.isThreefoldRepetition() || chess.isDraw()) {
    result = 'draw';
  }
  broadcast(m, { type: 'result', result, fen: chess.fen() });
}

app.listen(3100, () => console.log('Chess server on :3100'));
