// Monitor de visitas e cliques no WhatsApp — sem dependências (Node 20+)
//
//   POST /api            ← o site envia eventos (texto JSON, via sendBeacon)
//   GET  /api?dias=      → o painel lê os eventos (senha no cabeçalho Authorization: Bearer …)
//   GET  /adm            → o painel
//   GET  /saude          → verificação simples ("ok")
//
// Dados: uma linha JSON por evento em DATA_DIR/eventos.ndjson.
// Nenhum dado pessoal é guardado: o IP só é usado na hora para achar cidade/estado (geo.js) e é descartado.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8080;
const SENHA = process.env.SENHA_PAINEL || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'dados');
const ORIGENS = (process.env.ORIGENS_PERMITIDAS || 'https://julianafelix.com.br,https://www.julianafelix.com.br').split(',').map((s) => s.trim());
const ARQUIVO = path.join(DATA_DIR, 'eventos.ndjson');
const PAINEL = path.join(__dirname, 'public', 'adm.html');
const TIPOS = new Set(['visita', 'clique_whatsapp']);
const localDoIp = require('./geo')(process.env.GEO_DB || path.join(__dirname, 'geo', 'dbip-city-lite.mmdb'));

// Arquivos do "app" do painel (ícone na tela inicial do celular)
const ESTATICOS = {
  '/manifest.webmanifest': 'application/manifest+json',
  '/icone-192.png': 'image/png',
  '/icone-512.png': 'image/png',
  '/apple-touch-icon.png': 'image/png'
};

if (!SENHA) { console.error('Defina SENHA_PAINEL.'); process.exit(1); }
fs.mkdirSync(DATA_DIR, { recursive: true });

// Limite simples contra abuso: 60 eventos por minuto por IP (mantido só em memória)
const janela = new Map();
function permitido(ip) {
  const agora = Date.now();
  const r = janela.get(ip) || { inicio: agora, n: 0 };
  if (agora - r.inicio > 60000) { r.inicio = agora; r.n = 0; }
  r.n++;
  janela.set(ip, r);
  return r.n <= 60;
}
setInterval(() => { const lim = Date.now() - 120000; for (const [ip, r] of janela) if (r.inicio < lim) janela.delete(ip); }, 60000).unref();

// Senha vem no cabeçalho (não na URL, para não ficar em logs); comparação em tempo constante
function senhaConfere(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const a = crypto.createHash('sha256').update(m ? m[1] : '').digest();
  const b = crypto.createHash('sha256').update(SENHA).digest();
  return crypto.timingSafeEqual(a, b);
}

const corta =(v, max) => String(v == null ? '' : v).slice(0, max);

function cors(req, res) {
  const origem = req.headers.origin;
  if (origem && ORIGENS.includes(origem)) {
    res.setHeader('Access-Control-Allow-Origin', origem);
    res.setHeader('Vary', 'Origin');
  }
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function lerEventos(desde) {
  if (!fs.existsSync(ARQUIVO)) return [];
  const out = [];
  for (const linha of fs.readFileSync(ARQUIVO, 'utf8').split('\n')) {
    if (!linha) continue;
    try { const e = JSON.parse(linha); if (e[0] >= desde) out.push(e); } catch (err) { /* linha corrompida */ }
  }
  return out;
}

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // Atrás do Caddy vale o último valor do X-Forwarded-For (o que o Caddy acrescenta); os anteriores podem ser forjados
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop().trim();
  cors(req, res);

  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }); return res.end(); }

  if (url.pathname === '/saude') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }

  if (ESTATICOS[url.pathname]) {
    fs.readFile(path.join(__dirname, 'public', url.pathname.slice(1)), (err, arq) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': ESTATICOS[url.pathname], 'Cache-Control': 'public, max-age=86400' });
      res.end(arq);
    });
    return;
  }

  if (url.pathname === '/adm' || url.pathname === '/adm/') {
    fs.readFile(PAINEL, (err, html) => {
      if (err) { res.writeHead(500); return res.end('Painel indisponível'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Frame-Options': 'DENY' });
      res.end(html);
    });
    return;
  }

  if (url.pathname === '/api' && req.method === 'POST') {
    if (!permitido(ip)) return json(res, 429, { ok: false });
    let corpo = '';
    req.on('data', (c) => { corpo += c; if (corpo.length > 2048) req.destroy(); });
    req.on('end', () => {
      try {
        const d = JSON.parse(corpo || '{}');
        if (!TIPOS.has(d.t)) return json(res, 400, { ok: false });
        // Localização aproximada pelo IP (o IP em si não é guardado)
        const lugar = localDoIp(ip);
        const ev = [Date.now(), d.t, corta(d.l, 80), corta(d.o, 40), corta(d.d, 12), corta(d.p, 80), corta(d.s, 16),
          corta(lugar.cidade, 60), corta(lugar.estado, 40), corta(d.k, 80)];
        fs.appendFile(ARQUIVO, JSON.stringify(ev) + '\n', (err) => json(res, err ? 500 : 200, { ok: !err }));
      } catch (err) {
        json(res, 400, { ok: false });
      }
    });
    return;
  }

  if (url.pathname === '/api' && req.method === 'GET') {
    if (!senhaConfere(req)) {
      // pequena espera para dificultar tentativa e erro
      return setTimeout(() => json(res, 401, { erro: 'senha' }), 800);
    }
    const dias = Math.min(Math.max(Number(url.searchParams.get('dias')) || 90, 1), 400);
    return json(res, 200, { gerado: Date.now(), eventos: lerEventos(Date.now() - dias * 86400000) });
  }

  if (url.pathname === '/') { res.writeHead(302, { Location: '/adm' }); return res.end(); }
  res.writeHead(404); res.end();
});

servidor.listen(PORT, () => console.log('Monitor ouvindo na porta ' + PORT));
