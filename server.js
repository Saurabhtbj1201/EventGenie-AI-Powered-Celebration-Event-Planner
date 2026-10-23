/**
 * EventGenie — Local Development Server
 * Serves static files and routes /api/generate to the Vercel-style API handler.
 * Runs on Node.js without requiring external server dependencies.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import handler from './api/generate.js';

// Load .env if present
try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile();
  } else {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...vals] = trimmed.split('=');
          if (key && vals.length) {
            process.env[key.trim()] = vals.join('=').trim();
          }
        }
      });
    }
  }
} catch (e) {
  // Silent fallback
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // ── Handle /api/generate ───────────────────────────────────────────────────
  if (pathname === '/api/generate') {
    // Adapt Node req/res to Vercel serverless function signature
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (data) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(data));
      return res;
    };

    if (req.method === 'POST') {
      let bodyStr = '';
      req.on('data', chunk => {
        bodyStr += chunk;
      });
      req.on('end', async () => {
        try {
          req.body = bodyStr ? JSON.parse(bodyStr) : {};
        } catch (err) {
          return res.status(400).json({ error: 'Invalid JSON body' });
        }
        try {
          await handler(req, res);
        } catch (handlerErr) {
          console.error('API Handler Error:', handlerErr);
          if (!res.writableEnded) {
            res.status(500).json({ error: 'Internal Server Error' });
          }
        }
      });
      return;
    } else {
      // OPTIONS or other methods
      return handler(req, res);
    }
  }

  // ── Serve Static Assets ────────────────────────────────────────────────────
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  
  // Security check: prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Try appending .html or return 404
      const htmlPath = filePath + '.html';
      if (fs.existsSync(htmlPath) && fs.statSync(htmlPath).isFile()) {
        filePath = htmlPath;
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`404 Not Found: ${pathname}`);
        return;
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  const keyStatus = process.env.GEMINI_API_KEY ? '✅ Detected in .env' : '⚠️ Missing GEMINI_API_KEY in .env';
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║               🎉 EventGenie Local Dev Server                ║
╠══════════════════════════════════════════════════════════════╣
║  🌐 Web App:    http://localhost:${PORT}                       ║
║  ⚡ API Proxy:  http://localhost:${PORT}/api/generate          ║
║  🔑 Gemini Key: ${keyStatus.padEnd(44)} ║
╚══════════════════════════════════════════════════════════════╝
`);
});
