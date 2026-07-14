/**
 * ===========================================
 * VELLOX — Zero-dependency static server
 * ===========================================
 *
 * Runs the game in STANDALONE mode with NO `npm install` required
 * (uses only Node.js built-in modules — no foundry-local-sdk, no koffi).
 *
 * Use this on locked-down machines where `npm install` is blocked.
 * The AI Commander shows OFFLINE and uses the built-in VELLOX fallback
 * dialogue. For live AI you need the full `npm start` (server.js) path.
 *
 * Usage:
 *   node serve-local.js
 *   then open  http://localhost:8080
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';

    const fullPath = path.join(__dirname, urlPath);

    // Prevent directory traversal outside the project folder
    if (!fullPath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(fullPath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }
        const ext = path.extname(fullPath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(content);
    });
});

server.listen(PORT, () => {
    console.log('========================================');
    console.log('  VELLOX — Cyber Defense Simulator');
    console.log('  Standalone mode (no dependencies)');
    console.log('========================================');
    console.log('');
    console.log(`  Playing at:  http://localhost:${PORT}`);
    console.log('');
    console.log('  AI shows OFFLINE here (built-in scripted lines).');
    console.log('  No npm install / Foundry Local needed.');
    console.log('  Press Ctrl+C to stop.');
});
