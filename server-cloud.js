/**
 * ===========================================
 * VELLOX — Cloud AI server (ZERO dependencies)
 * ===========================================
 *
 * Serves the game AND provides a LIVE AI Commander by proxying to a cloud
 * LLM over HTTPS. Uses only Node.js built-ins — NO `npm install`, no
 * foundry-local-sdk, no koffi. Ideal for locked-down machines where the
 * native SDK install is blocked.
 *
 * The browser talks to this local server (localhost:3001); this server holds
 * your API key and calls the cloud model, so the key is never sent to the
 * browser. Same endpoints as server.js, so the game needs no changes.
 *
 * ---- Setup (one time) ----
 * 1. Get a free API key:
 *      • Google Gemini (free, no credit card):  https://aistudio.google.com/apikey
 *      • or Groq (free):                         https://console.groq.com/keys
 * 2. Copy ai-config.example.json -> ai-config.json and paste your key,
 *      OR set env vars (see below).
 * 3. Run:  node server-cloud.js   and open http://localhost:3001
 *
 * ---- Config (ai-config.json or env vars) ----
 *   AI_PROVIDER : "gemini" (default) | "openai"   ("openai" also fits Groq/OpenRouter)
 *   AI_API_KEY  : your key (required)
 *   AI_MODEL    : optional model override
 *   AI_BASE_URL : optional, for OpenAI-compatible providers
 *                 (Groq: https://api.groq.com/openai/v1)
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

// ---- Load config: ai-config.json first, then env-var overrides ----
const cfg = { provider: 'gemini', apiKey: '', model: '', baseUrl: '' };
try {
    Object.assign(cfg, JSON.parse(fs.readFileSync(path.join(__dirname, 'ai-config.json'), 'utf8')));
} catch { /* no file — rely on env vars */ }
cfg.provider = (process.env.AI_PROVIDER || cfg.provider || 'gemini').toLowerCase();
cfg.apiKey = process.env.AI_API_KEY || cfg.apiKey || '';
cfg.model = process.env.AI_MODEL || cfg.model || '';
cfg.baseUrl = process.env.AI_BASE_URL || cfg.baseUrl || '';

const DEFAULT_MODEL = { gemini: 'gemini-2.0-flash', openai: 'gpt-4o-mini' };
const model = cfg.model || DEFAULT_MODEL[cfg.provider] || DEFAULT_MODEL.gemini;
const ready = Boolean(cfg.apiKey);

const MIME_TYPES = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

// ============================================
// Cloud LLM call (built-in fetch, no deps)
// ============================================

async function callLLM(systemPrompt, userPrompt, { maxTokens = 100, temperature = 0.8 } = {}) {
    if (typeof fetch !== 'function') {
        throw new Error('Global fetch not available — please use Node.js 18 or newer.');
    }

    if (cfg.provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                generationConfig: { temperature, maxOutputTokens: maxTokens }
            })
        });
        if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    }

    // OpenAI-compatible (OpenAI, Groq, OpenRouter, ...)
    const base = cfg.baseUrl || 'https://api.openai.com/v1';
    const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature,
            max_tokens: maxTokens
        })
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
}

// ============================================
// HTTP server
// ============================================

function sendJSON(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    // ---- API endpoints (same shape as server.js so llm.js works unchanged) ----
    if (url.pathname === '/health' && req.method === 'GET') {
        return sendJSON(res, 200, { status: 'ok', initialized: ready, provider: cfg.provider, model });
    }
    if (url.pathname === '/status' && req.method === 'GET') {
        return sendJSON(res, 200, ready
            ? { state: 'ready', progress: 100, message: `Cloud AI ready (${cfg.provider}/${model})`, modelAlias: model }
            : { state: 'error', message: 'No API key configured — set ai-config.json or AI_API_KEY', modelAlias: model });
    }
    if (url.pathname === '/chat' && req.method === 'POST') {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', async () => {
            try {
                if (!ready) return sendJSON(res, 503, { error: 'No API key configured' });
                const { systemPrompt, userPrompt, maxTokens, temperature } = JSON.parse(body);
                if (!systemPrompt || !userPrompt) return sendJSON(res, 400, { error: 'Missing systemPrompt or userPrompt' });
                const content = await callLLM(systemPrompt, userPrompt, { maxTokens, temperature });
                console.log(`[Cloud] "${userPrompt.slice(0, 40)}..." -> "${content.slice(0, 40)}..."`);
                sendJSON(res, 200, { content });
            } catch (err) {
                console.error('[Cloud] Chat error:', err.message);
                sendJSON(res, 500, { error: err.message });
            }
        });
        return;
    }

    // ---- Static file serving ----
    if (req.method === 'GET') {
        let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
        const fullPath = path.join(__dirname, decodeURIComponent(filePath));
        if (!fullPath.startsWith(__dirname)) { res.writeHead(403); res.end('Forbidden'); return; }
        fs.readFile(fullPath, (err, content) => {
            if (err) { res.writeHead(404); res.end('Not found'); return; }
            res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(fullPath).toLowerCase()] || 'application/octet-stream' });
            res.end(content);
        });
        return;
    }

    res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
    console.log('========================================');
    console.log('  VELLOX — Cloud AI server (no deps)');
    console.log('========================================');
    console.log('');
    console.log(`  Playing at:  http://localhost:${PORT}`);
    if (ready) {
        console.log(`  AI: ONLINE  (${cfg.provider} / ${model})`);
    } else {
        console.log('  AI: OFFLINE — no API key found.');
        console.log('  Add your key to ai-config.json (copy ai-config.example.json),');
        console.log('  or set the AI_API_KEY env var, then restart.');
    }
    console.log('');
    console.log('  Press Ctrl+C to stop.');
});
