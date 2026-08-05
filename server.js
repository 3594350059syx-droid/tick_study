const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const dbPath = path.join(ROOT, 'data', 'tickmemory.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL)');

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const backupsDir = path.join(ROOT, 'data', 'backups');
fs.mkdirSync(backupsDir, { recursive: true });
function backupSnapshot(state, updatedAt) {
  const name = 'tickmemory-' + updatedAt.replace(/[:TZ]/g, '-').slice(0, 19) + '.json';
  fs.writeFileSync(path.join(backupsDir, name), JSON.stringify(state, null, 2));
  const all = fs.readdirSync(backupsDir).filter(f => f.endsWith('.json')).sort();
  while (all.length > 7) fs.unlinkSync(path.join(backupsDir, all.shift()));
}
function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 2_000_000) { reject(new Error('Payload too large')); req.destroy(); } });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/state' && req.method === 'GET') {
      const row = db.prepare('SELECT payload, updated_at FROM app_state WHERE id = 1').get();
      return send(res, 200, { state: row ? JSON.parse(row.payload) : null, updatedAt: row?.updated_at || null });
    }
    if (url.pathname === '/api/state' && req.method === 'PUT') {
      const state = JSON.parse(await readBody(req));
      if (!state || !Array.isArray(state.tasks)) return send(res, 400, { error: 'Invalid state: tasks must be an array.' });
      for (const t of state.tasks) {
        if (t.note == null) continue;
        if (typeof t.note !== 'object' || Array.isArray(t.note) || typeof t.note.content !== 'string')
          return send(res, 400, { error: 'Invalid note: must be an object with string content.' });
        if (t.note.content.length > 50_000)
          return send(res, 400, { error: 'Invalid note: content exceeds 50000 characters.' });
      }
      const updatedAt = new Date().toISOString();
      db.prepare('INSERT INTO app_state (id, payload, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at').run(JSON.stringify(state), updatedAt);
      backupSnapshot(state, updatedAt);
      return send(res, 200, { ok: true, updatedAt });
    }
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, database: dbPath });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^[/\\]+/, '');
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (error) {
    console.error(error);
    send(res, 500, { error: error.message || 'Server error' });
  }
}).listen(PORT, () => console.log(`TickMemory is running at http://localhost:${PORT}`));
