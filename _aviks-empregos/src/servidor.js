// Painel + agendador. `npm start` deixa tudo rodando: busca/candidatura no horário do perfil e e-mails a cada N minutos.
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import cron from 'node-cron';
import { RAIZ, ENV, carregarPerfil } from './config.js';
import { db, STATUS, atualizarVaga, registrar, lerEstado, gravarEstado, agora } from './db.js';
import { cicloCompleto, cicloEmails, estaRodando } from './rodar.js';
import { enviarRespostaPendencia } from './emails.js';

const app = express();
app.use(express.json({ limit: '200kb' }));

const igual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
app.use('/api', (req, res, next) => {
  if (!ENV.senhaPainel) return next();
  const t = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (t && igual(t, ENV.senhaPainel)) return next();
  res.status(401).json({ erro: 'senha' });
});

app.get('/api/resumo', (_req, res) => {
  const porStatus = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM vagas GROUP BY status').all().map((r) => [r.status, r.n]));
  const hoje = db.prepare(`SELECT
      (SELECT COUNT(*) FROM vagas WHERE date(encontrada_em) = date('now','localtime')) encontradas,
      (SELECT COUNT(*) FROM vagas WHERE date(candidatada_em) = date('now','localtime')) candidatadas`).get();
  const porDia = db.prepare(`SELECT date(candidatada_em) dia, COUNT(*) n FROM vagas WHERE candidatada_em IS NOT NULL
      AND candidatada_em >= date('now','localtime','-29 days') GROUP BY dia ORDER BY dia`).all();
  const porFonte = db.prepare(`SELECT fonte, COUNT(*) total, SUM(candidatada_em IS NOT NULL) candidatadas FROM vagas GROUP BY fonte ORDER BY total DESC`).all();
  const agenda = db.prepare(`SELECT e.id, e.tipo, e.resumo, e.data_evento, e.link, v.empresa, v.titulo, v.id vaga_id FROM emails e
      LEFT JOIN vagas v ON v.id = e.vaga_id WHERE e.tipo IN ('entrevista','teste','prazo') AND (e.data_evento = '' OR e.data_evento >= date('now','localtime'))
      ORDER BY CASE WHEN e.data_evento = '' THEN 1 ELSE 0 END, e.data_evento LIMIT 20`).all();
  const pendencias = db.prepare('SELECT COUNT(*) n FROM pendencias WHERE resolvida_em IS NULL').get().n;
  const perfil = carregarPerfil();
  res.json({
    porStatus, rotulos: STATUS, hoje, porDia, porFonte, agenda, pendencias,
    rodando: estaRodando(), pausado: lerEstado('pausado', false),
    ultimoCiclo: lerEstado('ultimo_ciclo'), ultimoEmail: lerEstado('ultimo_email'),
    nota_minima: perfil.nota_minima, limite_dia: perfil.max_candidaturas_por_dia, horario: perfil.horario_busca,
  });
});

app.get('/api/vagas', (req, res) => {
  const filtros = [];
  const args = [];
  if (req.query.status) { filtros.push(`status IN (${String(req.query.status).split(',').map(() => '?').join(',')})`); args.push(...String(req.query.status).split(',')); }
  if (req.query.q) { filtros.push('(titulo LIKE ? OR empresa LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  res.json(db.prepare(`SELECT id, fonte, url, titulo, empresa, local, modelo, salario, nota, motivo, status, etapa,
      encontrada_em, candidatada_em, atualizada_em FROM vagas ${where} ORDER BY atualizada_em DESC LIMIT 1000`).all(...args));
});

app.get('/api/vagas/:id', (req, res) => {
  const v = db.prepare('SELECT * FROM vagas WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ erro: 'não encontrada' });
  v.eventos = db.prepare("SELECT quando, tipo, texto FROM eventos WHERE vaga_id = ? AND tipo <> 'id_externo' ORDER BY id DESC").all(v.id);
  v.emails = db.prepare('SELECT recebido_em, de, assunto, tipo, resumo, data_evento, link, respondido, resposta FROM emails WHERE vaga_id = ? ORDER BY id DESC').all(v.id);
  res.json(v);
});

app.patch('/api/vagas/:id', (req, res) => {
  const campos = {};
  if (req.body.status && STATUS[req.body.status]) campos.status = req.body.status;
  if (typeof req.body.etapa === 'string') campos.etapa = req.body.etapa.slice(0, 500);
  if (campos.status === 'aprovada') campos.tentativas = 0;
  atualizarVaga(Number(req.params.id), campos);
  registrar('manual', `Alterado no painel: ${JSON.stringify(campos)}`, Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/pendencias', (_req, res) => {
  res.json(db.prepare(`SELECT p.*, v.titulo, v.empresa, v.url FROM pendencias p LEFT JOIN vagas v ON v.id = p.vaga_id
      WHERE p.resolvida_em IS NULL ORDER BY p.id DESC`).all());
});

app.post('/api/pendencias/:id', async (req, res) => {
  const p = db.prepare('SELECT * FROM pendencias WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ erro: 'não encontrada' });
  const resposta = String(req.body.resposta || '').trim();
  const acao = req.body.acao || 'responder'; // responder | ignorar
  try {
    if (acao === 'responder') {
      if (!resposta) return res.status(400).json({ erro: 'Escreva a resposta' });
      if (req.body.lembrar !== false) {
        db.prepare('INSERT INTO respostas_aprendidas (pergunta, resposta) VALUES (?, ?) ON CONFLICT(pergunta) DO UPDATE SET resposta = excluded.resposta')
          .run(p.pergunta.slice(0, 500), resposta);
      }
      if (p.email_id && req.body.enviar_email) await enviarRespostaPendencia(p.email_id, resposta);
      if (p.vaga_id && !p.email_id) atualizarVaga(p.vaga_id, { status: 'aprovada', tentativas: 0, etapa: 'Resposta recebida; nova tentativa no próximo ciclo' });
    } else if (p.vaga_id && !p.email_id) {
      atualizarVaga(p.vaga_id, { status: 'descartada', motivo: 'Descartada por você no painel' });
    }
    db.prepare('UPDATE pendencias SET resposta = ?, resolvida_em = ? WHERE id = ?').run(resposta || '(ignorada)', agora(), p.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

app.get('/api/eventos', (req, res) => {
  const lim = Math.min(Number(req.query.limite) || 100, 500);
  res.json(db.prepare(`SELECT e.quando, e.tipo, e.texto, e.vaga_id, v.empresa FROM eventos e LEFT JOIN vagas v ON v.id = e.vaga_id
      WHERE e.tipo <> 'id_externo' ORDER BY e.id DESC LIMIT ?`).all(lim));
});

app.post('/api/rodar', (_req, res) => {
  if (process.env.AVIKS_DEMO) return res.json({ ok: false, motivo: 'Modo demonstração' });
  if (estaRodando()) return res.json({ ok: false, motivo: 'Já está rodando' });
  cicloCompleto().catch(() => {});
  res.json({ ok: true });
});

app.post('/api/pausar', (req, res) => {
  gravarEstado('pausado', !!req.body.pausado);
  registrar('manual', req.body.pausado ? 'Agente pausado' : 'Agente retomado');
  res.json({ ok: true });
});

app.use(express.static(path.join(RAIZ, 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(RAIZ, 'public', 'painel.html')));

// ---------- agenda ----------
const perfil = carregarPerfil();
if (!process.env.AVIKS_DEMO) {
  cron.schedule(perfil.horario_busca, () => cicloCompleto(), { timezone: ENV.fusoHorario });
  cron.schedule(`*/${Math.max(5, perfil.intervalo_emails_min)} * * * *`, () => { if (!estaRodando()) cicloEmails().catch(() => {}); }, { timezone: ENV.fusoHorario });
}

const host = ENV.senhaPainel ? '0.0.0.0' : '127.0.0.1';
app.listen(ENV.porta, host, () => {
  console.log(`Aviks Empregos no ar: http://${host === '127.0.0.1' ? 'localhost' : host}:${ENV.porta}`);
  console.log(`Busca e candidaturas: "${perfil.horario_busca}" (${ENV.fusoHorario}); e-mails a cada ${perfil.intervalo_emails_min} min.`);
  if (!ENV.senhaPainel) console.log('Sem SENHA_PAINEL: o painel só abre neste computador. Defina uma senha no .env para abrir no celular.');
});
