// Etapa 4: lê as caixas de e-mail, atualiza o andamento das candidaturas, responde o que dá e avisa no celular.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { carregarPerfil, contasEmail } from './config.js';
import { db, atualizarVaga, registrar, criarPendencia, lerEstado, gravarEstado } from './db.js';
import { lerEmail } from './ia.js';
import { avisar } from './avisos.js';

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const PISTAS = /vaga|processo seletivo|candidat|entrevista|recrutador|recrutamento|selec|gupy|catho|vagas\.com|indeed|linkedin|teste|desafio|case|oportunidade|talent|hiring|interview|aplica|proposta|feedback|\brh\b|people/;

const ABERTOS = "('candidatada','em_processo','teste','entrevista','oferta','precisa_de_voce')";

function acharVaga(empresa, cargo) {
  const abertas = db.prepare(`SELECT id, empresa, titulo, status FROM vagas WHERE status IN ${ABERTOS}`).all();
  const e = norm(empresa);
  if (!e) return null;
  const candidatas = abertas.filter((v) => norm(v.empresa).includes(e) || e.includes(norm(v.empresa)));
  if (candidatas.length <= 1) return candidatas[0] || null;
  const c = norm(cargo);
  return candidatas.find((v) => c && (norm(v.titulo).includes(c) || c.includes(norm(v.titulo)))) || candidatas[0];
}

async function responder(conta, original, texto) {
  const smtp = nodemailer.createTransport({
    host: conta.smtp_host, port: conta.smtp_porta || 465, secure: (conta.smtp_porta || 465) === 465,
    auth: { user: conta.usuario, pass: conta.senha_app },
  });
  const assunto = /^re:/i.test(original.subject || '') ? original.subject : `Re: ${original.subject || ''}`;
  await smtp.sendMail({
    from: conta.usuario,
    to: original.replyTo?.text || original.from?.text,
    subject: assunto,
    text: texto,
    inReplyTo: original.messageId,
    references: [...(original.references ? [].concat(original.references) : []), original.messageId].filter(Boolean),
  });
}

const NOVO_STATUS = { entrevista: 'entrevista', teste: 'teste', oferta: 'oferta', reprovacao: 'reprovada', em_analise: 'em_processo', confirmacao_candidatura: 'em_processo' };

async function processarConta(conta) {
  const perfil = carregarPerfil();
  const chave = `imap:${conta.usuario}`;
  const ultimo = lerEstado(chave, 0);
  const cliente = new ImapFlow({
    host: conta.imap_host, port: conta.imap_porta || 993, secure: true,
    auth: { user: conta.usuario, pass: conta.senha_app }, logger: false,
  });
  await cliente.connect();
  const trava = await cliente.getMailboxLock('INBOX');
  let maior = ultimo;
  try {
    // Primeira vez: só os últimos 3 dias. Depois: tudo que chegou desde a última leitura.
    const criterio = ultimo ? { uid: `${ultimo + 1}:*` } : { since: new Date(Date.now() - 3 * 864e5) };
    const uids = (await cliente.search(criterio, { uid: true })) || [];
    for (const uid of uids) {
      if (uid <= ultimo) continue;
      maior = Math.max(maior, uid);
      if (db.prepare('SELECT 1 FROM emails WHERE conta = ? AND uid = ?').get(conta.usuario, uid)) continue;
      const msg = await cliente.fetchOne(String(uid), { source: true }, { uid: true });
      const m = await simpleParser(msg.source);
      const texto = m.text || (m.html || '').replace(/<[^>]+>/g, ' ');
      const email = { de: m.from?.text || '', assunto: m.subject || '', data: m.date?.toISOString() || '', texto };
      if (!PISTAS.test(norm(`${email.de} ${email.assunto} ${texto.slice(0, 3000)}`))) continue;

      const abertas = db.prepare(`SELECT id, empresa, titulo FROM vagas WHERE status IN ${ABERTOS}`).all();
      let l;
      try { l = await lerEmail(email, abertas); } catch (e) { registrar('erro', `Leitura de e-mail: ${e.message}`); continue; }
      if (l.tipo === 'irrelevante') {
        if (l.resumo.startsWith('POSSÍVEL GOLPE')) await avisar('Possível golpe na caixa de e-mail', `${email.assunto}\n${l.resumo}`, 'precisa_de_voce');
        continue;
      }

      const vaga = acharVaga(l.empresa, l.cargo);
      const r = db.prepare(`INSERT INTO emails (conta, uid, message_id, de, assunto, recebido_em, tipo, resumo, data_evento, link, vaga_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(conta.usuario, uid, m.messageId || '', email.de, email.assunto, email.data,
        l.tipo, l.resumo, l.data_evento, l.link, vaga?.id ?? null);
      const emailId = Number(r.lastInsertRowid);
      registrar('email', `${l.tipo}: ${l.resumo}`, vaga?.id);

      if (vaga) {
        const etapa = [l.resumo, l.data_evento && `(${l.data_evento})`].filter(Boolean).join(' ');
        const campos = { etapa };
        if (NOVO_STATUS[l.tipo] && !(l.tipo === 'em_analise' && vaga.status !== 'candidatada')) campos.status = NOVO_STATUS[l.tipo];
        atualizarVaga(vaga.id, campos);
      }

      const titulo = `${l.empresa || 'Recrutador'}${l.cargo ? ` — ${l.cargo}` : ''}`;
      if (l.tipo === 'entrevista') await avisar(`Entrevista: ${titulo}`, `${l.resumo}\n${l.data_evento}\n${l.link}`.trim(), 'entrevista', l.link);
      if (l.tipo === 'teste') await avisar(`Teste: ${titulo}`, `${l.resumo}\nPrazo: ${l.data_evento || '?'}\n${l.link}`.trim(), 'teste', l.link);
      if (l.tipo === 'prazo') await avisar(`Prazo: ${titulo}`, `${l.resumo}\n${l.data_evento}`, 'prazo', l.link);
      if (l.tipo === 'oferta') await avisar(`Proposta: ${titulo}`, l.resumo, 'oferta');

      if (l.resposta && l.pode_responder_sozinho && perfil.responder_emails_sozinho && conta.smtp_host) {
        try {
          await responder(conta, m, l.resposta);
          db.prepare('UPDATE emails SET respondido = 1, resposta = ? WHERE id = ?').run(l.resposta, emailId);
          registrar('email', `Respondido automaticamente: ${email.assunto}`, vaga?.id);
        } catch (e) {
          registrar('erro', `Falha ao responder e-mail: ${e.message}`, vaga?.id);
        }
      } else if (l.motivo_para_perguntar || l.tipo === 'pergunta_recrutador') {
        criarPendencia({ vagaId: vaga?.id, emailId, pergunta: l.motivo_para_perguntar || `Responder: ${email.assunto}`,
          contexto: `${email.de}\n${email.assunto}\n\n${texto.slice(0, 1500)}\n\n--- Rascunho sugerido ---\n${l.resposta}` });
        await avisar(`Recrutador perguntou: ${titulo}`, l.motivo_para_perguntar || l.resumo, 'precisa_de_voce');
      }
    }
  } finally {
    trava.release();
    await cliente.logout().catch(() => {});
    gravarEstado(chave, maior);
  }
}

export async function verificarEmails() {
  for (const conta of contasEmail()) {
    try {
      await processarConta(conta);
    } catch (e) {
      registrar('erro', `E-mail ${conta.usuario}: ${e.message}`);
    }
  }
}

// Usada pelo painel quando você responde uma pendência que veio de e-mail.
export async function enviarRespostaPendencia(emailId, texto) {
  const e = db.prepare('SELECT * FROM emails WHERE id = ?').get(emailId);
  if (!e) throw new Error('E-mail não encontrado');
  const conta = contasEmail().find((c) => c.usuario === e.conta);
  if (!conta?.smtp_host) throw new Error('Conta sem SMTP configurado');
  const cliente = new ImapFlow({ host: conta.imap_host, port: conta.imap_porta || 993, secure: true,
    auth: { user: conta.usuario, pass: conta.senha_app }, logger: false });
  await cliente.connect();
  const trava = await cliente.getMailboxLock('INBOX');
  try {
    const msg = await cliente.fetchOne(String(e.uid), { source: true }, { uid: true });
    await responder(conta, await simpleParser(msg.source), texto);
  } finally {
    trava.release();
    await cliente.logout().catch(() => {});
  }
  db.prepare('UPDATE emails SET respondido = 1, resposta = ? WHERE id = ?').run(texto, emailId);
}
