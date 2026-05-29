const socket = io();

let roomCode = '';
const players = {}; // id -> { element, x, y, commands, color }
const speed = 5;

// Elements
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const gameArena = document.getElementById('gameArena');

// Solicitar creación de sala al conectar
socket.on('connect', () => {
    socket.emit('createRoom');
});

socket.on('roomCreated', (data) => {
    roomCode = data.code || data; // Retrocompatibilidad
    roomCodeDisplay.innerText = roomCode;
    
    if (data.qr) {
        document.getElementById('qrContainer').style.display = 'inline-block';
        const qrImg = document.getElementById('qrCodeImage');
        if (qrImg) qrImg.src = data.qr;
    }
});

socket.on('playerJoined', (playerInfo) => {
    console.log('Player joined:', playerInfo);
    
    // Crear elemento para el jugador
    const el = document.createElement('div');
    el.classList.add('player');
    el.style.backgroundColor = playerInfo.color;
    
    // Posición inicial (centro de la arena)
    const x = gameArena.clientWidth / 2 - 30;
    const y = gameArena.clientHeight / 2 - 30;
    
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    
    gameArena.appendChild(el);
    
    players[playerInfo.id] = {
        element: el,
        x: x,
        y: y,
        color: playerInfo.color,
        commands: {
            accelerate: false,
            brake: false,
            left: false,
            right: false
        }
    };
});

socket.on('playerCommand', (data) => {
    const player = players[data.id];
    if (player) {
        player.commands[data.action] = data.state;
    }
});

socket.on('playerDisconnected', (id) => {
    if (players[id]) {
        players[id].element.remove();
        delete players[id];
    }
});

// Game loop simple para el movimiento fluido
function update() {
    for (const id in players) {
        const p = players[id];
        
        if (p.commands.accelerate) p.y -= speed;
        if (p.commands.brake) p.y += speed;
        if (p.commands.left) p.x -= speed;
        if (p.commands.right) p.x += speed;
        
        // Limites de pantalla (el jugador mide 60x60)
        p.x = Math.max(0, Math.min(gameArena.clientWidth - 60, p.x));
        p.y = Math.max(0, Math.min(gameArena.clientHeight - 60, p.y));
        
        p.element.style.left = `${p.x}px`;
        p.element.style.top = `${p.y}px`;
    }
    requestAnimationFrame(update);
}

// Iniciar game loop
update();
