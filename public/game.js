/**
 * ===========================================
 * VELLOX - CYBER DEFENSE SIMULATOR
 * Booz Allen Hamilton | Fight AI With AI
 * Main Game Module
 * ===========================================
 *
 * A Space-Invaders-style cyber-defense game themed around Booz Allen's
 * Vellox AI-native product suite (Reverser, Ranger, Navigator), with
 * Microsoft Foundry Local LLM integration for a dynamic AI Commander.
 */

import { llmManager } from './llm.js';
import { soundManager } from './sound.js';

// ============================================
// Game Configuration
// ============================================

const CONFIG = {
    canvas: {
        width: 600,
        height: 500
    },
    player: {
        width: 50,
        height: 30,
        speed: 7,           // Slightly faster player
        color: '#22d3ee',   // Vellox defender cyan
        lives: 5            // More lives to start
    },
    enemy: {
        width: 40,
        height: 30,
        rows: 3,            // Fewer rows (was 4)
        cols: 7,            // Fewer columns (was 8)
        padding: 15,        // More space between enemies
        startY: 60,
        speedX: 0.8,        // Much slower (was 1.5)
        dropDistance: 20,   // Smaller drops (was 25)
        shootChance: 0.001  // Much lower (was 0.003)
    },
    projectile: {
        width: 4,
        height: 15,
        playerSpeed: 10,    // Faster player shots (was 8)
        enemySpeed: 2.5,    // Slower enemy shots (was 4)
        playerColor: '#22d3ee',  // Vellox cyan
        enemyColor: '#ff2b4e'    // Adversary red
    },
    powerUp: {
        width: 25,
        height: 25,
        speed: 2,
        spawnChance: 0.008,  // Frequent power-ups
        // Weapons map to the three Vellox products (laser=Reverser,
        // missile=Ranger, spread=Navigator); the rest are support capabilities.
        types: ['spread', 'laser', 'missile', 'shield', 'extraLife', 'bomb', 'bonus'],
        duration: 8000       // Product deployments last 8 seconds
    },
    scoring: {
        enemyKill: 10,
        levelBonus: 500,
        powerUpBonus: 100
    },
    difficulty: {
        speedIncrease: 0.12,        // Gentler scaling (was 0.15)
        shootChanceIncrease: 0.0003 // Gentler scaling (was 0.0005)
    },
    llm: {
        tauntInterval: 8000,      // Time between taunts (ms)
        briefingDelay: 2000,       // Delay before showing briefing
        commentInterval: 15000     // Time between performance comments
    }
};

// ============================================
// Vellox Branding / Narrative
// ============================================

// The cyber adversary — enemy rows read top-to-bottom as escalating threats
const ADVERSARY_TYPES = ['MALWARE', 'RANSOMWARE', 'APT'];

// Each level foregrounds one Vellox product phase (cycles as levels climb),
// so the campaign walks the operator through the portfolio: analyze, hunt, monitor.
const VELLOX_PHASES = [
    {
        product: 'VELLOX REVERSER',
        desc: 'Vellox Reverser is dissecting the adversary payload — reverse-engineering the threat in minutes.'
    },
    {
        product: 'VELLOX RANGER',
        desc: 'Vellox Ranger is autonomously mapping the environment and hunting the intrusion to ground.'
    },
    {
        product: 'VELLOX NAVIGATOR',
        desc: 'Vellox Navigator is holding continuous watch across every vector, enforcing compliance in real time.'
    }
];

/** The Vellox product phase that themes a given level. */
function getPhase(level) {
    return VELLOX_PHASES[(level - 1) % VELLOX_PHASES.length];
}

// ============================================
// Game State
// ============================================

const gameState = {
    // Core state
    running: false,
    paused: false,
    gameOver: false,
    levelComplete: false,
    
    // Score and progress
    score: 0,
    highScore: 0,
    lives: CONFIG.player.lives,
    level: 1,
    
    // Weapon system
    currentWeapon: 'basic',
    weaponTimer: null,
    
    // Statistics for AI comments
    shotsFired: 0,
    shotsHit: 0,
    enemiesDefeated: 0,
    
    // Timing
    lastTauntTime: 0,
    lastCommentTime: 0,

    // Game feel / juice
    shake: 0,              // Current screen-shake magnitude (decays each step)
    hitFlash: 0,           // Red flash intensity when player is hit (0-1)
    invincibleUntil: 0,    // Timestamp until which the player ignores damage

    // Input state
    keys: {
        left: false,
        right: false,
        space: false
    },
    canShoot: true
};

// ============================================
// Game Objects
// ============================================

let player = null;
let enemies = [];
let playerProjectiles = [];
let enemyProjectiles = [];
let powerUps = [];
let particles = [];
let stars = [];

// ============================================
// Canvas Setup
// ============================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// UI Elements
const scoreDisplay = document.getElementById('score');
const highScoreDisplay = document.getElementById('highScore');
const livesDisplay = document.getElementById('lives');
const levelDisplay = document.getElementById('level');
const weaponDisplay = document.getElementById('currentWeapon');
const aiStatusDisplay = document.getElementById('aiStatus');
const aiConsole = document.getElementById('aiConsole');
const aiThinking = document.getElementById('aiThinking');
const commandBanner = document.getElementById('commandBanner');

// Screens
const startScreen = document.getElementById('startScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const levelCompleteScreen = document.getElementById('levelCompleteScreen');
const leaderboardScreen = document.getElementById('leaderboardScreen');
const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');
const nextLevelBtn = document.getElementById('nextLevelBtn');
const showLeaderboardBtn = document.getElementById('showLeaderboardBtn');
const closeLeaderboardBtn = document.getElementById('closeLeaderboardBtn');
const saveScoreBtn = document.getElementById('saveScoreBtn');
const soundToggleBtn = document.getElementById('soundToggleBtn');
const playerNameInput = document.getElementById('playerName');
const nameInputSection = document.getElementById('nameInput');
const leaderboardList = document.getElementById('leaderboardList');

// ============================================
// Leaderboard System
// ============================================

const LEADERBOARD_KEY = 'spaceInvadersLeaderboard';
const MAX_LEADERBOARD_ENTRIES = 10;

function getLeaderboard() {
    try {
        const data = localStorage.getItem(LEADERBOARD_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) {
        console.warn('Could not load leaderboard:', e);
        return [];
    }
}

function saveLeaderboard(leaderboard) {
    try {
        localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(leaderboard));
    } catch (e) {
        console.warn('Could not save leaderboard:', e);
    }
}

function addScore(name, score, level) {
    const leaderboard = getLeaderboard();
    const entry = {
        name: name.toUpperCase().substring(0, 10) || 'OPERATOR',
        score: score,
        level: level,
        date: new Date().toISOString()
    };
    
    leaderboard.push(entry);
    leaderboard.sort((a, b) => b.score - a.score);
    
    // Keep only top entries
    const trimmed = leaderboard.slice(0, MAX_LEADERBOARD_ENTRIES);
    saveLeaderboard(trimmed);
    
    return trimmed.findIndex(e => e.date === entry.date);
}

function renderLeaderboard(highlightIndex = -1) {
    const leaderboard = getLeaderboard();
    
    if (leaderboard.length === 0) {
        leaderboardList.innerHTML = '<p class="no-scores">No scores yet! Be the first!</p>';
        return;
    }
    
    let html = '';
    leaderboard.forEach((entry, index) => {
        const highlight = index === highlightIndex ? ' highlight' : '';
        html += `
            <div class="leaderboard-entry${highlight}">
                <span class="leaderboard-rank">#${index + 1}</span>
                <span class="leaderboard-name">${entry.name}</span>
                <span class="leaderboard-score">${entry.score}</span>
                <span class="leaderboard-level">LV${entry.level}</span>
            </div>
        `;
    });
    
    leaderboardList.innerHTML = html;
}

function showLeaderboard(highlightIndex = -1) {
    renderLeaderboard(highlightIndex);
    leaderboardScreen.classList.remove('hidden');
}

function hideLeaderboard() {
    leaderboardScreen.classList.add('hidden');
}

// ============================================
// Player Class
// ============================================

class Player {
    constructor() {
        this.width = CONFIG.player.width;
        this.height = CONFIG.player.height;
        this.x = (CONFIG.canvas.width - this.width) / 2;
        this.y = CONFIG.canvas.height - this.height - 20;
        this.speed = CONFIG.player.speed;
        this.color = CONFIG.player.color;
        this.vx = 0;        // Horizontal velocity for smooth, momentum-based movement
    }

    update() {
        // Velocity-based movement: accelerate toward the held direction and
        // glide to a stop when released. Feels far less rigid than instant on/off.
        const accel = 1.4;
        const friction = 0.78;
        const maxSpeed = this.speed;

        if (gameState.keys.left) this.vx -= accel;
        if (gameState.keys.right) this.vx += accel;
        if (!gameState.keys.left && !gameState.keys.right) this.vx *= friction;

        this.vx = Math.max(-maxSpeed, Math.min(maxSpeed, this.vx));
        this.x += this.vx;

        // Clamp to the play field and kill velocity at the walls
        if (this.x < 0) { this.x = 0; this.vx = 0; }
        if (this.x > CONFIG.canvas.width - this.width) {
            this.x = CONFIG.canvas.width - this.width;
            this.vx = 0;
        }
    }
    
    draw() {
        ctx.fillStyle = this.color;
        
        // Draw ship body (triangle-ish shape)
        ctx.beginPath();
        ctx.moveTo(this.x + this.width / 2, this.y);
        ctx.lineTo(this.x + this.width, this.y + this.height);
        ctx.lineTo(this.x, this.y + this.height);
        ctx.closePath();
        ctx.fill();
        
        // Draw cockpit
        ctx.fillStyle = '#00aa30';
        ctx.beginPath();
        ctx.moveTo(this.x + this.width / 2, this.y + 8);
        ctx.lineTo(this.x + this.width / 2 + 8, this.y + this.height - 5);
        ctx.lineTo(this.x + this.width / 2 - 8, this.y + this.height - 5);
        ctx.closePath();
        ctx.fill();
        
        // Engine glow
        ctx.fillStyle = '#4da3ff';
        ctx.fillRect(this.x + 10, this.y + this.height, 8, 4 + Math.random() * 3);
        ctx.fillRect(this.x + this.width - 18, this.y + this.height, 8, 4 + Math.random() * 3);
    }
    
    shoot() {
        if (!gameState.canShoot) return;
        
        const centerX = this.x + this.width / 2;
        const weapon = gameState.currentWeapon;
        
        switch (weapon) {
            case 'spread':
                // Vellox Navigator — wide monitoring coverage (3-way shot)
                playerProjectiles.push(new Projectile(
                    centerX - 2, this.y, -CONFIG.projectile.playerSpeed, '#2dd4bf', 'player'
                ));
                playerProjectiles.push(new Projectile(
                    centerX - 15, this.y + 5, -CONFIG.projectile.playerSpeed, '#2dd4bf', 'player', -1.5
                ));
                playerProjectiles.push(new Projectile(
                    centerX + 10, this.y + 5, -CONFIG.projectile.playerSpeed, '#2dd4bf', 'player', 1.5
                ));
                soundManager.shootSpread();
                break;

            case 'laser':
                // Vellox Reverser — precision deep-analysis beam
                playerProjectiles.push(new Projectile(
                    centerX - 3, this.y, -CONFIG.projectile.playerSpeed * 1.5, '#22d3ee', 'player', 0, 'laser'
                ));
                soundManager.shootLaser();
                break;

            case 'missile':
                // Vellox Ranger — autonomous homing hunter
                playerProjectiles.push(new Projectile(
                    centerX - 4, this.y, -CONFIG.projectile.playerSpeed * 0.8, '#818cf8', 'player', 0, 'missile'
                ));
                soundManager.shootMissile();
                break;

            default:
                // Basic shot
                playerProjectiles.push(new Projectile(
                    centerX - CONFIG.projectile.width / 2,
                    this.y,
                    -CONFIG.projectile.playerSpeed,
                    CONFIG.projectile.playerColor,
                    'player'
                ));
                soundManager.shoot();
        }
        
        gameState.shotsFired++;
        gameState.canShoot = false;
        
        // Fire rate based on weapon
        const fireRates = {
            basic: 250,
            spread: 400,   // Navigator
            laser: 350,    // Reverser
            missile: 500   // Ranger
        };
        
        setTimeout(() => {
            gameState.canShoot = true;
        }, fireRates[weapon] || 250);
    }
}

// ============================================
// Enemy Class
// ============================================

class Enemy {
    constructor(x, y, row) {
        this.width = CONFIG.enemy.width;
        this.height = CONFIG.enemy.height;
        this.x = x;
        this.y = y;
        this.row = row;
        this.alive = true;
        this.animFrame = 0;
        this.animTimer = 0;
    }
    
    update(direction, shouldDrop) {
        if (!this.alive) return;
        
        // Horizontal movement
        this.x += CONFIG.enemy.speedX * direction * (1 + (gameState.level - 1) * CONFIG.difficulty.speedIncrease);
        
        // Drop down
        if (shouldDrop) {
            this.y += CONFIG.enemy.dropDistance;
        }
        
        // Animation
        this.animTimer++;
        if (this.animTimer > 30) {
            this.animFrame = (this.animFrame + 1) % 2;
            this.animTimer = 0;
        }
        
        // Random shooting
        const shootChance = CONFIG.enemy.shootChance + 
            (gameState.level - 1) * CONFIG.difficulty.shootChanceIncrease;
        if (Math.random() < shootChance) {
            this.shoot();
        }
    }
    
    draw() {
        if (!this.alive) return;

        // Cyber-adversary colors per row: Malware / Ransomware / APT
        const colors = ['#ff2b4e', '#ff6b9d', '#c04dff', '#ff2b4e'];
        ctx.fillStyle = colors[this.row % colors.length];
        
        // Simple pixel-art style enemy
        const px = 5; // Pixel size
        const pattern = this.animFrame === 0 ? [
            [0,0,1,0,0,0,1,0,0],
            [0,0,0,1,1,1,0,0,0],
            [0,0,1,1,1,1,1,0,0],
            [0,1,1,0,1,0,1,1,0],
            [1,1,1,1,1,1,1,1,1],
            [1,0,1,1,1,1,1,0,1],
            [1,0,1,0,0,0,1,0,1],
            [0,0,0,1,0,1,0,0,0]
        ] : [
            [0,0,1,0,0,0,1,0,0],
            [1,0,0,1,1,1,0,0,1],
            [1,0,1,1,1,1,1,0,1],
            [1,1,1,0,1,0,1,1,1],
            [1,1,1,1,1,1,1,1,1],
            [0,1,1,1,1,1,1,1,0],
            [0,0,1,0,0,0,1,0,0],
            [0,1,0,0,0,0,0,1,0]
        ];
        
        for (let row = 0; row < pattern.length; row++) {
            for (let col = 0; col < pattern[row].length; col++) {
                if (pattern[row][col]) {
                    ctx.fillRect(
                        this.x + col * px - 2,
                        this.y + row * px - 5,
                        px - 1,
                        px - 1
                    );
                }
            }
        }
    }
    
    shoot() {
        const projectile = new Projectile(
            this.x + this.width / 2 - CONFIG.projectile.width / 2,
            this.y + this.height,
            CONFIG.projectile.enemySpeed,
            CONFIG.projectile.enemyColor,
            'enemy'
        );
        enemyProjectiles.push(projectile);
        soundManager.enemyShoot();
    }
}

// ============================================
// Projectile Class
// ============================================

class Projectile {
    constructor(x, y, speed, color, owner, angleOffset = 0, type = 'normal') {
        this.x = x;
        this.y = y;
        this.speed = speed;
        this.color = color;
        this.owner = owner;
        this.angleOffset = angleOffset;
        this.type = type;
        this.active = true;
        
        // Size based on type
        if (type === 'laser') {
            this.width = 6;
            this.height = 25;
            this.damage = 2;
        } else if (type === 'missile') {
            this.width = 8;
            this.height = 16;
            this.damage = 3;
        } else {
            this.width = CONFIG.projectile.width;
            this.height = CONFIG.projectile.height;
            this.damage = 1;
        }
    }
    
    update() {
        this.y += this.speed;
        this.x += this.angleOffset;
        
        // Missile homing behavior
        if (this.type === 'missile' && this.owner === 'player') {
            const target = enemies.find(e => e.alive);
            if (target) {
                const dx = (target.x + target.width / 2) - this.x;
                if (Math.abs(dx) > 5) {
                    this.x += dx > 0 ? 2 : -2;
                }
            }
        }
        
        // Remove if off screen
        if (this.y < -this.height || this.y > CONFIG.canvas.height ||
            this.x < -20 || this.x > CONFIG.canvas.width + 20) {
            this.active = false;
        }
    }
    
    draw() {
        ctx.fillStyle = this.color;
        
        if (this.type === 'laser') {
            // Laser beam effect
            ctx.shadowColor = this.color;
            ctx.shadowBlur = 15;
            ctx.fillRect(this.x, this.y, this.width, this.height);
            ctx.fillStyle = '#fff';
            ctx.fillRect(this.x + 2, this.y, 2, this.height);
            ctx.shadowBlur = 0;
        } else if (this.type === 'missile') {
            // Missile shape
            ctx.beginPath();
            ctx.moveTo(this.x + this.width / 2, this.y);
            ctx.lineTo(this.x + this.width, this.y + this.height);
            ctx.lineTo(this.x + this.width / 2, this.y + this.height - 4);
            ctx.lineTo(this.x, this.y + this.height);
            ctx.closePath();
            ctx.fill();
            
            // Ranger homing trail
            ctx.fillStyle = '#818cf8';
            ctx.fillRect(this.x + 2, this.y + this.height, 4, 4 + Math.random() * 4);
        } else {
            // Normal projectile
            ctx.fillRect(this.x, this.y, this.width, this.height);
            ctx.shadowColor = this.color;
            ctx.shadowBlur = 10;
            ctx.fillRect(this.x, this.y, this.width, this.height);
            ctx.shadowBlur = 0;
        }
    }
}

// ============================================
// PowerUp Class
// ============================================

class PowerUp {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.width = CONFIG.powerUp.width;
        this.height = CONFIG.powerUp.height;
        this.speed = CONFIG.powerUp.speed;
        this.type = type;
        this.active = true;
        this.rotation = 0;
    }
    
    update() {
        this.y += this.speed;
        this.rotation += 0.05;
        
        if (this.y > CONFIG.canvas.height) {
            this.active = false;
        }
    }
    
    draw() {
        ctx.save();
        ctx.translate(this.x + this.width / 2, this.y + this.height / 2);
        ctx.rotate(this.rotation);
        
        // Color based on type
        const colors = {
            spread: '#2dd4bf',   // Navigator
            laser: '#22d3ee',    // Reverser
            missile: '#818cf8',  // Ranger
            shield: '#38bdf8',
            extraLife: '#34d399',
            bomb: '#ff2b4e',
            bonus: '#ffd700'
        };
        ctx.fillStyle = colors[this.type] || '#ffffff';
        
        // Different shapes per type
        if (this.type === 'bomb') {
            // Circle for bomb
            ctx.beginPath();
            ctx.arc(0, 0, this.width / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#000';
            ctx.fillRect(-2, -this.width / 2 - 3, 4, 6);
        } else if (this.type === 'extraLife' || this.type === 'shield') {
            // Heart/shield shape
            ctx.beginPath();
            ctx.moveTo(0, -this.width / 3);
            ctx.bezierCurveTo(this.width / 2, -this.width / 2, this.width / 2, this.width / 4, 0, this.width / 2);
            ctx.bezierCurveTo(-this.width / 2, this.width / 4, -this.width / 2, -this.width / 2, 0, -this.width / 3);
            ctx.fill();
        } else {
            // Star shape for weapons
            ctx.beginPath();
            for (let i = 0; i < 10; i++) {
                const angle = (i * Math.PI) / 5 - Math.PI / 2;
                const r = i % 2 === 0 ? this.width / 2 : this.width / 4;
                ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
            }
            ctx.closePath();
            ctx.fill();
        }
        
        // Glow effect
        ctx.shadowColor = colors[this.type] || '#ffffff';
        ctx.shadowBlur = 10;
        
        ctx.restore();
    }
}

// ============================================
// Particle Class (for explosions)
// ============================================

class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.vx = (Math.random() - 0.5) * 6;
        this.vy = (Math.random() - 0.5) * 6;
        this.life = 1;
        this.decay = 0.02 + Math.random() * 0.02;
        this.size = 2 + Math.random() * 4;
    }
    
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life -= this.decay;
        this.size *= 0.97;
    }
    
    draw() {
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.size, this.size);
        ctx.globalAlpha = 1;
    }
    
    get active() {
        return this.life > 0;
    }
}

// ============================================
// Background Stars
// ============================================

function createStars() {
    stars = [];
    for (let i = 0; i < 100; i++) {
        stars.push({
            x: Math.random() * CONFIG.canvas.width,
            y: Math.random() * CONFIG.canvas.height,
            size: Math.random() * 2,
            speed: 0.2 + Math.random() * 0.5,
            brightness: Math.random()
        });
    }
}

function updateStars() {
    for (const star of stars) {
        star.y += star.speed;
        if (star.y > CONFIG.canvas.height) {
            star.y = 0;
            star.x = Math.random() * CONFIG.canvas.width;
        }

        star.brightness += (Math.random() - 0.5) * 0.1;
        star.brightness = Math.max(0.3, Math.min(1, star.brightness));
    }
}

function drawStars() {
    for (const star of stars) {
        ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness})`;
        ctx.fillRect(star.x, star.y, star.size, star.size);
    }
}

// ============================================
// Enemy Management
// ============================================

let enemyDirection = 1;

function createEnemies() {
    enemies = [];
    const startX = (CONFIG.canvas.width - 
        (CONFIG.enemy.cols * (CONFIG.enemy.width + CONFIG.enemy.padding))) / 2;
    
    for (let row = 0; row < CONFIG.enemy.rows; row++) {
        for (let col = 0; col < CONFIG.enemy.cols; col++) {
            const x = startX + col * (CONFIG.enemy.width + CONFIG.enemy.padding);
            const y = CONFIG.enemy.startY + row * (CONFIG.enemy.height + CONFIG.enemy.padding);
            enemies.push(new Enemy(x, y, row));
        }
    }
}

function updateEnemies() {
    const aliveEnemies = enemies.filter(e => e.alive);
    if (aliveEnemies.length === 0) {
        levelComplete();
        return;
    }
    
    // Check if enemies hit walls
    let hitWall = false;
    for (const enemy of aliveEnemies) {
        if ((enemyDirection > 0 && enemy.x + enemy.width > CONFIG.canvas.width - 10) ||
            (enemyDirection < 0 && enemy.x < 10)) {
            hitWall = true;
            break;
        }
    }
    
    // Update all enemies
    for (const enemy of enemies) {
        enemy.update(enemyDirection, hitWall);
    }
    
    // Change direction if hit wall
    if (hitWall) {
        enemyDirection *= -1;
    }
    
    // Check if enemies reached player level (game over)
    for (const enemy of aliveEnemies) {
        if (enemy.y + enemy.height > player.y - 20) {
            gameOver();
            return;
        }
    }
}

// ============================================
// Collision Detection
// ============================================

function checkCollisions() {
    // Player projectiles vs enemies
    for (const proj of playerProjectiles) {
        if (!proj.active) continue;
        
        for (const enemy of enemies) {
            if (!enemy.alive) continue;
            
            if (rectCollision(proj, enemy)) {
                proj.active = false;
                enemy.alive = false;
                gameState.score += CONFIG.scoring.enemyKill * gameState.level;
                gameState.shotsHit++;
                gameState.enemiesDefeated++;
                createExplosion(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2,
                    ['#ff2b4e', '#ff6b9d', '#c04dff']);
                soundManager.enemyHit();
                updateHUD();
                
                // Chance to spawn power-up
                if (Math.random() < CONFIG.powerUp.spawnChance * 10) {
                    spawnPowerUp(enemy.x, enemy.y);
                }
            }
        }
    }
    
    // Enemy projectiles vs player
    for (const proj of enemyProjectiles) {
        if (!proj.active) continue;
        
        if (rectCollision(proj, player)) {
            // During invincibility frames, let shots pass through harmlessly
            if (isInvincible()) continue;
            proj.active = false;
            playerHit();
        }
    }
    
    // Player vs power-ups
    for (const powerUp of powerUps) {
        if (!powerUp.active) continue;
        
        if (rectCollision(player, powerUp)) {
            powerUp.active = false;
            collectPowerUp(powerUp);
        }
    }
}

function rectCollision(a, b) {
    return a.x < b.x + b.width &&
           a.x + a.width > b.x &&
           a.y < b.y + b.height &&
           a.y + a.height > b.y;
}

// ============================================
// Game Events
// ============================================

// ============================================
// Game Feel Helpers (screen shake, i-frames)
// ============================================

/** Trigger a screen shake, keeping the strongest active magnitude. */
function addShake(magnitude) {
    if (magnitude > gameState.shake) gameState.shake = magnitude;
}

/** True while the player is in post-hit invincibility frames. */
function isInvincible() {
    return Date.now() < gameState.invincibleUntil;
}

function playerHit() {
    // Ignore damage during invincibility frames
    if (isInvincible()) return;

    gameState.lives--;
    updateHUD();
    createExplosion(player.x + player.width / 2, player.y + player.height / 2,
        ['#22d3ee', '#0891b2', '#0e7490']);
    soundManager.playerHit();

    // Juice + brief invincibility so a single hit doesn't cascade into instant death
    addShake(12);
    gameState.hitFlash = 1;
    gameState.invincibleUntil = Date.now() + 1500;

    if (gameState.lives <= 0) {
        gameOver();
    } else {
        addConsoleMessage("Perimeter breached! Rerouting — hold the line, operator.", "commander");
    }
}

function spawnPowerUp(x, y) {
    // Weighted random selection - weapons more common, bomb/extraLife rare
    const weights = {
        spread: 22,     // Navigator
        laser: 20,      // Reverser
        missile: 18,    // Ranger
        shield: 10,
        extraLife: 5,
        bomb: 5,
        bonus: 10
    };
    
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;
    let selectedType = 'bonus';
    
    for (const [type, weight] of Object.entries(weights)) {
        random -= weight;
        if (random <= 0) {
            selectedType = type;
            break;
        }
    }
    
    powerUps.push(new PowerUp(x, y, selectedType));
    
    // Async LLM call for power-up hint (don't wait)
    llmManager.generatePowerUpHint(selectedType).then(hint => {
        if (hint) addConsoleMessage(hint, "hint");
    });
}

function collectPowerUp(powerUp) {
    gameState.score += CONFIG.scoring.powerUpBonus;
    
    // Check for new high score
    if (gameState.score > gameState.highScore) {
        gameState.highScore = gameState.score;
    }
    
    // Apply power-up effect
    switch (powerUp.type) {
        case 'spread':
            setWeapon('spread', 'VELLOX NAVIGATOR deployed — monitoring every vector.');
            soundManager.weaponPowerUp();
            break;
        case 'laser':
            setWeapon('laser', 'VELLOX REVERSER deployed — dissecting threats on contact.');
            soundManager.weaponPowerUp();
            break;
        case 'missile':
            setWeapon('missile', 'VELLOX RANGER deployed — autonomously hunting the adversary.');
            soundManager.weaponPowerUp();
            break;
        case 'shield':
            gameState.lives = Math.min(gameState.lives + 1, 9);
            addConsoleMessage("Firewall patched! +1 system integrity.", "commander");
            soundManager.extraLife();
            break;
        case 'extraLife':
            gameState.lives = Math.min(gameState.lives + 2, 9);
            addConsoleMessage("Redundant nodes online! +2 system integrity.", "commander");
            soundManager.extraLife();
            break;
        case 'bomb':
            // Kill-chain break — purge every active threat on screen
            let destroyed = 0;
            enemies.forEach(e => {
                if (e.alive) {
                    e.alive = false;
                    destroyed++;
                    createExplosion(e.x + e.width / 2, e.y + e.height / 2, ['#ff2b4e', '#ff6b9d', '#c04dff']);
                }
            });
            gameState.score += destroyed * CONFIG.scoring.enemyKill;
            addConsoleMessage(`KILL-CHAIN BREAK! ${destroyed} threats purged!`, "commander");
            soundManager.bomb();
            addShake(16);
            break;
        case 'bonus':
            const bonusPoints = 250 + Math.floor(Math.random() * 500);
            gameState.score += bonusPoints;
            addConsoleMessage(`Threat-intel cache recovered! +${bonusPoints} points!`, "commander");
            soundManager.powerUp();
            break;
    }
    
    updateHUD();
}

function setWeapon(weapon, message) {
    // Clear existing weapon timer
    if (gameState.weaponTimer) {
        clearTimeout(gameState.weaponTimer);
    }
    
    gameState.currentWeapon = weapon;
    updateWeaponDisplay();
    addConsoleMessage(message, "hint");
    
    // Weapon expires after duration
    gameState.weaponTimer = setTimeout(() => {
        gameState.currentWeapon = 'basic';
        updateWeaponDisplay();
        addConsoleMessage("Deployment window closed. Baseline defenses restored.", "system");
    }, CONFIG.powerUp.duration);
}

function updateWeaponDisplay() {
    const names = {
        basic: 'BASELINE',
        spread: 'NAVIGATOR',
        laser: 'REVERSER',
        missile: 'RANGER'
    };
    weaponDisplay.textContent = names[gameState.currentWeapon] || 'BASELINE';
    weaponDisplay.className = `stat-value weapon-display ${gameState.currentWeapon}`;
}

function createExplosion(x, y, colors) {
    for (let i = 0; i < 20; i++) {
        const color = colors[Math.floor(Math.random() * colors.length)];
        particles.push(new Particle(x, y, color));
    }
    // Small kick of screen shake for every explosion adds impact
    addShake(3);
}

// ============================================
// Level Management
// ============================================

function levelComplete() {
    gameState.levelComplete = true;
    gameState.running = false;
    
    soundManager.levelComplete();
    
    const levelScore = document.getElementById('levelScore');
    levelScore.textContent = `SCORE: ${gameState.score}`;
    
    // Get LLM briefing for next level
    const briefingElement = document.getElementById('levelBriefing');
    briefingElement.textContent = "Analyzing next sector...";
    
    llmManager.generateBriefing(gameState.level + 1, gameState.score).then(briefing => {
        briefingElement.textContent = briefing;
    });
    
    levelCompleteScreen.classList.remove('hidden');
}

function startNextLevel() {
    gameState.level++;
    gameState.levelComplete = false;
    levelCompleteScreen.classList.add('hidden');
    
    // Reset for new level
    playerProjectiles = [];
    enemyProjectiles = [];
    powerUps = [];
    particles = [];
    enemyDirection = 1;
    
    // Create new enemy wave
    createEnemies();
    
    // Update HUD
    updateHUD();

    // Announce the Vellox product phase driving this wave
    const phase = getPhase(gameState.level);
    addConsoleMessage(`PHASE ${gameState.level} — ${phase.product} ONLINE.`, "commander");
    addConsoleMessage(phase.desc, "hint");

    // Generate level description
    llmManager.generateLevelDescription(gameState.level).then(desc => {
        addConsoleMessage(desc, "briefing");
    });

    // Resume game
    resetLoopClock();
    gameState.running = true;
    requestAnimationFrame(gameLoop);
}

// ============================================
// Game Over
// ============================================

function gameOver() {
    gameState.gameOver = true;
    gameState.running = false;
    
    soundManager.gameOver();
    
    const finalScore = document.getElementById('finalScore');
    finalScore.textContent = `SCORE: ${gameState.score}`;
    
    // Get LLM game over comment
    const aiComment = document.getElementById('aiComment');
    aiComment.textContent = "Analyzing battle data...";
    
    const stats = {
        accuracy: gameState.shotsFired > 0 ? 
            Math.round((gameState.shotsHit / gameState.shotsFired) * 100) : 0
    };
    
    llmManager.generateGameOverComment(gameState.score, gameState.level, stats).then(comment => {
        aiComment.textContent = comment;
    });
    
    // Show name input for saving score
    nameInputSection.classList.remove('hidden');
    playerNameInput.value = '';
    
    gameOverScreen.classList.remove('hidden');
}

// ============================================
// HUD and Console
// ============================================

function updateHUD() {
    scoreDisplay.textContent = gameState.score;
    highScoreDisplay.textContent = gameState.highScore;
    livesDisplay.textContent = gameState.lives;
    levelDisplay.textContent = gameState.level;
    
    // Update high score if beaten
    if (gameState.score > gameState.highScore) {
        gameState.highScore = gameState.score;
        highScoreDisplay.textContent = gameState.highScore;
    }
}

function updateAIStatus(status) {
    // Map internal states to display states
    let displayStatus = status;
    if (status === 'downloading' || status === 'loading' || status === 'initializing') {
        displayStatus = 'loading';
    }
    aiStatusDisplay.textContent = displayStatus.toUpperCase();
    aiStatusDisplay.className = `stat-value ai-status ${displayStatus}`;
}

function updateDownloadProgress(progress) {
    // Show download progress in the AI console
    if (progress.state === 'downloading') {
        // Update or create progress message
        let progressMsg = document.getElementById('download-progress-msg');
        if (!progressMsg) {
            progressMsg = document.createElement('p');
            progressMsg.id = 'download-progress-msg';
            progressMsg.className = 'console-message system-message';
            aiConsole.appendChild(progressMsg);
        }
        
        // Create progress bar visualization
        const barWidth = 20;
        const filled = Math.round((progress.progress / 100) * barWidth);
        const empty = barWidth - filled;
        const bar = '█'.repeat(filled) + '░'.repeat(empty);
        
        progressMsg.innerHTML = `&gt; Downloading AI Model...<br>&gt; [${bar}] ${progress.progress.toFixed(1)}%<br>&gt; ${progress.modelAlias || 'model'}`;
        aiConsole.scrollTop = aiConsole.scrollHeight;
    } else if (progress.state === 'loading') {
        let progressMsg = document.getElementById('download-progress-msg');
        if (!progressMsg) {
            progressMsg = document.createElement('p');
            progressMsg.id = 'download-progress-msg';
            progressMsg.className = 'console-message system-message';
            aiConsole.appendChild(progressMsg);
        }
        progressMsg.innerHTML = `&gt; Loading AI model into memory...<br>&gt; Please wait...`;
        aiConsole.scrollTop = aiConsole.scrollHeight;
    } else if (progress.state === 'ready') {
        // Remove progress message and show ready
        const progressMsg = document.getElementById('download-progress-msg');
        if (progressMsg) {
            progressMsg.remove();
        }
    } else if (progress.state === 'error') {
        const progressMsg = document.getElementById('download-progress-msg');
        if (progressMsg) {
            progressMsg.innerHTML = `&gt; <span style="color:#ff6b6b">AI initialization failed</span><br>&gt; Running in offline mode`;
        }
    }
}

function addConsoleMessage(message, type = 'system') {
    const p = document.createElement('p');
    p.className = `console-message ${type}-message`;
    p.innerHTML = `&gt; ${message}`;
    aiConsole.appendChild(p);
    aiConsole.scrollTop = aiConsole.scrollHeight;

    // Limit console messages to keep the panel readable
    while (aiConsole.children.length > 14) {
        aiConsole.removeChild(aiConsole.firstChild);
    }

    // Surface story beats as a banner over the play field
    if (['commander', 'taunt', 'briefing', 'hint'].includes(type)) {
        showBanner(message, type);
    }
}

let bannerTimer = null;

/** Flash the latest important transmission as a banner over the game field. */
function showBanner(message, type) {
    if (!commandBanner) return;
    commandBanner.textContent = message;
    commandBanner.className = `command-banner ${type} show`;

    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
        commandBanner.classList.remove('show');
    }, 4800);
}

function setThinking(active) {
    if (active) {
        aiThinking.classList.add('active');
    } else {
        aiThinking.classList.remove('active');
    }
}

// ============================================
// LLM Integration - Periodic Updates
// ============================================

async function triggerEnemyTaunt() {
    if (!gameState.running || gameState.paused) return;
    
    const now = Date.now();
    if (now - gameState.lastTauntTime < CONFIG.llm.tauntInterval) return;
    
    gameState.lastTauntTime = now;
    setThinking(true);
    
    const taunt = await llmManager.generateTaunt({
        level: gameState.level,
        score: gameState.score
    });
    
    setThinking(false);
    
    if (taunt) {
        addConsoleMessage(taunt, "taunt");
    }
}

async function triggerPerformanceComment() {
    if (!gameState.running || gameState.paused) return;
    
    const now = Date.now();
    if (now - gameState.lastCommentTime < CONFIG.llm.commentInterval) return;
    
    gameState.lastCommentTime = now;
    
    const stats = {
        accuracy: gameState.shotsFired > 0 ? 
            Math.round((gameState.shotsHit / gameState.shotsFired) * 100) : 50,
        efficiency: gameState.enemiesDefeated > 0 ?
            Math.min(100, Math.round((gameState.enemiesDefeated / (gameState.level * 10)) * 100)) : 50
    };
    
    const comment = await llmManager.generatePerformanceComment(stats);
    
    if (comment) {
        addConsoleMessage(comment, "commander");
    }
}

// ============================================
// Input Handling
// ============================================

function handleKeyDown(e) {
    // Don't hijack keys while typing in a text field (e.g. the callsign input),
    // otherwise letters like "R" would trigger game controls (restart) mid-type.
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

    switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
            gameState.keys.left = true;
            break;
        case 'ArrowRight':
        case 'KeyD':
            gameState.keys.right = true;
            break;
        case 'Space':
            e.preventDefault();
            // Track held state; the game loop fires at the weapon's fire rate
            // so holding Space auto-fires instead of requiring rapid tapping.
            gameState.keys.space = true;
            break;
        case 'KeyP':
            togglePause();
            break;
        case 'KeyR':
            if (gameState.gameOver) {
                restartGame();
            }
            break;
    }
}

function handleKeyUp(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

    switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
            gameState.keys.left = false;
            break;
        case 'ArrowRight':
        case 'KeyD':
            gameState.keys.right = false;
            break;
        case 'Space':
            gameState.keys.space = false;
            break;
    }
}

function togglePause() {
    if (!gameState.running) return;
    
    gameState.paused = !gameState.paused;
    
    if (gameState.paused) {
        addConsoleMessage("Game paused. Press P to resume.", "system");
    } else {
        addConsoleMessage("Resuming combat operations.", "system");
        resetLoopClock();
        requestAnimationFrame(gameLoop);
    }
}

// ============================================
// Game Loop
// ============================================

// Fixed-timestep loop: the simulation always advances in 1/60s steps
// regardless of the monitor's refresh rate, so the game plays identically
// on 60Hz, 120Hz or 144Hz displays instead of running faster on high-refresh
// screens. Rendering still happens once per animation frame.
const FIXED_DT = 1000 / 60;
let lastTime = 0;
let accumulator = 0;

/** Advance the simulation by exactly one fixed timestep. */
function update() {
    player.update();

    // Hold-to-fire: shoot() self-limits via the per-weapon fire rate
    if (gameState.keys.space) player.shoot();

    updateEnemies();

    for (const proj of playerProjectiles) proj.update();
    for (const proj of enemyProjectiles) proj.update();
    for (const powerUp of powerUps) powerUp.update();
    for (const particle of particles) particle.update();
    updateStars();

    checkCollisions();

    // Clean up inactive objects
    playerProjectiles = playerProjectiles.filter(p => p.active);
    enemyProjectiles = enemyProjectiles.filter(p => p.active);
    powerUps = powerUps.filter(p => p.active);
    particles = particles.filter(p => p.active);

    // Decay screen shake and hit flash
    if (gameState.shake > 0) {
        gameState.shake *= 0.88;
        if (gameState.shake < 0.4) gameState.shake = 0;
    }
    if (gameState.hitFlash > 0) {
        gameState.hitFlash = Math.max(0, gameState.hitFlash - 0.05);
    }
}

/** Draw the current world state, once per animation frame. */
function render() {
    // Clear canvas (full area, before any shake offset, to avoid smearing)
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height);

    ctx.save();
    if (gameState.shake > 0) {
        ctx.translate(
            (Math.random() - 0.5) * gameState.shake,
            (Math.random() - 0.5) * gameState.shake
        );
    }

    drawStars();

    // Blink the player while invincible so hits read clearly
    if (!isInvincible() || Math.floor(Date.now() / 80) % 2 === 0) {
        player.draw();
    }

    for (const enemy of enemies) enemy.draw();
    for (const proj of playerProjectiles) proj.draw();
    for (const proj of enemyProjectiles) proj.draw();
    for (const powerUp of powerUps) powerUp.draw();
    for (const particle of particles) particle.draw();

    ctx.restore();

    // Red damage flash overlays the whole screen
    if (gameState.hitFlash > 0) {
        ctx.fillStyle = `rgba(255, 40, 40, ${gameState.hitFlash * 0.4})`;
        ctx.fillRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height);
    }
}

function gameLoop(timestamp) {
    if (!gameState.running || gameState.paused) return;

    if (!lastTime) lastTime = timestamp;
    let frameTime = timestamp - lastTime;
    lastTime = timestamp;

    // Avoid a "spiral of death" after the tab was backgrounded
    if (frameTime > 250) frameTime = 250;
    accumulator += frameTime;

    // Run as many fixed steps as have accumulated (capped so we never stall)
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < 5) {
        update();
        accumulator -= FIXED_DT;
        steps++;
        // update() may end the game (game over / level complete)
        if (!gameState.running || gameState.paused) break;
    }
    if (steps >= 5) accumulator = 0;

    render();

    // Trigger LLM updates (non-blocking, throttled internally)
    triggerEnemyTaunt();
    triggerPerformanceComment();

    if (gameState.running && !gameState.paused) {
        requestAnimationFrame(gameLoop);
    }
}

/** Reset the frame timer so resuming/starting doesn't jump the simulation. */
function resetLoopClock() {
    lastTime = 0;
    accumulator = 0;
}

// ============================================
// Game Initialization
// ============================================

// ============================================
// Responsive Fit — size everything to the viewport, no scrolling
// ============================================

const DISPLAY_ASPECT = CONFIG.canvas.width / CONFIG.canvas.height; // 6:5

/**
 * Fit the game + command console inside the .stage area (whose size the
 * browser computes via flexbox after the top bar and footer take their space).
 * We measure the stage directly — no magic numbers — then choose side-by-side
 * vs. stacked by whichever makes the game bigger, and size both to fit exactly.
 * Guarantees: no scrolling, the console is never clipped, 6:5 ratio preserved.
 */
function fitLayout() {
    const stage = document.querySelector('.stage');
    const console_ = document.querySelector('.ai-console');
    if (!canvas || !stage || !console_) return;

    const availW = stage.clientWidth;
    const availH = stage.clientHeight;
    if (availW <= 0 || availH <= 0) return;

    const BORDER = 2;            // .game-container / .ai-console border (1px * 2)
    const GAP = 14;             // .stage gap between game and console
    const CONSOLE_W = 320;      // side-panel width (row layout)
    const COL_CONSOLE_MIN = 120; // min console height when stacked

    // Row: console beside the canvas
    const rowCanvasW = availW - CONSOLE_W - GAP - BORDER;
    const rowH = Math.min(availH - BORDER, rowCanvasW / DISPLAY_ASPECT);

    // Column: reserve a minimum console height first, canvas gets the rest
    const colH = Math.min(
        availH - COL_CONSOLE_MIN - GAP - BORDER,
        (availW - BORDER) / DISPLAY_ASPECT
    );

    let layout, h;
    if (rowH >= colH) { layout = 'row'; h = rowH; }
    else { layout = 'column'; h = colH; }

    if (!(h > 0)) {   // degenerate tiny area — keep everything visible
        layout = 'column';
        h = Math.max(60, (availW - BORDER) / DISPLAY_ASPECT);
    }
    h = Math.floor(h);
    const w = Math.floor(h * DISPLAY_ASPECT);

    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    if (layout === 'row') {
        stage.style.flexDirection = 'row';
        console_.style.width = CONSOLE_W + 'px';
        console_.style.height = (h + BORDER) + 'px';   // match game height exactly
    } else {
        stage.style.flexDirection = 'column';
        console_.style.width = (w + BORDER) + 'px';
        const consoleH = Math.max(COL_CONSOLE_MIN, availH - (h + BORDER) - GAP);
        console_.style.height = consoleH + 'px';
    }
}

async function initGame() {
    // Fit the layout now and on ANY size change — window resize OR the stage
    // element itself being resized (covers embedded preview panels / iframes).
    fitLayout();
    window.addEventListener('resize', fitLayout);
    if (window.ResizeObserver) {
        const stage = document.querySelector('.stage');
        const ro = new ResizeObserver(() => fitLayout());
        if (stage) ro.observe(stage);
        ro.observe(document.documentElement);
    }
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(fitLayout);
    }
    requestAnimationFrame(fitLayout);

    // Load high score from leaderboard
    loadHighScore();
    updateHUD();
    
    // Initialize LLM (optional - game works without it)
    llmManager.onStatusChange(updateAIStatus);
    llmManager.onDownloadProgress(updateDownloadProgress);
    const llmAvailable = await llmManager.initialize();
    
    if (llmAvailable) {
        addConsoleMessage("VELLOX Command online. AI-native defense standing by.", "commander");
    } else {
        addConsoleMessage("VELLOX Command standing by. Deploy when ready, operator.", "system");
    }
    
    // Create background
    createStars();
    
    // Set up event listeners
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    // Button handlers
    startBtn.addEventListener('click', startGame);
    restartBtn.addEventListener('click', restartGame);
    nextLevelBtn.addEventListener('click', startNextLevel);
    
    // Leaderboard handlers
    showLeaderboardBtn.addEventListener('click', () => showLeaderboard());
    closeLeaderboardBtn.addEventListener('click', hideLeaderboard);
    
    // Save score handler
    saveScoreBtn.addEventListener('click', () => {
        const name = playerNameInput.value.trim() || 'OPERATOR';
        const rank = addScore(name, gameState.score, gameState.level);
        nameInputSection.classList.add('hidden');
        addConsoleMessage(`Score saved! Rank #${rank + 1}`, 'commander');
        soundManager.menuClick();
        
        // Show leaderboard briefly
        setTimeout(() => showLeaderboard(rank), 500);
    });
    
    // Allow Enter key to save score
    playerNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveScoreBtn.click();
        }
    });
    
    // Sound toggle handler
    soundToggleBtn.addEventListener('click', () => {
        soundManager.init(); // Ensure initialized
        const enabled = soundManager.toggle();
        soundToggleBtn.textContent = enabled ? '🔊 SOUND' : '🔇 MUTED';
        soundToggleBtn.classList.toggle('muted', !enabled);
        if (enabled) soundManager.menuClick();
    });
}

function startGame() {
    // Initialize sound (requires user interaction)
    soundManager.init();
    soundManager.startGame();
    
    // Hide start screen
    startScreen.classList.add('hidden');
    
    // Reset game state
    resetGameState();
    
    // Create player and enemies
    player = new Player();
    createEnemies();
    
    // Update HUD
    updateHUD();

    // Set the scene: the Vellox story + phase 1 product
    addConsoleMessage("Adversary AI detected. Breakout time: under 30 minutes.", "taunt");
    addConsoleMessage("This is VELLOX Command. We fight AI with AI — we close the speed gap.", "commander");
    const phase = getPhase(1);
    addConsoleMessage(`PHASE 1 — ${phase.product} ONLINE.`, "commander");
    addConsoleMessage(phase.desc, "hint");

    // Get initial briefing
    llmManager.generateBriefing(1, 0).then(briefing => {
        addConsoleMessage(briefing, "briefing");
    });

    // Start game
    resetLoopClock();
    gameState.running = true;
    requestAnimationFrame(gameLoop);
}

function restartGame() {
    // Hide overlays
    gameOverScreen.classList.add('hidden');
    
    // Reset state
    resetGameState();
    
    // Clear console
    aiConsole.innerHTML = '';
    addConsoleMessage("Reinitializing VELLOX defense grid...", "system");
    
    // Create new game objects
    player = new Player();
    createEnemies();
    playerProjectiles = [];
    enemyProjectiles = [];
    powerUps = [];
    particles = [];
    enemyDirection = 1;
    
    // Update HUD
    updateHUD();
    
    // Get briefing
    llmManager.generateBriefing(1, 0).then(briefing => {
        addConsoleMessage(briefing, "briefing");
    });
    
    // Start game
    resetLoopClock();
    gameState.running = true;
    requestAnimationFrame(gameLoop);
}

function resetGameState() {
    gameState.running = false;
    gameState.paused = false;
    gameState.gameOver = false;
    gameState.levelComplete = false;
    gameState.score = 0;
    gameState.lives = CONFIG.player.lives;
    gameState.level = 1;
    gameState.shotsFired = 0;
    gameState.shotsHit = 0;
    gameState.enemiesDefeated = 0;
    gameState.lastTauntTime = 0;
    gameState.lastCommentTime = 0;
    gameState.shake = 0;
    gameState.hitFlash = 0;
    gameState.invincibleUntil = 0;
    gameState.keys = { left: false, right: false, space: false };
    gameState.canShoot = true;
    
    // Reset weapon
    if (gameState.weaponTimer) {
        clearTimeout(gameState.weaponTimer);
    }
    gameState.currentWeapon = 'basic';
    updateWeaponDisplay();
}

function loadHighScore() {
    const leaderboard = getLeaderboard();
    if (leaderboard.length > 0) {
        gameState.highScore = leaderboard[0].score;
    }
}

// ============================================
// Start the game
// ============================================

initGame();
