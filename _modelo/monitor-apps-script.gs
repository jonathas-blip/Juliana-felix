/**
 * Monitoramento do site — recebe visitas e cliques no WhatsApp e entrega os
 * dados para o painel (painel/index.html).
 *
 * Como instalar (uma vez por cliente):
 *  1. Crie uma Planilha Google (ex.: "Monitoramento - Juliana Felix").
 *  2. Extensões → Apps Script → apague o conteúdo e cole este arquivo inteiro.
 *  3. Troque o valor de SENHA_PAINEL abaixo por uma senha só sua.
 *  4. Implantar → Nova implantação → tipo "App da Web":
 *       Executar como: Eu  |  Quem pode acessar: Qualquer pessoa
 *     Autorize o acesso quando o Google pedir.
 *  5. Copie a URL que termina em /exec e coloque em
 *     _modelo/cliente.json → "monitoramento": { "endpoint": "<URL>" }
 *     e gere o site de novo (build.ps1).
 *
 * Nenhum dado pessoal é guardado: só data/hora, tipo do evento, qual botão,
 * origem da visita (ex.: google_ads), tipo de aparelho e página.
 */

const SENHA_PAINEL = 'TROQUE-ESTA-SENHA';
// ID da planilha (trecho entre /d/ e /edit no endereço). Vazio = planilha onde o script foi criado.
const PLANILHA_ID = '';
const ABA = 'eventos';
const TIPOS = { visita: true, clique_whatsapp: true };

function aba_() {
  const planilha = PLANILHA_ID ? SpreadsheetApp.openById(PLANILHA_ID) : SpreadsheetApp.getActive();
  let aba = planilha.getSheetByName(ABA);
  if (!aba) {
    aba = planilha.insertSheet(ABA);
    aba.appendRow(['data', 'tipo', 'local', 'origem', 'dispositivo', 'pagina', 'sessao']);
    aba.setFrozenRows(1);
  }
  return aba;
}

function corta_(valor, max) {
  return String(valor == null ? '' : valor).slice(0, max);
}

// Recebe os eventos enviados pelo site (navigator.sendBeacon)
function doPost(e) {
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!TIPOS[d.t]) return json_({ ok: false });
    const lock = LockService.getScriptLock();
    lock.waitLock(5000);
    try {
      aba_().appendRow([new Date(), d.t, corta_(d.l, 80), corta_(d.o, 40), corta_(d.d, 12), corta_(d.p, 80), corta_(d.s, 16)]);
    } finally {
      lock.releaseLock();
    }
    return json_({ ok: true });
  } catch (erro) {
    return json_({ ok: false });
  }
}

// Entrega os eventos para o painel (exige a senha)
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (String(p.senha || '') !== SENHA_PAINEL) return json_({ erro: 'senha' });
  const dias = Math.min(Math.max(Number(p.dias) || 90, 1), 400);
  const desde = Date.now() - dias * 86400000;
  const linhas = aba_().getDataRange().getValues().slice(1);
  const eventos = [];
  for (const r of linhas) {
    if (r[0] instanceof Date && r[0].getTime() >= desde) {
      eventos.push([r[0].getTime(), r[1], r[2], r[3], r[4], r[5], r[6]]);
    }
  }
  return json_({ gerado: Date.now(), eventos: eventos });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
