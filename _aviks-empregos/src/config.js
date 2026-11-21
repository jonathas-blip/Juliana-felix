// Lê a configuração: .env (chaves e senhas) + config/*.json e *.md (perfil, currículo, estilo de escrita).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(RAIZ, '.env'), quiet: true });

export const DIR_CONFIG = path.join(RAIZ, 'config');
export const DIR_DADOS = process.env.DATA_DIR || path.join(RAIZ, 'dados');
fs.mkdirSync(DIR_DADOS, { recursive: true });

export const ARQ_SESSAO = path.join(DIR_DADOS, 'sessao-navegador.json');
export const DIR_PRINTS = path.join(DIR_DADOS, 'prints');
fs.mkdirSync(DIR_PRINTS, { recursive: true });

function lerJson(nome, padrao) {
  const arq = path.join(DIR_CONFIG, nome);
  if (!fs.existsSync(arq)) {
    if (padrao !== undefined) return padrao;
    throw new Error(`Falta config/${nome}. Copie config/${nome.replace('.json', '.exemplo.json')} e preencha.`);
  }
  return JSON.parse(fs.readFileSync(arq, 'utf8'));
}

function lerTexto(nome) {
  const arq = path.join(DIR_CONFIG, nome);
  return fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8').trim() : '';
}

// Lido a cada execução (não fica em cache) para que mudanças no perfil valham sem reiniciar.
export function carregarPerfil() {
  const perfil = fs.existsSync(path.join(DIR_CONFIG, 'perfil.json')) || !process.env.AVIKS_DEMO
    ? lerJson('perfil.json')
    : lerJson('perfil.exemplo.json');
  const padroes = {
    nota_minima: 80,
    max_candidaturas_por_dia: 15,
    max_vagas_avaliadas_por_dia: 120,
    horario_busca: '0 8 * * *',
    intervalo_emails_min: 30,
    responder_emails_sozinho: true,
    avisar_sobre: ['entrevista', 'teste', 'prazo', 'oferta', 'precisa_de_voce'],
    buscas_em_paginas: [],
    empresas_desejadas: [],
    excluir_empresas: [],
    excluir_palavras: [],
    respostas_prontas: {},
  };
  return { ...padroes, ...perfil };
}

export function carregarTextos() {
  return {
    curriculo: lerTexto('curriculo.md'),
    estilo: lerTexto('estilo.md'),
  };
}

export function arquivoCurriculoPdf() {
  const arq = path.join(DIR_CONFIG, 'curriculo.pdf');
  return fs.existsSync(arq) ? arq : null;
}

export function contasEmail() {
  return lerJson('emails.json', []);
}

export const ENV = {
  modelo: process.env.MODELO_CLAUDE || 'claude-opus-5-5',
  porta: Number(process.env.PORT) || 3900,
  ntfyTopico: process.env.NTFY_TOPICO || '',
  ntfyServidor: process.env.NTFY_SERVIDOR || 'https://ntfy.sh',
  urlPainel: process.env.URL_PAINEL || '',
  headless: process.env.NAVEGADOR_VISIVEL !== '1',
  fusoHorario: process.env.FUSO || 'America/Sao_Paulo',
};
