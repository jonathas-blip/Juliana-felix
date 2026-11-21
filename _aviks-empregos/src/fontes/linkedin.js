// LinkedIn: endpoints públicos de vagas (os mesmos da página de vagas sem login). A candidatura usa a sua sessão logada.
import * as cheerio from 'cheerio';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BUSCA = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const VAGA = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/';

// f_TPR=r86400 → publicadas nas últimas 24 h. f_WT: 1 presencial, 2 remoto, 3 híbrido.
export async function buscarLinkedin(termo, local, { modelos = [], paginas = 2 } = {}) {
  const wt = { presencial: '1', remoto: '2', hibrido: '3', 'híbrido': '3' };
  const fWT = modelos.map((m) => wt[m.toLowerCase()]).filter(Boolean).join(',');
  const vagas = [];
  for (let i = 0; i < paginas; i++) {
    const q = new URLSearchParams({ keywords: termo, location: local || 'Brasil', f_TPR: 'r86400', start: String(i * 25) });
    if (fWT) q.set('f_WT', fWT);
    const r = await fetch(`${BUSCA}?${q}`, { headers: { 'user-agent': UA, 'accept-language': 'pt-BR' } });
    if (r.status === 429) break; // limite de acessos: tenta de novo na próxima execução
    if (!r.ok) throw new Error(`LinkedIn respondeu ${r.status}`);
    const $ = cheerio.load(await r.text());
    const cards = $('li');
    if (!cards.length) break;
    cards.each((_, li) => {
      const el = $(li);
      const href = el.find('a.base-card__full-link, a[href*="/jobs/view/"]').first().attr('href') || '';
      const id = (href.match(/-(\d{6,})\?|\/(\d{6,})\/?/) || []).slice(1).find(Boolean)
        || (el.find('[data-entity-urn]').attr('data-entity-urn') || '').split(':').pop();
      if (!id) return;
      vagas.push({
        fonte: 'LinkedIn',
        id_externo: id,
        url: `https://www.linkedin.com/jobs/view/${id}/`,
        titulo: el.find('.base-search-card__title').text().trim(),
        empresa: el.find('.base-search-card__subtitle').text().trim(),
        local: el.find('.job-search-card__location').text().trim(),
        publicada_em: el.find('time').attr('datetime') || '',
      });
    });
    await new Promise((res) => setTimeout(res, 1500 + Math.random() * 1500));
  }
  return vagas;
}

export async function descricaoLinkedin(vaga) {
  const r = await fetch(VAGA + vaga.id_externo, { headers: { 'user-agent': UA, 'accept-language': 'pt-BR' } });
  if (!r.ok) return vaga;
  const $ = cheerio.load(await r.text());
  vaga.descricao = $('.show-more-less-html__markup').text().replace(/\s+/g, ' ').trim();
  const criterios = $('.description__job-criteria-item').map((_, e) => $(e).text().replace(/\s+/g, ' ').trim()).get();
  if (criterios.length) vaga.descricao += `\n\nCritérios: ${criterios.join(' | ')}`;
  return vaga;
}
