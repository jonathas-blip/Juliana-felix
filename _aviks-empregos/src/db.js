// Banco local (SQLite embutido no Node 22.13+, sem instalar nada).
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DIR_DADOS } from './config.js';

export const db = new DatabaseSync(path.join(DIR_DADOS, 'aviks-empregos.db'));
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS vagas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fonte TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  chave TEXT,                      -- empresa+título normalizados, para não repetir a mesma vaga vinda de fontes diferentes
  titulo TEXT, empresa TEXT, local TEXT, modelo TEXT, salario TEXT,
  descricao TEXT,
  publicada_em TEXT,
  encontrada_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  nota INTEGER,
  motivo TEXT,                     -- por que a nota / por que descartou
  pontos_fortes TEXT, lacunas TEXT,
  status TEXT NOT NULL DEFAULT 'nova',
  etapa TEXT,                      -- texto livre da etapa atual (ex.: "Entrevista RH 25/11 14h")
  carta TEXT,                      -- texto de apresentação enviado
  candidatada_em TEXT,
  tentativas INTEGER NOT NULL DEFAULT 0,
  atualizada_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS vagas_status ON vagas(status);
CREATE INDEX IF NOT EXISTS vagas_chave ON vagas(chave);

CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vaga_id INTEGER,
  quando TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  tipo TEXT NOT NULL,              -- busca, avaliacao, candidatura, email, entrevista, erro, aviso...
  texto TEXT
);
CREATE INDEX IF NOT EXISTS eventos_vaga ON eventos(vaga_id);

CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conta TEXT NOT NULL, uid INTEGER NOT NULL,
  message_id TEXT,
  de TEXT, assunto TEXT, recebido_em TEXT,
  tipo TEXT, resumo TEXT, data_evento TEXT, link TEXT,
  vaga_id INTEGER,
  respondido INTEGER NOT NULL DEFAULT 0, resposta TEXT,
  UNIQUE(conta, uid)
);

CREATE TABLE IF NOT EXISTS pendencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vaga_id INTEGER,
  email_id INTEGER,
  pergunta TEXT NOT NULL,
  contexto TEXT,
  criada_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  resposta TEXT,
  resolvida_em TEXT
);

-- Respostas que você deu nas pendências: o agente reaproveita nas próximas candidaturas.
CREATE TABLE IF NOT EXISTS respostas_aprendidas (
  pergunta TEXT PRIMARY KEY,
  resposta TEXT NOT NULL,
  criada_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS estado (chave TEXT PRIMARY KEY, valor TEXT);
`);

export const STATUS = {
  nova: 'Nova',
  descartada: 'Descartada',
  aprovada: 'Na fila para candidatar',
  candidatada: 'Candidatura enviada',
  precisa_de_voce: 'Precisa de você',
  falhou: 'Falhou',
  em_processo: 'Em processo',
  teste: 'Teste / desafio',
  entrevista: 'Entrevista marcada',
  oferta: 'Proposta',
  reprovada: 'Não seguiu',
  encerrada: 'Vaga encerrada',
};

export function chaveVaga(empresa, titulo) {
  const n = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return `${n(empresa)}|${n(titulo)}`;
}

export function inserirVaga(v) {
  const chave = chaveVaga(v.empresa, v.titulo);
  if (db.prepare('SELECT 1 FROM vagas WHERE url = ? OR (chave = ? AND chave <> \'|\')').get(v.url, chave)) return null;
  const r = db.prepare(`INSERT INTO vagas (fonte, url, chave, titulo, empresa, local, modelo, salario, descricao, publicada_em)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(v.fonte, v.url, chave, v.titulo || '', v.empresa || '', v.local || '', v.modelo || '',
    v.salario || '', v.descricao || '', v.publicada_em || '');
  return Number(r.lastInsertRowid);
}

export function atualizarVaga(id, campos) {
  const nomes = Object.keys(campos);
  if (!nomes.length) return;
  const sets = nomes.map((n) => `${n} = ?`).join(', ');
  db.prepare(`UPDATE vagas SET ${sets}, atualizada_em = datetime('now','localtime') WHERE id = ?`)
    .run(...nomes.map((n) => campos[n] ?? null), id);
}

export function registrar(tipo, texto, vagaId = null) {
  db.prepare('INSERT INTO eventos (vaga_id, tipo, texto) VALUES (?,?,?)').run(vagaId, tipo, String(texto ?? '').slice(0, 4000));
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${tipo}${vagaId ? ` #${vagaId}` : ''}: ${texto}`);
}

export function criarPendencia({ vagaId = null, emailId = null, pergunta, contexto = '' }) {
  const r = db.prepare('INSERT INTO pendencias (vaga_id, email_id, pergunta, contexto) VALUES (?,?,?,?)')
    .run(vagaId, emailId, pergunta, contexto);
  return Number(r.lastInsertRowid);
}

export function respostasAprendidas() {
  return db.prepare('SELECT pergunta, resposta FROM respostas_aprendidas ORDER BY criada_em').all();
}

export function lerEstado(chave, padrao = null) {
  const r = db.prepare('SELECT valor FROM estado WHERE chave = ?').get(chave);
  return r ? JSON.parse(r.valor) : padrao;
}

export function gravarEstado(chave, valor) {
  db.prepare('INSERT INTO estado (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor')
    .run(chave, JSON.stringify(valor));
}

export function candidaturasHoje() {
  return db.prepare("SELECT COUNT(*) n FROM vagas WHERE date(candidatada_em) = date('now','localtime')").get().n;
}

export function avaliadasHoje() {
  return db.prepare("SELECT COUNT(*) n FROM eventos WHERE tipo = 'avaliacao' AND date(quando) = date('now','localtime')").get().n;
}

export function agora() {
  return db.prepare("SELECT datetime('now','localtime') t").get().t;
}
