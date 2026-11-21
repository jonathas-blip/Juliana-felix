// Navegador (Chromium via Playwright) com a sua sessão já logada nos sites de vagas.
// A sessão (cookies) é criada por `npm run login`, onde VOCÊ digita as senhas. O agente nunca digita senha.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { ARQ_SESSAO, ENV } from './config.js';

let navegador = null;

export async function abrirContexto() {
  if (!navegador) {
    navegador = await chromium.launch({
      headless: ENV.headless,
      args: ['--disable-blink-features=AutomationControlled'],
    });
  }
  const contexto = await navegador.newContext({
    storageState: fs.existsSync(ARQ_SESSAO) ? ARQ_SESSAO : undefined,
    locale: 'pt-BR',
    timezoneId: ENV.fusoHorario,
    viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  contexto.setDefaultTimeout(20000);
  return contexto;
}

// Guarda cookies renovados (os sites trocam tokens com o uso) para a próxima execução continuar logada.
export async function salvarSessao(contexto) {
  try { await contexto.storageState({ path: ARQ_SESSAO }); } catch { /* contexto já fechado */ }
}

export async function fecharNavegador() {
  if (navegador) await navegador.close().catch(() => {});
  navegador = null;
}

export const pausa = (minMs, maxMs = minMs) => new Promise((r) => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));

// Texto visível + links de uma página, para o Claude ler.
export async function lerPagina(pagina) {
  return pagina.evaluate(() => {
    const texto = document.body ? document.body.innerText : '';
    const links = [...document.querySelectorAll('a[href]')]
      .map((a) => `${(a.innerText || a.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 120)} -> ${a.href}`)
      .filter((l) => !l.startsWith(' ->'));
    return { texto, links: [...new Set(links)] };
  });
}
