// Monitor de visitas e cliques no WhatsApp — sem dependências (Node 20+)
//
//   POST /api            ← o site envia eventos (texto JSON, via sendBeacon)
//   GET  /api?dias=      → o painel lê os eventos (senha no cabeçalho Authorization: Bearer …)
//   POST /api/lead       ← cadastro feito antes de abrir o WhatsApp (nome + WhatsApp)
//   GET  /api/leads      → o painel lê os cadastros (com senha)
//   DELETE /api/leads?tel= → remove um cadastro (pedido de exclusão, LGPD)
//   GET  /api/meta?dias=   → anúncios da Meta e Instagram (com senha; ver meta.js)
//   POST/DELETE /api/meta/config → conecta (token) ou desconecta a Meta (com senha)
//   POST /api/meta/manual  ← números da conta de anúncios lidos no Gerenciador (senha ou COLETOR_TOKEN)
//   GET  /adm            → o painel
//   GET  /saude          → verificação simples ("ok")
//
// Dados: uma linha JSON por evento em DATA_DIR/eventos.ndjson (sem dado pessoal; o IP só é usado na hora para achar
// cidade/estado e é descartado). Cadastros ficam à parte em DATA_DIR/cadastros.ndjson e só saem com a senha do painel.

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
const CADASTROS = path.join(DATA_DIR, 'cadastros.ndjson');
const MANUAL = path.join(DATA_DIR, 'meta-manual.json');
const COLETOR = process.env.COLETOR_TOKEN || '';
const TIPOS = new Set(['visita', 'clique_whatsapp', 'lead', 'whatsapp_aberto']);
const localDoIp = require('./geo')(process.env.GEO_DB || path.join(__dirname, 'geo', 'dbip-city-lite.mmdb'));
const meta = require('./meta')(DATA_DIR);

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

function lerLinhas(arquivo) {
  if (!fs.existsSync(arquivo)) return [];
  const out = [];
  for (const linha of fs.readFileSync(arquivo, 'utf8').split('\n')) {
    if (!linha) continue;
    try { out.push(JSON.parse(linha)); } catch (err) { /* linha corrompida */ }
  }
  return out;
}

// Corpo pequeno em texto (sendBeacon manda text/plain)
function lerCorpo(req, cb) {
  let corpo = '';
  req.on('data', (c) => { corpo += c; if (corpo.length > 2048) req.destroy(); });
  req.on('end', () => { try { cb(JSON.parse(corpo || '{}')); } catch (err) { cb(null); } });
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

  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, DELETE', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }); return res.end(); }

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

  if (url.pathname === '/api/lead' && req.method === 'POST') {
    if (!permitido(ip)) return json(res, 429, { ok: false });
    lerCorpo(req, (d) => {
      // tira do início caracteres que viram fórmula em planilha (=, +, -, @)
      const nome = corta(d && d.n, 60).replace(/\s+/g, ' ').trim().replace(/^[=+\-@]+/, '').trim();
      const tel = String((d && d.w) || '').replace(/\D/g, '');
      const telOk = (tel.length === 10 || tel.length === 11) && Number(tel.slice(0, 2)) >= 11;
      if (!nome || !telOk) return json(res, 400, { ok: false });
      const lugar = localDoIp(ip);
      const cad = [Date.now(), nome, tel, corta(d.o, 40), corta(d.l, 80), corta(d.d, 12), corta(lugar.cidade, 60), corta(lugar.estado, 40)];
      fs.appendFile(CADASTROS, JSON.stringify(cad) + '\n', (err) => json(res, err ? 500 : 200, { ok: !err }));
    });
    return;
  }

  if (url.pathname === '/api/leads' && (req.method === 'GET' || req.method === 'DELETE')) {
    if (!senhaConfere(req)) return setTimeout(() => json(res, 401, { erro: 'senha' }), 800);
    if (req.method === 'DELETE') {
      const tel = String(url.searchParams.get('tel') || '').replace(/\D/g, '');
      if (!tel) return json(res, 400, { ok: false });
      const resto = lerLinhas(CADASTROS).filter((c) => c[2] !== tel);
      fs.writeFile(CADASTROS, resto.map((c) => JSON.stringify(c)).join('\n') + (resto.length ? '\n' : ''), (err) => json(res, err ? 500 : 200, { ok: !err }));
      return;
    }
    return json(res, 200, { gerado: Date.now(), cadastros: lerLinhas(CADASTROS) });
  }
  // Números da conta de anúncios que a API não alcança, lidos no Gerenciador e gravados aqui (bloco temporário).
  // Aceita a senha do painel ou a chave do coletor (COLETOR_TOKEN), que só serve para esta rota.
  if (url.pathname === '/api/meta/manual' && req.method === 'POST') {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    const chaveOk = COLETOR && m && crypto.timingSafeEqual(crypto.createHash('sha256').update(m[1]).digest(), crypto.createHash('sha256').update(COLETOR).digest());
    if (!chaveOk && !senhaConfere(req)) return setTimeout(() => json(res, 401, { erro: 'senha' }), 800);
    lerCorpo(req, (d) => {
      if (!d || typeof d !== 'object') return json(res, 400, { ok: false });
      const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
      const reg = { em: Date.now(), campanha: corta(d.campanha, 80), status: corta(d.status, 30), gasto: n(d.gasto), limite: n(d.limite),
        alcance: n(d.alcance), impressoes: n(d.impressoes), cliques: n(d.cliques), conversas: n(d.conversas), lidoEm: corta(d.lidoEm, 30) };
      fs.writeFile(MANUAL, JSON.stringify(reg), (err) => json(res, err ? 500 : 200, { ok: !err }));
    });
    return;
  }

  // Meta (anúncios e Instagram): o servidor consulta a Graph API com o token guardado aqui
  if (url.pathname === '/api/meta' || url.pathname === '/api/meta/config') {
    if (!senhaConfere(req)) return setTimeout(() => json(res, 401, { erro: 'senha' }), 800);
    if (url.pathname === '/api/meta' && req.method === 'GET') {
      const dias = Math.min(Math.max(Number(url.searchParams.get('dias')) || 30, 1), 90);
      let manual = null;
      try { manual = JSON.parse(fs.readFileSync(MANUAL, 'utf8')); } catch (err) { /* ainda não gravado */ }
      meta.dados(dias).then((d) => json(res, 200, Object.assign({}, d, { manual })), (err) => json(res, 502, { erro: String(err.message || err).slice(0, 200), manual }));
      return;
    }
    if (url.pathname === '/api/meta/config' && req.method === 'POST') {
      lerCorpo(req, (d) => {
        const token = String((d && d.token) || '').trim();
        if (!/^[A-Za-z0-9_-]{40,1000}$/.test(token)) return json(res, 400, { ok: false, erro: 'Token inválido.' });
        meta.configurar(token).then((r) => json(res, 200, Object.assign({ ok: true }, r)), (err) => json(res, 400, { ok: false, erro: String(err.message || err).slice(0, 200) }));
      });
      return;
    }
    if (url.pathname === '/api/meta/config' && req.method === 'DELETE') { meta.desconectar(); return json(res, 200, { ok: true }); }
    res.writeHead(405); return res.end();
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
