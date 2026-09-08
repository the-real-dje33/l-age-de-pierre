const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const CHAR_W = 16;
const CHAR_H = 16;
const GRID_W = 20;
const GRID_H = 12;

const COLOR_BLACK = '#000000';
const COLOR_GREEN = '#00FF00';
const COLOR_YELLOW = '#FFFF00';
const COLOR_RED = '#FF0000';

// Symboles bitmap 8x8 extraits du BASIC CPC
const SYMBOLS = {
    255: [0xCF,0xCF,0xCF,0x00,0xF3,0xF3,0xF3,0x00],
    254: [0x7F,0xFF,0xC3,0xBF,0xBF,0xBF,0xBF,0xFF],
    253: [0xFC,0xFE,0xFE,0xFE,0xFE,0xFE,0xFE,0xFE],
    252: [0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0x7F,0x00],
    251: [0xFE,0xFE,0xFE,0xFE,0xFE,0xFE,0xFC,0x00],
    250: [0x07,0x1F,0x3F,0x7F,0x7F,0xFF,0xFF,0xFF],
    249: [0xE0,0xF8,0xFC,0xFE,0xFE,0xFF,0xFF,0xFF],
    248: [0xFF,0xFF,0xCF,0x47,0x63,0x33,0x1F,0x07],
    247: [0xFF,0xFF,0xFF,0xFE,0xFE,0xFC,0xF8,0xE0],
    246: [0x07,0x09,0x0F,0x0F,0x07,0x01,0x0F,0x17],
    245: [0xE0,0x90,0xF0,0xF0,0xE0,0x80,0xF0,0xE8],
    244: [0x33,0x31,0x33,0x26,0x0C,0x18,0x0C,0x1C],
    243: [0xCC,0x8C,0xCC,0x64,0x30,0x18,0x30,0x38],
    143: [0xAA,0x55,0xAA,0x55,0xAA,0x55,0xAA,0x55]
};

// ============================================================================
// MOTEUR AUDIO AY-3-8912 (AMSTRAD CPC)
// ============================================================================

const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function initAudio() {
    if (!audioCtx) audioCtx = new AudioContext();
}

/**
 * Convertit une période CPC (Registre Tone AY-3-8912) en Hertz
 * Horloge AY-3-8912 = 1 000 000 Hz
 */
function cpcPeriodToHz(period) {
    if (period <= 0) return 0;
    return 1000000 / (16 * period);
}

/**
 * Génère un buffer de bruit binaire selon le registre de bruit AY (Noise Period)
 */
function createCPCNoiseBuffer(noisePeriod, duration) {
    const noiseClock = 1000000 / (16 * Math.max(1, noisePeriod));
    const bufferSize = audioCtx.sampleRate * duration;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    
    let lastOut = 1;
    let sampleCounter = 0;
    const samplesPerNoiseClock = audioCtx.sampleRate / noiseClock;

    for (let i = 0; i < bufferSize; i++) {
        sampleCounter++;
        if (sampleCounter >= samplesPerNoiseClock) {
            sampleCounter = 0;
            lastOut = Math.random() < 0.5 ? -1 : 1;
        }
        data[i] = lastOut;
    }
    return buffer;
}

/**
 * Emulateur générique de la commande SOUND du CPC
 * @param {number} channelMask - Bit 0..2: Canal A/B/C, Bit 7: Active Noise (ex: 130 = Canal A + Bruit)
 * @param {number} period - Période de tonalité (1..4095)
 * @param {number} duration - Durée en 1/50ème de seconde (ex: 100 = 2s)
 * @param {number} volume - Volume initial (0..15)
 * @param {number} [env] - Numéro d'enveloppe
 * @param {number} [noisePeriod] - Période du générateur de bruit (1..31)
 */
function playCPCSound(channelMask, period, duration, volume = 7, env = 0, noisePeriod = 0) {
    if (!audioCtx) return;

    const now = audioCtx.currentTime;
    const durationSec = duration / 50;
    const maxGain = (volume / 15) * 0.2; // Normalisation du volume Web Audio

    const hasTone = (period > 0);
    const hasNoise = (channelMask & 128) !== 0 && noisePeriod > 0;

    const masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);

    // --- Gestion de l'Enveloppe (ENV) ---
    if (env === 5) { // Envelope 5: Attack, Down & Hold
        masterGain.gain.setValueAtTime(maxGain, now);
        masterGain.gain.linearRampToValueAtTime(0.001, now + durationSec);
    } else { // Enveloppe standard (constante puis extinction rapide)
        masterGain.gain.setValueAtTime(maxGain, now);
        masterGain.gain.setValueAtTime(maxGain, now + durationSec - 0.01);
        masterGain.gain.linearRampToValueAtTime(0.001, now + durationSec);
    }

    // --- Générateur de Tonalité (Onde carrée pure AY) ---
    if (hasTone) {
        const osc = audioCtx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(cpcPeriodToHz(period), now);
        
        const toneGain = audioCtx.createGain();
        toneGain.gain.value = hasNoise ? 0.5 : 1.0;
        
        osc.connect(toneGain);
        toneGain.connect(masterGain);
        
        osc.start(now);
        osc.stop(now + durationSec);
    }

    // --- Générateur de Bruit (Noise) ---
    if (hasNoise) {
        const noiseBuffer = createCPCNoiseBuffer(noisePeriod, durationSec);
        const noiseSource = audioCtx.createBufferSource();
        noiseSource.buffer = noiseBuffer;

        const noiseGain = audioCtx.createGain();
        noiseGain.gain.value = hasTone ? 0.5 : 1.0;

        noiseSource.connect(noiseGain);
        noiseGain.connect(masterGain);

        noiseSource.start(now);
        noiseSource.stop(now + durationSec);
    }
}

// ============================================================================
// EVENEMENTS SONORES DU JEU
// ============================================================================

// Ligne 1270: SOUND 129,50,100,7,1 (Prise de pomme)
function playCollectSound() {
    playCPCSound(1, 50, 4, 7); // Rendu court (4/50s) et aigu
}

// Ligne 1290: SOUND 130,200,100,7,1,2,5 (Chute de rocher)
function playFallSound() {
    // Canal 130 (A + Bruit), Période 200, Durée 100 (2s), Vol 7, Env 5, Période Bruit 2
    playCPCSound(130, 200, 100, 7, 5, 2);
}

// Ligne 1570: Boucle SOUND 1,i*100... / SOUND 2,1000-i*100... (Mort)
function playDeathSound() {
    if (!audioCtx) return;
    let now = audioCtx.currentTime;
    const stepDuration = 0.04;

    for (let i = 1; i <= 10; i++) {
        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc1.type = 'square';
        osc2.type = 'square';

        osc1.frequency.setValueAtTime(cpcPeriodToHz(i * 100), now + (i - 1) * stepDuration);
        osc2.frequency.setValueAtTime(cpcPeriodToHz(1000 - i * 100), now + (i - 1) * stepDuration);

        gain.gain.setValueAtTime(0.1, now + (i - 1) * stepDuration);
        gain.gain.linearRampToValueAtTime(0.01, now + i * stepDuration);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(audioCtx.destination);

        osc1.start(now + (i - 1) * stepDuration);
        osc2.start(now + (i - 1) * stepDuration);
        osc1.stop(now + i * stepDuration);
        osc2.stop(now + i * stepDuration);
    }
}

const LEVELS_DATA = [
    {
        map: [
            "mmmmmmmmmmmmmmmmmmmm",
            "m hrhhmmmmrrrmrmmmrm",
            "mhhhmpr mhhhhmp  hrm",
            "mrrhmmp mp  h   m rm",
            "mpphhhh mmm hmmrrhrm",
            "mhhhhhh rhmphmphhhrm",
            "mhmmmmmmrhmrrrrrrhrm",
            "mhmhhhhhmmmmmmmmmhrm",
            "mhmhphphprrrrrrrrhrm",
            "mhr  hhhhphphphphhrm",
            "mhrhphphprrrrrrrrrrm",
            "mmmmmmmmmmmmmmmmmmmm"
        ],
        pom: 18, tps: 150, startX: 2, startY: 2
    },
    {
        map: [
            "mmmmmmmmmmmmmmmmmmmm",
            "mrrmmmmmmmmmrrrrmrrm",
            "m hmmmmmmmmmmmmhrprm",
            "m hmmp p p  pppppprm",
            "m hmm p p mmrrrhrprm",
            "m hmmp p pmmrmmmrprm",
            "mhhmmmmmmmmmrppmrprm",
            "m hmmmmmmmmmmhrrmprm",
            "mhhrrrhhhr  hhhhhprm",
            "m hhhhhhhhmmrrrrrrrm",
            "mhhrrrrrrrmmmmmmmmmm",
            "mmmmmmmmmmmmmmmmmmmm"
        ],
        pom: 22, tps: 80, startX: 2, startY: 3
    },
    {
        map: [
            "mmmmmmmmmmmmmmmmmmmm",
            "mm r  hr r mrmmr  rm",
            "mmmpmmhhmh mprhhhhhm",
            "m hhhhhrhr hhhmmm  m",
            "mmmpmmhrhr mmmmrrm m",
            "mm r  hrhr hhhhhhhpm",
            "m hhhhhrhr mmmmmmmmm",
            "mm r  hrhr rrrrrrrrm",
            "mmmpmmhrhr hhhhhhhpm",
            "mphhhhhrhr mmmmmmmmm",
            "mrrrrrhrhr hhhhhhhpm",
            "mmmmmmmmmm mmmmmmmmm"
        ],
        pom: 8, tps: 150, startX: 2, startY: 4
    },
    {
        map: [
            "mmmmmmmmmmmmmmmmmmmm",
            "m hhhhhhrrrhhhhhhhhm",
            "mhhhhhhhhhprmmmmmmhm",
            "mphhhhhhrrhprmmmmmhm",
            "mrphhhhhmmrhprmmmhhm",
            "mrrphhhhhhmrhprmhphm",
            "mrrrphhhpphmrhprmhhm",
            "mrrrrphhmmphmrhprmmm",
            "mrrrrrphppmphmrhprmm",
            "mrrrrrrphhpmphmrhprm",
            "mrrrrrrrmmhpmphhr hm",
            "mmmmmmmmmmmmmmmmmmmm"
        ],
        pom: 26, tps: 80, startX: 2, startY: 2
    }
];

let gameState = "MENU";
let currentLevel = 0;
let score = 0;
let energy = 0;
let applesLeft = 0;
let playerX = 0;
let playerY = 0;
let levelGrid = [];

/**
 * Rendu standard des caractères BASIC CPC (SYMBOL)
 * 8 octets de 8 bits = Grille de 8x8 pixels (étirée en 16x16 sur le canvas)
 */
function drawSymbol(charCode, px, py, color) {
    const bytes = SYMBOLS[charCode];
    if (!bytes) return;

    for (let r = 0; r < 8; r++) {
        let byte = bytes[r];
        for (let c = 0; c < 8; c++) {
            // Test du bit courant (de bit 7 à bit 0)
            const bitSet = (byte & (0x80 >> c)) !== 0;
            
            ctx.fillStyle = bitSet ? color : COLOR_BLACK;
            ctx.fillRect(px + c * 2, py + r * 2, 2, 2);
        }
    }
}

function drawCell(type, gridX, gridY) {
    const px = gridX * 32;
    const py = gridY * 32;

    ctx.fillStyle = COLOR_BLACK;
    ctx.fillRect(px, py, 32, 32);

    if (type === 'm') {
        // Mur (Rouge) : Briques (SYMBOL 255)
        for (let y = 0; y < 32; y += 16) {
            for (let x = 0; x < 32; x += 16) {
                drawSymbol(255, px + x, py + y, COLOR_RED);
            }
        }
    }
    else if (type === 'h') {
        // Herbe (Vert) : Damier parfait (ASCII 143)
        for (let y = 0; y < 32; y += 16) {
            for (let x = 0; x < 32; x += 16) {
                drawSymbol(143, px + x, py + y, COLOR_GREEN);
            }
        }
    }
    else if (type === 'r') {
        // Rocher : 4 symboles en Jaune
        drawSymbol(254, px, py, COLOR_YELLOW);
        drawSymbol(253, px + 16, py, COLOR_YELLOW);
        drawSymbol(252, px, py + 16, COLOR_YELLOW);
        drawSymbol(251, px + 16, py + 16, COLOR_YELLOW);
    }
    else if (type === 'p') {
        // Pomme : 4 symboles en Rouge
        drawSymbol(250, px, py, COLOR_RED);
        drawSymbol(249, px + 16, py, COLOR_RED);
        drawSymbol(248, px, py + 16, COLOR_RED);
        drawSymbol(247, px + 16, py + 16, COLOR_RED);
    }
}

function drawPlayer(gridX, gridY) {
    const px = (gridX - 1) * 32;
    const py = (gridY - 1) * 32;
    drawSymbol(246, px, py, COLOR_YELLOW);
    drawSymbol(245, px + 16, py, COLOR_YELLOW);
    drawSymbol(244, px, py + 16, COLOR_YELLOW);
    drawSymbol(243, px + 16, py + 16, COLOR_YELLOW);
}

function loadLevel(levelIdx) {
    const lvl = LEVELS_DATA[levelIdx];
    levelGrid = lvl.map.map(row => row.split(''));
    applesLeft = lvl.pom;
    energy = lvl.tps;
    playerX = lvl.startX;
    playerY = lvl.startY;
}

function renderBoard() {
    ctx.fillStyle = COLOR_BLACK;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
            drawCell(levelGrid[y][x], x, y);
        }
    }

    drawPlayer(playerX, playerY);

    ctx.fillStyle = COLOR_YELLOW;
    ctx.font = '20px "Courier New", monospace';
    ctx.textAlign = 'left';
    
    let scStr = String(score).padStart(5, ' ');
    let enStr = String(energy).padStart(3, ' ');
    let poStr = String(applesLeft).padStart(2, ' ');

    ctx.fillText(`SCORE:  ${scStr}       ENERGIE: ${enStr}   POMMES: ${poStr}`, 10, GRID_H * 32 + 24);
}

function drawMenu() {
    ctx.fillStyle = COLOR_BLACK;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = COLOR_YELLOW;
    ctx.font = 'bold 22px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText("L'AGE DE PIERRE", canvas.width / 2, 40);

    ctx.fillStyle = COLOR_GREEN;
    ctx.font = '14px "Courier New", monospace';
    ctx.textAlign = 'left';

    const lines = [
        "LE BUT DU JEU: Vous devez au travers de 4 salles",
        "guider un personnage dont la seule raison d'etre est",
        "de ramasser les fruits rouges tapissant le sol.",
        "",
        "TOUTEFOIS: Sa quete ne sera pas sans danger,car",
        "frequents sont les eboulements.",
        "",
        "DEROULEMENT DE LA PARTIE: Vous vous dirigez grace aux",
        "fleches du curseur, chaque deplacement occasionnant",
        "la perte d'un point d'energie.",
        "Bien evidemment, si votre total energetique parvient a",
        "zero, vous mourrez et la partie se termine.",
        "",
        "Chaque fois que vous passez sous une pierre celle ci",
        "tombe. Vous avez la possibilite de pousser un de ces",
        "blocs si il y a de la place derriere.",
        "L'herbe ne fait pas obstacle a vos mouvements.",
        "",
        "Pressez la barre d'espacement pour jouer, ou 'D'..."
    ];

    let startY = 70;
    lines.forEach((line) => {
        ctx.fillText(line, 20, startY);
        startY += 17;
    });
}

function handleInput(e) {
    initAudio();

    if (gameState === "MENU") {
        if (e.code === "Space") {
            score = 0;
            currentLevel = 0;
            loadLevel(currentLevel);
            gameState = "PLAY";
            renderBoard();
        } else if (e.key.toLowerCase() === "d") {
            gameState = "DEMO";
            runDemoMode();
        }
        return;
    }

    if (gameState === "WIN" || gameState === "GAMEOVER") {
        gameState = "MENU";
        drawMenu();
        return;
    }

    if (gameState !== "PLAY") return;

    let dx = 0;
    let dy = 0;

    if (e.key === "ArrowUp") dy = -1;
    else if (e.key === "ArrowDown") dy = 1;
    else if (e.key === "ArrowLeft") dx = -1;
    else if (e.key === "ArrowRight") dx = 1;

    if (dx !== 0 || dy !== 0) {
        movePlayer(dx, dy);
    }
}

function movePlayer(dx, dy) {
    let targetX = playerX + dx;
    let targetY = playerY + dy;

    energy--;
    if (energy <= 0) {
        gameOver();
        return;
    }

    let gx = targetX - 1;
    let gy = targetY - 1;
    let targetTile = levelGrid[gy] ? levelGrid[gy][gx] : 'm';

    let prevGX = playerX - 1;
    let prevGY = playerY - 1;
    let tileAbove = levelGrid[prevGY - 1] ? levelGrid[prevGY - 1][prevGX] : 'm';
    let checkRockFall = (tileAbove === 'r');

    if (dy < 0) {
        if (targetTile === ' ') { playerY--; }
        else if (targetTile === 'h') { levelGrid[gy][gx] = ' '; playerY--; }
        else if (targetTile === 'p') { collectApple(gx, gy); playerY--; }
    } 
    else if (dy > 0) {
        if (targetTile === ' ') { playerY++; }
        else if (targetTile === 'h') { levelGrid[gy][gx] = ' '; playerY++; }
        else if (targetTile === 'p') { collectApple(gx, gy); playerY++; }
    } 
    else if (dx < 0) {
        if (targetTile === ' ') { playerX--; }
        else if (targetTile === 'h') { levelGrid[gy][gx] = ' '; playerX--; }
        else if (targetTile === 'p') { collectApple(gx, gy); playerX--; }
        else if (targetTile === 'r') {
            if (levelGrid[gy][gx - 1] === ' ') {
                levelGrid[gy][gx - 1] = 'r';
                levelGrid[gy][gx] = ' ';
                playerX--;
                triggerRockFall(gx - 1, gy + 1);
            }
        }
    } 
    else if (dx > 0) {
        if (targetTile === ' ') { playerX++; }
        else if (targetTile === 'h') { levelGrid[gy][gx] = ' '; playerX++; }
        else if (targetTile === 'p') { collectApple(gx, gy); playerX++; }
        else if (targetTile === 'r') {
            if (levelGrid[gy][gx + 1] === ' ') {
                levelGrid[gy][gx + 1] = 'r';
                levelGrid[gy][gx] = ' ';
                playerX++;
                triggerRockFall(gx + 1, gy + 1);
            }
        }
    }

    renderBoard();

    if (checkRockFall) {
        triggerRockFall(prevGX, prevGY);
    }

    if (applesLeft <= 0) {
        currentLevel++;
        if (currentLevel >= 4) {
            gameWin();
        } else {
            loadLevel(currentLevel);
            renderBoard();
        }
    }
}

function collectApple(gx, gy) {
    score += 150;
    applesLeft--;
    levelGrid[gy][gx] = ' ';
    playCollectSound();
}

function triggerRockFall(gx, gy) {
    if (levelGrid[gy] && levelGrid[gy][gx] === ' ') {
        playFallSound();
        levelGrid[gy - 1][gx] = ' ';
        levelGrid[gy][gx] = 'r';

        if (gx === (playerX - 1) && gy === (playerY - 1)) {
            gameOver();
            return;
        }

        renderBoard();
        setTimeout(() => triggerRockFall(gx, gy + 1), 120);
    }
}

function gameOver() {
    gameState = "GAMEOVER";
    playDeathSound();
    ctx.fillStyle = COLOR_BLACK;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = COLOR_YELLOW;
    ctx.font = '22px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText("Vous avez perdu !!!", canvas.width / 2, canvas.height / 2);
}

function gameWin() {
    gameState = "WIN";
    ctx.fillStyle = COLOR_BLACK;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = COLOR_YELLOW;
    ctx.font = 'bold 22px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText("* VOUS AVEZ GAGNE *", canvas.width / 2, 80);

    ctx.fillStyle = COLOR_GREEN;
    ctx.font = '14px "Courier New", monospace';
    ctx.fillText("Vous etes le premier qui ait reussi cet exploit.", canvas.width / 2, 140);
    ctx.fillText("Nous nous souviendrons de vous comme etant LE SEUL hero !", canvas.width / 2, 170);
    ctx.fillText(`Votre score: ${score}`, canvas.width / 2, 220);
    ctx.fillText("Une touche... Et ca repart !!!", canvas.width / 2, 300);
}

function runDemoMode() {
    let demoLvl = 0;
    loadLevel(demoLvl);
    renderBoard();

    let demoTimer = setInterval(() => {
        demoLvl++;
        if (demoLvl < 4) {
            loadLevel(demoLvl);
            renderBoard();
        } else {
            clearInterval(demoTimer);
            gameState = "MENU";
            drawMenu();
        }
    }, 2500);
}

window.addEventListener('keydown', handleInput);
drawMenu();