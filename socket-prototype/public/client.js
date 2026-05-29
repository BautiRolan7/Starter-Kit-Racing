const socket = io({ transports: ['websocket'] });

function log(msg) {
    const el = document.getElementById('debugLog');
    if (el) {
        el.innerHTML += '<br>' + msg;
        el.scrollTop = el.scrollHeight;
    }
    console.log(msg);
}

socket.on('connect', () => {
    log('Conectado al servidor. ID: ' + socket.id);
});

socket.on('disconnect', () => {
    log('Desconectado del servidor.');
});

// Elementos
const loginScreen = document.getElementById('loginScreen');
const controllerScreen = document.getElementById('controllerScreen');
const roomCodeInput = document.getElementById('roomCodeInput');
const playerNameInput = document.getElementById('playerNameInput');
const joinBtn = document.getElementById('joinBtn');
const errorMsg = document.getElementById('errorMsg');
const currentRoomDisplay = document.getElementById('currentRoomDisplay');

let currentRoom = null;

// Rellenar código si viene en la URL
const urlParams = new URLSearchParams(window.location.search);
const codeParam = urlParams.get('code');
if (codeParam) {
    roomCodeInput.value = codeParam.toUpperCase();
}

// Unirse a sala
joinBtn.addEventListener('click', () => {
    const code = roomCodeInput.value.trim().toUpperCase();
    const name = playerNameInput.value.trim();
    
    if (!name) {
        errorMsg.innerText = 'Por favor, ingresa tu nombre.';
        return;
    }
    
    if (code.length === 4) {
        log('Intentando unirse a la sala: ' + code);
        socket.emit('joinRoom', { code: code, name: name });
    } else {
        errorMsg.innerText = 'El código debe tener 4 letras.';
    }
});

socket.on('joinedRoom', (playerInfo) => {
    currentRoom = roomCodeInput.value.trim().toUpperCase();
    log('Unido con éxito a la sala ' + currentRoom + '. ID: ' + playerInfo.id);
    loginScreen.classList.remove('active');
    controllerScreen.classList.add('active');
    currentRoomDisplay.innerText = currentRoom;
    
    // Dar un color dinámico al mando basado en su color de jugador
    document.body.style.backgroundColor = playerInfo.color;
});

socket.on('error', (msg) => {
    log('Error recibido del servidor: ' + msg);
    errorMsg.innerText = msg;
});

socket.on('hostDisconnected', () => {
    log('El host se ha desconectado. Recargando...');
    alert('El host se ha desconectado.');
    location.reload();
});

// Contenedor del mando
const gamepadContainer = document.getElementById('gamepadContainer');

// Configurar los controles (optimizados para no saturar)
const buttons = document.querySelectorAll('[data-action]');

// Detectar soporte touch para asignar eventos adecuados
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
log('Detectado dispositivo tactil: ' + isTouchDevice);
const eventStart = isTouchDevice ? 'touchstart' : 'mousedown';
const eventEnd = isTouchDevice ? 'touchend' : 'mouseup';
const eventLeave = isTouchDevice ? 'touchcancel' : 'mouseleave';

buttons.forEach(btn => {
    const action = btn.getAttribute('data-action');

    const handlePress = (e) => {
        e.preventDefault(); // Evitar comportamientos por defecto como zoom o scroll
        if (!btn.classList.contains('pressed')) {
            btn.classList.add('pressed');
            log('Pulsado ' + action);
            sendCommand(action, true);
        }
    };

    const handleRelease = (e) => {
        e.preventDefault();
        if (btn.classList.contains('pressed')) {
            btn.classList.remove('pressed');
            log('Liberado ' + action);
            sendCommand(action, false);
        }
    };

    btn.addEventListener(eventStart, handlePress);
    btn.addEventListener(eventEnd, handleRelease);
    btn.addEventListener(eventLeave, handleRelease);
    
    // Evitar menú contextual en móvil en long press
    btn.addEventListener('contextmenu', e => e.preventDefault());
});

function sendCommand(action, state) {
    if (currentRoom) {
        log('Emitiendo comando ' + action + ': ' + state);
        socket.emit('command', {
            roomCode: currentRoom,
            action: action,
            state: state
        });
    } else {
        log('Error: no hay sala asignada para enviar comando ' + action);
    }
}
