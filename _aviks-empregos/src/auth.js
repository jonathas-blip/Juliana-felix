// Login do painel: usuário + senha (guardada como hash scrypt no .env) e sessão em cookie assinado.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DIR_DADOS } from './config.js';

const COOKIE = 'aviks_sessao';
const DURACAO_MS = 30 * 24 * 3600 * 1000; // 30 dias: o app do celular fica logado

export const USUARIO = (process.env.PAINEL_USUARIO || '').trim();
const HASH = (process.env.PAINEL_SENHA_HASH || '').trim();
export const loginAtivo = Boolean(USUARIO && HASH);

// Segredo que assina os cookies. Se não vier no .env, é criado uma vez e guardado em dados/.
function segredo() {
  if (process.env.SESSAO_SEGREDO) return process.env.SESSAO_SEGREDO;
  const arq = path.join(DIR_DADOS, 'segredo-sessao');
  if (!fs.existsSync(arq)) fs.writeFileSync(arq, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(arq, 'utf8').trim();
}
const SEGREDO = segredo();

export function gerarHash(senha) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(senha, sal, 64, { N: 16384, r: 8, p: 1 });
  // Separador ":" (e não "$"), porque o Docker Compose interpreta "$" dentro do .env.
  return `scrypt:${sal.toString('base64url')}:${h.toString('base64url')}`;
}

function senhaConfere(senha) {
  const [alg, sal, esperado] = HASH.split(':');
  if (alg !== 'scrypt' || !sal || !esperado) return false;
  const h = crypto.scryptSync(String(senha), Buffer.from(sal, 'base64url'), 64, { N: 16384, r: 8, p: 1 });
  const e = Buffer.from(esperado, 'base64url');
  return e.length === h.length && crypto.timingSafeEqual(e, h);
}

const assinar = (dados) => crypto.createHmac('sha256', SEGREDO).update(dados).digest('base64url');

function criarToken(usuario) {
  const dados = Buffer.from(JSON.stringify({ u: usuario, exp: Date.now() + DURACAO_MS })).toString('base64url');
  return `${dados}.${assinar(dados)}`;
}

function lerToken(token) {
  const [dados, sig] = String(token || '').split('.');
  if (!dados || !sig) return null;
  const certo = assinar(dados);
  if (sig.length !== certo.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(certo))) return null;
  try {
    const s = JSON.parse(Buffer.from(dados, 'base64url').toString());
    return s.exp > Date.now() && s.u === USUARIO ? s : null;
  } catch {
    return null;
  }
}

function cookies(req) {
  return Object.fromEntries((req.get('cookie') || '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2));
}

export function sessaoValida(req) {
  if (!loginAtivo) return true;
  return Boolean(lerToken(cookies(req)[COOKIE]));
}

function gravarCookie(req, res, valor, maxAgeMs) {
  const partes = [`${COOKIE}=${valor}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (req.secure) partes.push('Secure');
  res.append('Set-Cookie', partes.join('; '));
}

// Proteção contra tentativa e erro: 5 senhas erradas por IP bloqueiam 15 minutos.
const falhas = new Map();
function bloqueado(ip) {
  const f = falhas.get(ip);
  if (!f) return false;
  if (Date.now() - f.desde > 15 * 60 * 1000) { falhas.delete(ip); return false; }
  return f.n >= 5;
}

export function rotasLogin(app) {
  app.post('/entrar', (req, res) => {
    if (!loginAtivo) return res.json({ ok: true });
    const ip = req.ip;
    if (bloqueado(ip)) return res.status(429).json({ erro: 'Muitas tentativas. Espere 15 minutos.' });
    const { usuario = '', senha = '' } = req.body || {};
    const usuarioOk = String(usuario).trim().toLowerCase() === USUARIO.toLowerCase();
    const senhaOk = senhaConfere(senha); // sempre calcula, para não revelar pelo tempo se o usuário existe
    if (!usuarioOk || !senhaOk) {
      const f = falhas.get(ip) || { n: 0, desde: Date.now() };
      f.n++;
      falhas.set(ip, f);
      return res.status(401).json({ erro: 'Usuário ou senha incorretos' });
    }
    falhas.delete(ip);
    gravarCookie(req, res, criarToken(USUARIO), DURACAO_MS);
    res.json({ ok: true });
  });

  app.post('/sair', (req, res) => {
    gravarCookie(req, res, '', 0);
    res.json({ ok: true });
  });
}

// /api exige sessão. Pedidos que mudam algo exigem JSON (bloqueia formulários de outros sites: CSRF).
export function protegerApi(req, res, next) {
  if (!sessaoValida(req)) return res.status(401).json({ erro: 'login' });
  if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ erro: 'JSON' });
  next();
}
