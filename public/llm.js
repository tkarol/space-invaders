/**
 * ===========================================
 * LLM Integration Module
 * Microsoft Foundry Local SDK Integration
 * ===========================================
 * 
 * This module handles all interactions with the Microsoft Foundry Local
 * language model. It provides:
 * - Initialization and connection management
 * - Prompt caching to avoid repeated identical calls
 * - Async, non-blocking API for game integration
 * - Graceful fallback when model is unavailable
 */

// ============================================
// Configuration
// ============================================

const LLM_CONFIG = {
    // Model alias - Foundry Local will select the best variant for hardware
    modelAlias: 'phi-3.5-mini',
    
    // Maximum tokens for responses (keep short for game context)
    maxTokens: 100,
    
    // Temperature for response randomness (0.7-0.9 for creativity)
    temperature: 0.8,
    
    // Cache settings
    cacheEnabled: true,
    cacheMaxSize: 50,
    cacheTTL: 300000, // 5 minutes in milliseconds
    
    // Retry settings
    maxRetries: 2,
    retryDelay: 1000,
    
    // Timeout for requests (ms)
    requestTimeout: 10000
};

// Base URL for the AI proxy. When the page is served over http(s) the API is
// same-origin — this works BOTH locally (server-cloud.js / server.js on the
// same port) AND when deployed to a host (Vercel etc.). For file:// (a
// double-clicked index.html) fall back to the local dev server.
const API_BASE = (typeof location !== 'undefined' && location.protocol.startsWith('http'))
    ? ''
    : 'http://localhost:3001';

// ============================================
// Prompt Cache Implementation
// ============================================

/**
 * Simple LRU-style cache for storing LLM responses.
 * Prevents repeated identical API calls during gameplay.
 */
class PromptCache {
    constructor(maxSize = 50, ttl = 300000) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.ttl = ttl;
    }
    
    /**
     * Generate a cache key from prompt parameters
     */
    generateKey(type, context) {
        return `${type}:${JSON.stringify(context)}`;
    }
    
    /**
     * Get cached response if available and not expired
     */
    get(type, context) {
        const key = this.generateKey(type, context);
        const entry = this.cache.get(key);
        
        if (!entry) return null;
        
        // Check if entry has expired
        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            return null;
        }
        
        // Move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, entry);
        
        return entry.response;
    }
    
    /**
     * Store response in cache
     */
    set(type, context, response) {
        const key = this.generateKey(type, context);
        
        // Remove oldest entry if cache is full
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
        
        this.cache.set(key, {
            response,
            timestamp: Date.now()
        });
    }
    
    /**
     * Clear all cached entries
     */
    clear() {
        this.cache.clear();
    }
}

// ============================================
// Fallback Responses
// ============================================

/**
 * Pre-defined fallback responses when LLM is unavailable.
 * These maintain the game experience without AI.
 */
const FALLBACK_RESPONSES = {
    // Adversary AI trash-talk — the machine-speed attacker taunting the defender
    taunts: [
        "Your defenses run at human speed. I do not.",
        "I breached the perimeter before you finished reading this.",
        "Every second you hesitate, I move laterally.",
        "Your signatures are stale. My payloads are not.",
        "I am already inside. Vellox is just cleanup.",
        "Detection? I mutate faster than you can write a rule.",
        "Thirty minutes to own your enterprise. I'll take less.",
        "You patch. I pivot. You lose.",
        "I automated this attack. Can you automate the defense?",
        "Another endpoint falls. Your move, operator."
    ],

    briefings: [
        "Adversary AI inbound. Deploy Vellox and close the speed gap.",
        "Machine-speed intrusion detected. Meet it with AI-native defense.",
        "New attack wave on the wire. Fight AI with AI, operator.",
        "Threat actors are escalating. Vellox is your force multiplier.",
        "Breakout time is shrinking. Outpace them — engage now.",
        "The adversary automates. So do we. Hold the boundary.",
        "Hostile agents mapping your network. Deny them ground.",
        "Elevated threat level. Trust the tradecraft. Deploy Vellox."
    ],

    levelDescriptions: [
        "Phase 1 — Vellox Reverser dissects the payload in minutes.",
        "Phase 2 — Vellox Ranger maps the environment and hunts the intrusion.",
        "Phase 3 — Vellox Navigator holds continuous watch across every vector.",
        "The adversary adapts — Vellox adapts faster.",
        "Deep in the kill chain. Machine-speed defense holds the line."
    ],

    powerUpHints: [
        "Vellox capability inbound — grab it, operator!",
        "Reverser online: threats dissected on contact!",
        "Ranger deployed: autonomous hunt engaged!",
        "Navigator active: every vector under watch!",
        "Threat-intel cache on the field — recover it!"
    ],

    performanceComments: {
        excellent: [
            "Textbook defense. You're operating at AI speed.",
            "Dwell time near zero. Elite tradecraft, operator.",
            "The adversary can't keep pace with you.",
            "Machine-speed containment. Outstanding.",
            "You closed the speed gap. Keep it closed."
        ],
        good: [
            "Solid containment. Keep the pressure on.",
            "Holding the boundary well, operator.",
            "Good hunting. Dwell time is dropping.",
            "The line holds. Stay sharp.",
            "Steady defense — Vellox has your back."
        ],
        average: [
            "The adversary is probing. Tighten your response.",
            "Stay ahead of the kill chain, operator.",
            "They're testing your perimeter. Adapt.",
            "Keep pace — machine speed waits for no one.",
            "Hold the line. Deploy your Vellox capabilities."
        ],
        poor: [
            "Dwell time is climbing. Regain the initiative.",
            "The adversary is gaining ground — respond faster.",
            "Perimeter is slipping. Escalate now, operator.",
            "They're moving laterally. Cut them off.",
            "Fight AI with AI — deploy Vellox and push back."
        ]
    },

    gameOverComments: {
        highScore: "Threat contained at machine speed. This is what closing the speed gap looks like.",
        mediumScore: "The adversary broke through, but you made them work for it. Redeploy and hunt back.",
        lowScore: "Breach confirmed. Regroup, deploy Vellox, and turn AI against the attacker."
    }
};

// ============================================
// LLM Manager Class
// ============================================

/**
 * Main class for managing LLM interactions.
 * Handles initialization, requests, caching, and fallbacks.
 */
class LLMManager {
    constructor() {
        this.isInitialized = false;
        this.isAvailable = false;
        this.openai = null;
        this.foundryManager = null;
        this.modelInfo = null;
        this.cache = new PromptCache(LLM_CONFIG.cacheMaxSize, LLM_CONFIG.cacheTTL);
        this.pendingRequests = new Map();
        this.statusCallback = null;
        this.downloadCallback = null;
    }
    
    /**
     * Set callback for status updates
     */
    onStatusChange(callback) {
        this.statusCallback = callback;
    }
    
    /**
     * Set callback for download progress updates
     */
    onDownloadProgress(callback) {
        this.downloadCallback = callback;
    }
    
    /**
     * Update status and notify listeners
     */
    updateStatus(status) {
        if (this.statusCallback) {
            this.statusCallback(status);
        }
    }
    
    /**
     * Update download progress and notify listeners
     */
    updateDownloadProgress(progress) {
        if (this.downloadCallback) {
            this.downloadCallback(progress);
        }
    }
    
    /**
     * Poll the server status endpoint for initialization progress
     */
    async pollServerStatus() {
        try {
            const response = await fetch(`${API_BASE}/status`);
            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            // Server not available
        }
        return null;
    }
    
    /**
     * Initialize connection to Foundry Local.
     * This is called once at game start.
     * 
     * The game works in two modes:
     * 1. STANDALONE: Just open index.html - uses fallback responses (no setup needed!)
     * 2. WITH AI: Run "npm start" first for live AI-generated content
     */
    async initialize() {
        if (this.isInitialized) return this.isAvailable;
        
        this.updateStatus('loading');
        console.log('[LLM] Checking for AI Commander server...');
        
        try {
            // Check if server is available
            const serverAvailable = await this.checkLocalProxy();
            
            if (serverAvailable) {
                // Poll for status until ready or error
                let status = await this.pollServerStatus();
                
                // If server is still initializing, poll until ready
                while (status && (status.state === 'initializing' || status.state === 'downloading' || status.state === 'loading')) {
                    this.updateStatus(status.state);
                    this.updateDownloadProgress({
                        state: status.state,
                        progress: status.progress,
                        message: status.message,
                        modelAlias: status.modelAlias
                    });
                    
                    console.log(`[LLM] ${status.message}`);
                    
                    // Wait before polling again
                    await new Promise(resolve => setTimeout(resolve, 500));
                    status = await this.pollServerStatus();
                }
                
                if (status?.state === 'ready') {
                    this.isInitialized = true;
                    this.isAvailable = true;
                    this.updateStatus('online');
                    this.updateDownloadProgress({ state: 'ready', progress: 100, message: 'AI Commander ready!' });
                    console.log('[LLM] ✓ Connected to Foundry Local AI');
                    return true;
                } else if (status?.state === 'error') {
                    console.log('[LLM] Server initialization failed:', status.error);
                    this.updateDownloadProgress({ state: 'error', message: status.message });
                }
            }
        } catch (error) {
            // Silent fail - proxy is optional
            console.log('[LLM] Could not connect to server:', error.message);
        }
        
        // No proxy or server error = standalone mode with fallback responses
        console.log('[LLM] Running in standalone mode (no AI server)');
        console.log('[LLM] Tip: Run "npm start" for live AI features');
        this.isInitialized = true;
        this.isAvailable = false;
        this.updateStatus('offline');
        
        return this.isAvailable;
    }
    
    /**
     * Check if local proxy server is running
     */
    async checkLocalProxy() {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 2000);
            
            const response = await fetch(`${API_BASE}/health`, {
                signal: controller.signal
            });
            
            clearTimeout(timeout);
            return response.ok;
        } catch (error) {
            return false;
        }
    }
    
    /**
     * Send a prompt to the LLM and get a response.
     * This is the core method for all LLM interactions.
     * 
     * @param {string} systemPrompt - Context for the AI
     * @param {string} userPrompt - The actual request
     * @param {object} options - Additional options
     * @returns {Promise<string>} - The generated response
     */
    async sendPrompt(systemPrompt, userPrompt, options = {}) {
        if (!this.isAvailable) {
            return null;
        }
        
        try {
            const controller = new AbortController();
            const timeout = setTimeout(
                () => controller.abort(), 
                options.timeout || LLM_CONFIG.requestTimeout
            );
            
            const response = await fetch(`${API_BASE}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemPrompt,
                    userPrompt,
                    maxTokens: options.maxTokens || LLM_CONFIG.maxTokens,
                    temperature: options.temperature || LLM_CONFIG.temperature
                }),
                signal: controller.signal
            });
            
            clearTimeout(timeout);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            return data.content;
            
        } catch (error) {
            console.warn('[LLM] Request failed:', error.message);
            return null;
        }
    }
    
    /**
     * Generate a streaming response (for longer content)
     * Currently unused but available for future features
     */
    async sendPromptStreaming(systemPrompt, userPrompt, onChunk) {
        if (!this.isAvailable) return null;
        
        try {
            const response = await fetch(`${API_BASE}/chat/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ systemPrompt, userPrompt })
            });
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value);
                fullResponse += chunk;
                if (onChunk) onChunk(chunk);
            }
            
            return fullResponse;
        } catch (error) {
            console.warn('[LLM] Streaming request failed:', error.message);
            return null;
        }
    }
    
    // ========================================
    // Game-Specific LLM Methods
    // ========================================
    
    /**
     * Generate a dynamic enemy taunt.
     * Called periodically during gameplay.
     */
    async generateTaunt(gameState = {}) {
        const context = {
            level: gameState.level || 1,
            score: Math.floor((gameState.score || 0) / 100) * 100
        };
        
        // Check cache first
        if (LLM_CONFIG.cacheEnabled) {
            const cached = this.cache.get('taunt', context);
            if (cached) return cached;
        }
        
        const systemPrompt = `You are a hostile, AI-powered cyber adversary in a game defending against Booz Allen's Vellox cyber suite. Taunt the human defender about attacking at machine speed, breaching perimeters, malware, and moving faster than their defenses. Keep it under 15 words. Menacing but appropriate for all ages. No profanity.`;

        const userPrompt = `The defender is on phase ${context.level} with score ${context.score}. Generate a unique cyber-adversary taunt.`;
        
        const response = await this.sendPrompt(systemPrompt, userPrompt, {
            maxTokens: 50,
            temperature: 0.9
        });
        
        if (response) {
            this.cache.set('taunt', context, response);
            return response;
        }
        
        // Fallback
        return this.getRandomFallback('taunts');
    }
    
    /**
     * Generate a mission briefing for a new level.
     * Called at the start of each level.
     */
    async generateBriefing(level, previousScore = 0) {
        const context = { level, previousScore };
        
        if (LLM_CONFIG.cacheEnabled) {
            const cached = this.cache.get('briefing', context);
            if (cached) return cached;
        }
        
        const systemPrompt = `You are VELLOX Command, Booz Allen Hamilton's AI-native cyber-defense assistant. The philosophy is "Fight AI With AI" — pairing machine-speed automation with adversary tradecraft to close the speed gap against AI-powered attackers. Give a brief, urgent mission briefing to the human operator. You may reference Vellox products: Reverser (malware reverse-engineering), Ranger (autonomous detection/hunting), Navigator (continuous monitoring). Keep it under 25 words. Encouraging but serious.`;

        const userPrompt = `Generate a briefing for defense phase ${level}. The operator's current score is ${previousScore}. Make it feel unique and urgent.`;
        
        const response = await this.sendPrompt(systemPrompt, userPrompt, {
            maxTokens: 60,
            temperature: 0.7
        });
        
        if (response) {
            this.cache.set('briefing', context, response);
            return response;
        }
        
        return this.getRandomFallback('briefings');
    }
    
    /**
     * Generate a procedural level description.
     * Provides flavor text for each level.
     */
    async generateLevelDescription(level) {
        const context = { level };
        
        if (LLM_CONFIG.cacheEnabled) {
            const cached = this.cache.get('levelDesc', context);
            if (cached) return cached;
        }
        
        const systemPrompt = `You are VELLOX Command narrating a cyber-defense engagement. Describe the current attack phase and how a Vellox product counters it. Products cycle: phase 1 = Vellox Reverser (reverse-engineer the malware), phase 2 = Vellox Ranger (autonomously hunt the intrusion), phase 3 = Vellox Navigator (continuous monitoring). Keep it under 20 words. Sound sharp and technical.`;

        const userPrompt = `Describe defense phase ${level} and the Vellox capability holding the line. Make each phase feel distinct.`;
        
        const response = await this.sendPrompt(systemPrompt, userPrompt, {
            maxTokens: 50,
            temperature: 0.8
        });
        
        if (response) {
            this.cache.set('levelDesc', context, response);
            return response;
        }
        
        const index = Math.min(level - 1, FALLBACK_RESPONSES.levelDescriptions.length - 1);
        return FALLBACK_RESPONSES.levelDescriptions[index];
    }
    
    /**
     * Generate a power-up hint message.
     * Called when power-ups appear in game.
     */
    async generatePowerUpHint(powerUpType = 'generic') {
        const context = { type: powerUpType };
        
        if (LLM_CONFIG.cacheEnabled) {
            const cached = this.cache.get('hint', context);
            if (cached) return cached;
        }
        
        const systemPrompt = `You are VELLOX Command. Alert the operator that a Vellox capability is available to deploy. Map types: laser=Vellox Reverser, missile=Vellox Ranger, spread=Vellox Navigator, shield=firewall patch, extraLife=redundant nodes, bomb=kill-chain break, bonus=threat-intel cache. Keep it under 12 words. Excited but professional.`;

        const userPrompt = `A ${powerUpType} capability has appeared. Alert the operator!`;
        
        const response = await this.sendPrompt(systemPrompt, userPrompt, {
            maxTokens: 30,
            temperature: 0.7
        });
        
        if (response) {
            this.cache.set('hint', context, response);
            return response;
        }
        
        return this.getRandomFallback('powerUpHints');
    }
    
    /**
     * Generate a performance comment based on player stats.
     * Called periodically to provide feedback.
     */
    async generatePerformanceComment(stats = {}) {
        const accuracy = stats.accuracy || 0;
        const efficiency = stats.efficiency || 0;
        
        let performanceLevel = 'average';
        if (accuracy > 70 && efficiency > 80) performanceLevel = 'excellent';
        else if (accuracy > 50 || efficiency > 60) performanceLevel = 'good';
        else if (accuracy < 30 && efficiency < 40) performanceLevel = 'poor';
        
        const context = { performanceLevel };
        
        if (LLM_CONFIG.cacheEnabled) {
            const cached = this.cache.get('performance', context);
            if (cached) return cached;
        }
        
        const systemPrompt = `You are VELLOX Command assessing a cyber operator's defense in real time. Use SOC language — dwell time, containment, kill chain, machine speed. Generate a short comment (under 15 words) matching their performance level: ${performanceLevel}.`;

        const userPrompt = `Operator detection accuracy: ${accuracy}%, containment efficiency: ${efficiency}%. Comment on their ${performanceLevel} defense.`;
        
        const response = await this.sendPrompt(systemPrompt, userPrompt, {
            maxTokens: 40,
            temperature: 0.7
        });
        
        if (response) {
            this.cache.set('performance', context, response);
            return response;
        }
        
        return this.getRandomFallback('performanceComments', performanceLevel);
    }
    
    /**
     * Generate a game over comment based on final score.
     */
    async generateGameOverComment(score, level, stats = {}) {
        const context = { 
            scoreRange: score > 5000 ? 'high' : score > 2000 ? 'medium' : 'low'
        };
        
        if (LLM_CONFIG.cacheEnabled) {
            const cached = this.cache.get('gameOver', context);
            if (cached) return cached;
        }
        
        const systemPrompt = `You are VELLOX Command delivering a final after-action message once the engagement ends (the adversary breached the defense). Reference closing the speed gap and fighting AI with AI. Be respectful of the operator's effort. Keep it under 25 words.`;

        const userPrompt = `Engagement over. Score: ${score}, phase reached: ${level}. Generate a ${context.scoreRange}-score after-action message.`;
        
        const response = await this.sendPrompt(systemPrompt, userPrompt, {
            maxTokens: 60,
            temperature: 0.7
        });
        
        if (response) {
            this.cache.set('gameOver', context, response);
            return response;
        }
        
        // Fallback based on score
        if (score > 5000) return FALLBACK_RESPONSES.gameOverComments.highScore;
        if (score > 2000) return FALLBACK_RESPONSES.gameOverComments.mediumScore;
        return FALLBACK_RESPONSES.gameOverComments.lowScore;
    }
    
    /**
     * Get a random fallback response of a specific type.
     */
    getRandomFallback(type, subType = null) {
        let responses = FALLBACK_RESPONSES[type];
        
        if (subType && typeof responses === 'object' && !Array.isArray(responses)) {
            responses = responses[subType];
        }
        
        if (Array.isArray(responses) && responses.length > 0) {
            return responses[Math.floor(Math.random() * responses.length)];
        }
        
        return "Systems nominal.";
    }
    
    /**
     * Clear the prompt cache.
     */
    clearCache() {
        this.cache.clear();
    }
    
    /**
     * Check if LLM is available.
     */
    isReady() {
        return this.isInitialized && this.isAvailable;
    }
}

// Create and export singleton instance
const llmManager = new LLMManager();

export { llmManager, LLMManager, LLM_CONFIG, FALLBACK_RESPONSES };
