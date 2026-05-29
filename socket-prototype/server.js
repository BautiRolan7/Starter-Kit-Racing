const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, '..'))); // Servir el repositorio 3D

// Redirigir la raíz a index.html para que no salga "Not Found"
app.get('/', (req, res) => {
  res.redirect('/index.html');
});

// Store rooms and their hosts
const rooms = {}; // roomCode -> hostSocketId
const roomPlayerCounts = {}; // roomCode -> player count

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Host creates a room
  socket.on('createRoom', async () => {
    const roomCode = generateRoomCode();
    socket.join(roomCode);
    rooms[roomCode] = socket.id;
    roomPlayerCounts[roomCode] = 0;
    
    let host = socket.handshake.headers.host;
    let protocol = socket.handshake.headers['x-forwarded-proto'] || 'http';
    
    // Si estamos en local (localhost), usamos la IP de la red
    if (host && (host.startsWith('localhost') || host.startsWith('127.0.0.1'))) {
        const localIp = getLocalIp();
        host = `${localIp}:${PORT}`;
        protocol = 'http';
    }
    
    const joinUrl = `${protocol}://${host}/control.html?code=${roomCode}`;
    
    try {
        const qrCodeDataUrl = await QRCode.toDataURL(joinUrl, {
            color: { dark: '#0f172a', light: '#ffffff' },
            width: 200,
            margin: 2
        });
        socket.emit('roomCreated', { code: roomCode, qr: qrCodeDataUrl });
    } catch (err) {
        console.error('Error generando QR', err);
        socket.emit('roomCreated', { code: roomCode });
    }
    
    console.log(`Host ${socket.id} created room: ${roomCode}`);
  });

  // Client joins a room
  socket.on('joinRoom', (data) => {
    const roomCode = typeof data === 'string' ? data : data.code;
    const playerName = typeof data === 'string' ? 'Jugador' : (data.name || 'Jugador');
    const code = roomCode.toUpperCase();
    
    if (rooms[code]) {
      socket.join(code);
      // Asignar color secuencial
      const playerColors = ['#fbbf24', '#22c55e', '#a855f7', '#ef4444'];
      const pIndex = (roomPlayerCounts[code] || 0) % 4;
      roomPlayerCounts[code] = (roomPlayerCounts[code] || 0) + 1;
      
      const playerInfo = {
        id: socket.id,
        name: playerName,
        color: playerColors[pIndex]
      };
      
      // Notify the client that they joined successfully
      socket.emit('joinedRoom', playerInfo);
      
      // Notify the host that a new player joined
      io.to(rooms[code]).emit('playerJoined', playerInfo);
      console.log(`Player ${socket.id} joined room: ${code}`);
    } else {
      socket.emit('error', 'Sala no encontrada');
    }
  });

  // Handle client input (commands)
  socket.on('command', (data) => {
    // data = { roomCode: 'ABCD', action: 'accelerate', state: true }
    if (data.roomCode && rooms[data.roomCode]) {
      // Forward the command to the host of that room
      io.to(rooms[data.roomCode]).emit('playerCommand', {
        id: socket.id,
        action: data.action,
        state: data.state
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Find if the disconnected user is a host
    for (const [roomCode, hostId] of Object.entries(rooms)) {
      if (hostId === socket.id) {
        // Host disconnected
        io.to(roomCode).emit('hostDisconnected');
        delete rooms[roomCode];
        delete roomPlayerCounts[roomCode];
        return;
      }
    }
    
    // Otherwise, assume it might be a player and notify all rooms they might be in
    for (const [roomCode, hostId] of Object.entries(rooms)) {
      io.to(hostId).emit('playerDisconnected', socket.id);
    }
  });
});

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

server.listen(PORT, () => {
  console.log(`\n=========================================`);
  console.log(`🎮 Servidor Multijugador Inicializado`);
  console.log(`=========================================`);
  console.log(`[PC / HOST] Abre: http://localhost:${PORT}/index.html`);
  console.log(`[CELULAR]   Abre: http://[TU_IP_LOCAL]:${PORT}/control.html`);
  console.log(`=========================================\n`);
});
