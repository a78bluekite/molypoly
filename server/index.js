const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const os      = require('os');

const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer);

// ── 공개 URL (환경에 따라 설정됨) ────────────────────────────────
let publicURL  = process.env.PUBLIC_URL || null; // 클라우드 배포 시 직접 주입 가능
let isFixedURL = !!process.env.PUBLIC_URL || false; // true = 항상 같은 URL

// ── 클라우드 환경 감지 (Render / Railway / Fly.io / …) ───────────
const isCloud = !!(
  process.env.RENDER ||
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.FLY_APP_NAME ||
  process.env.DYNO          // Heroku
);

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../molypoly.html'));
});
app.get('/api/share-url', (req, res) => {
  res.json({ url: publicURL });
});
app.use(express.static(path.join(__dirname, '..')));

// ── Room state ─────────────────────────────────────────────────
const rooms = {};

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function broadcastRoom(code) {
  const r = rooms[code];
  if (r) io.to(code).emit('room_update', { players: r.players, host: r.host });
}

// ── Socket.io ──────────────────────────────────────────────────
io.on('connection', socket => {
  let myRoom = null;
  let myName = '플레이어';

  socket.on('create_room', ({ name, password, moleChar }) => {
    let code;
    do { code = makeCode(); } while (rooms[code]);
    myRoom = code;
    myName = (name || '플레이어').slice(0, 12);
    rooms[code] = {
      password: password || '',
      host: socket.id,
      players: { [socket.id]: { name: myName, score: 0, done: false, moleChar: moleChar || 'brown' } },
      started: false,
    };
    socket.join(code);
    socket.emit('room_created', { code, publicURL, isFixedURL });
    broadcastRoom(code);
  });

  socket.on('join_room', ({ code, name, password, moleChar }) => {
    const roomCode = (code || '').toUpperCase();
    const room = rooms[roomCode];
    if (!room)          { socket.emit('join_error', '방이 없습니다'); return; }
    if (room.started)   { socket.emit('join_error', '이미 시작된 게임입니다'); return; }
    if (room.password && room.password !== (password || '')) {
      socket.emit('join_error', '비밀번호가 틀렸습니다'); return;
    }
    myRoom = roomCode;
    myName = (name || '플레이어').slice(0, 12);
    room.players[socket.id] = { name: myName, score: 0, done: false, moleChar: moleChar || 'brown' };
    socket.join(myRoom);
    socket.emit('join_ok', { code: myRoom, host: room.host });
    broadcastRoom(myRoom);
  });

  socket.on('start_game', () => {
    const room = rooms[myRoom];
    if (!room || room.host !== socket.id) return;
    room.started = true;
    io.to(myRoom).emit('game_start');
  });

  socket.on('score_update', score => {
    const room = rooms[myRoom];
    if (!room) return;
    room.players[socket.id].score = score;
    socket.to(myRoom).emit('score_broadcast', { id: socket.id, players: room.players });
  });

  socket.on('game_end', score => {
    const room = rooms[myRoom];
    if (!room) return;
    room.players[socket.id].score = score;
    room.players[socket.id].done  = true;
    if (Object.values(room.players).every(p => p.done)) {
      io.to(myRoom).emit('all_finished', { players: room.players });
    } else {
      io.to(myRoom).emit('score_broadcast', { id: socket.id, players: room.players });
    }
  });

  socket.on('disconnect', () => {
    if (!myRoom || !rooms[myRoom]) return;
    const room = rooms[myRoom];
    delete room.players[socket.id];
    if (Object.keys(room.players).length === 0) {
      delete rooms[myRoom]; return;
    }
    if (room.host === socket.id) {
      room.host = Object.keys(room.players)[0];
      io.to(myRoom).emit('host_changed', room.host);
    }
    broadcastRoom(myRoom);
  });
});

// ── Listen ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3456;
httpServer.listen(PORT, '0.0.0.0', async () => {
  console.log('\n========================================');
  console.log('  MolyPoly 두더지 잡기 서버');
  console.log('========================================');

  if (isCloud) {
    // ── 클라우드 배포 환경 ─────────────────────────────────────
    // PUBLIC_URL 환경변수가 있으면 사용, 없으면 Render 기본 URL 추정
    if (!publicURL && process.env.RENDER_EXTERNAL_URL) {
      publicURL  = process.env.RENDER_EXTERNAL_URL;
      isFixedURL = true;
    }
    if (publicURL) isFixedURL = true;
    console.log(`  포트:   ${PORT}`);
    if (publicURL) console.log(`  URL:    ${publicURL} (고정 URL)`);
    console.log('  (클라우드 환경 - 터널 비활성화)');
  } else {
    // ── 로컬 실행 환경 ──────────────────────────────────────────
    console.log(`  로컬:  http://localhost:${PORT}`);
    for (const ifaces of Object.values(os.networkInterfaces())) {
      for (const iface of ifaces) {
        if (iface.family === 'IPv4' && !iface.internal)
          console.log(`  WiFi:  http://${iface.address}:${PORT}`);
      }
    }

    // 설정 파일에서 고정 서브도메인 읽기
    let subdomain;
    try {
      const cfg = require('../config.json');
      subdomain = cfg.tunnel_subdomain;
    } catch (_) {}

    console.log('\n[터널] 공개 URL 생성 중...');
    if (subdomain) console.log(`  고정 서브도메인: ${subdomain}.loca.lt`);

    try {
      const localtunnel = require('localtunnel');
      const opts = { port: PORT };
      if (subdomain) opts.subdomain = subdomain;

      const tunnel = await localtunnel(opts);
      publicURL  = tunnel.url;
      isFixedURL = !!(subdomain && publicURL.includes(subdomain));

      console.log('========================================');
      console.log(`  공개 URL:  ${publicURL}`);
      if (isFixedURL) {
        console.log('  ✅ 고정 URL - 항상 동일한 주소!');
      } else if (subdomain) {
        console.log(`  ⚠️  "${subdomain}" 사용 불가 → 임시 URL 배정됨`);
      }
      console.log('  인터넷 어디서나 접속 가능!');
      console.log('========================================\n');

      tunnel.on('close', () => { publicURL = null; isFixedURL = false; });
      tunnel.on('error',  () => { publicURL = null; });
    } catch (e) {
      console.log('[터널] 공개 URL 생성 실패 (WiFi 모드)\n');
    }
  }

  console.log('========================================\n');
});
