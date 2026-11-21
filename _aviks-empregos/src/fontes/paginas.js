// Qualquer página de busca ou de carreiras (Catho, Vagas.com, Indeed, site de carreiras das empresas que você quer).
// O navegador abre a página com a sua sessão, e o Claude identifica as vagas no texto. Funciona mesmo se o site mudar o layout.
import { extrairVagasDaPagina } from '../ia.js';
import { lerPagina, pausa } from '../navegador.js';

function nomeFonte(url) {
  const h = new URL(url).hostname.replace(/^www\./, '');
  if (h.includes('catho')) return 'Catho';
  if (h.includes('vagas.com')) return 'Vagas.com';
  if (h.includes('indeed')) return 'Indeed';
  if (h.includes('gupy')) return 'Gupy';
  if (h.includes('linkedin')) return 'LinkedIn';
  return h;
}

export async function buscarEmPagina(contexto, url, empresa = '') {
  const p = await contexto.newPage();
  try {
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await pausa(2500, 4000);
    await p.mouse.wheel(0, 4000).catch(() => {});
    await pausa(1000, 2000);
    const { texto, links } = await lerPagina(p);
    const vagas = await extrairVagasDaPagina(url, texto, links, empresa);
    return vagas
      .filter((v) => /^https?:\/\//.test(v.url))
      .map((v) => ({ ...v, empresa: v.empresa || empresa, fonte: empresa ? `Carreiras ${empresa}` : nomeFonte(url) }));
  } finally {
    await p.close();
  }
}

export async function descricaoPorPagina(contexto, vaga) {
  const p = await contexto.newPage();
  try {
    await p.goto(vaga.url, { waitUntil: 'domcontentloaded' });
    await pausa(1500, 3000);
    const texto = await p.locator('main').innerText({ timeout: 5000 }).catch(() => p.locator('body').innerText());
    vaga.descricao = texto.replace(/\n{3,}/g, '\n\n').slice(0, 20000);
  } finally {
    await p.close();
  }
  return vaga;
}
