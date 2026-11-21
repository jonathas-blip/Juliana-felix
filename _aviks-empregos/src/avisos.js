// Avisos no celular via ntfy (app gratuito para Android/iPhone, sem cadastro).
// No app, assine o mesmo tópico que está em NTFY_TOPICO no .env (use um nome difícil de adivinhar).
import { ENV, carregarPerfil } from './config.js';
import { registrar } from './db.js';

const PRIORIDADE = { entrevista: 'urgent', oferta: 'urgent', teste: 'high', prazo: 'high', precisa_de_voce: 'high' };
const ETIQUETA = { entrevista: 'calendar', oferta: 'tada', teste: 'pencil', prazo: 'hourglass', precisa_de_voce: 'raising_hand' };

export async function avisar(titulo, mensagem, tipo = 'info', link = '') {
  const perfil = carregarPerfil();
  registrar('aviso', `${titulo} — ${mensagem.split('\n')[0]}`);
  if (!perfil.avisar_sobre.includes(tipo) || !ENV.ntfyTopico) return;
  try {
    const cabecalhos = {
      Title: encodeURIComponent(titulo),
      Priority: PRIORIDADE[tipo] || 'default',
      Tags: ETIQUETA[tipo] || 'briefcase',
      'X-Title-Encoding': 'url',
    };
    const clique = link || ENV.urlPainel;
    if (clique) cabecalhos.Click = clique;
    await fetch(`${ENV.ntfyServidor}/${encodeURIComponent(ENV.ntfyTopico)}`, {
      method: 'POST',
      headers: cabecalhos,
      body: mensagem,
    });
  } catch (e) {
    console.error('Falha ao enviar aviso:', e.message);
  }
}
