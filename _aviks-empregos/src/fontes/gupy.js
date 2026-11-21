// Gupy: API pública do portal de vagas (a mesma que o site portal.gupy.io usa). Não precisa de login.
const API = 'https://portal.api.gupy.io/api/v1/jobs';

const limparHtml = (s) => (s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export async function buscarGupy(termo, { limite = 50 } = {}) {
  const url = `${API}?jobName=${encodeURIComponent(termo)}&limit=${limite}&offset=0`;
  const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`Gupy respondeu ${r.status}`);
  const { data = [] } = await r.json();
  return data.map((j) => ({
    fonte: 'Gupy',
    url: j.jobUrl,
    titulo: j.name,
    empresa: j.careerPageName,
    local: [j.city, j.state].filter(Boolean).join(' - ') || (j.isRemoteWork ? 'Remoto' : ''),
    modelo: j.workplaceType || (j.isRemoteWork ? 'remote' : ''),
    publicada_em: j.publishedDate || '',
    descricao: limparHtml(j.description),
  }));
}

// Sites de carreira feitos na Gupy (empresa.gupy.io) têm a mesma estrutura: a descrição completa fica na página da vaga.
export async function completarDescricaoGupy(contexto, vaga) {
  if (vaga.descricao && vaga.descricao.length > 600) return vaga;
  const p = await contexto.newPage();
  try {
    await p.goto(vaga.url, { waitUntil: 'domcontentloaded' });
    vaga.descricao = (await p.locator('main').innerText().catch(() => p.locator('body').innerText())).slice(0, 20000);
  } finally {
    await p.close();
  }
  return vaga;
}
