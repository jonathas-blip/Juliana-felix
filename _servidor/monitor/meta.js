// Dados da Meta para o painel: anúncios (Facebook/Instagram) e o perfil do Instagram, pela Graph API.
// O token de acesso fica só no servidor (DATA_DIR/meta.json, ou META_TOKEN no .env) e nunca vai para o navegador.
// Cada parte é buscada separadamente: se uma falhar (ex.: falta permissão), as outras aparecem normalmente.

const fs = require('fs');
const path = require('path');

const VERSAO = process.env.META_API_VERSAO || 'v23.0';
const CONVERSA = 'onsite_conversion.messaging_conversation_started_7d';
const CACHE_MS = 15 * 60 * 1000;

module.exports = (DATA_DIR) => {
  const ARQ = path.join(DATA_DIR, 'meta.json');
  const cache = new Map();

  const lerConfig = () => { try { return JSON.parse(fs.readFileSync(ARQ, 'utf8')); } catch (err) { return {}; } };
  const config = () => {
    const c = lerConfig();
    return { token: process.env.META_TOKEN || c.token || '', conta: process.env.META_CONTA || c.conta || '', ig: process.env.META_IG || c.ig || '' };
  };

  // Token no cabeçalho (não na URL, para não aparecer em logs)
  async function graph(caminho, params, token) {
    const u = new URL('https://graph.facebook.com/' + VERSAO + '/' + caminho);
    for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    const r = await fetch(u, { headers: { Authorization: 'Bearer ' + (token || config().token) }, signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || 'Erro da Meta');
    return j;
  }

  const tenta = async (fn) => { try { return await fn(); } catch (err) { return { erro: String(err.message || err).slice(0, 200) }; } };

  // Datas no fuso de São Paulo (o da conta de anúncios)
  const diaSP = (t) => new Date(t - 3 * 3600000).toISOString().slice(0, 10);
  const num = (v) => Number(v) || 0;
  const conversas = (linha) => num(((linha.actions || []).find((a) => a.action_type === CONVERSA) || {}).value);
  const resumo = (l) => ({ gasto: num(l.spend), conversas: conversas(l), impressoes: num(l.impressions), alcance: num(l.reach), cliques: num(l.clicks), frequencia: num(l.frequency) });

  // Descobre a conta de anúncios e o Instagram que o token enxerga e guarda tudo no servidor
  async function configurar(token) {
    // Só conta de anúncios que já gastou algo: a conta pessoal vazia não deve aparecer como "R$ 0" no painel
    const contas = await graph('me/adaccounts', { fields: 'id,name,account_status,amount_spent', limit: 50 }, token);
    const conta = process.env.META_CONTA ? { id: process.env.META_CONTA, name: '' }
      : (contas.data || []).filter((c) => num(c.amount_spent) > 0).sort((a, b) => num(b.amount_spent) - num(a.amount_spent))[0];
    let ig = null;
    const paginas = await tenta(() => graph('me/accounts', { fields: 'name,instagram_business_account{id,username}', limit: 50 }, token));
    for (const p of paginas.data || []) if (p.instagram_business_account) { ig = p.instagram_business_account; break; }
    if (!conta && !ig) throw new Error('O token não tem acesso a nenhuma conta de anúncios nem a um Instagram.');
    const salvo = { token, conta: conta ? conta.id : '', contaNome: conta ? conta.name : '', ig: ig ? ig.id : '', igUsuario: ig ? ig.username : '', em: Date.now() };
    fs.writeFileSync(ARQ, JSON.stringify(salvo), { mode: 0o600 });
    cache.clear();
    return { contaNome: salvo.contaNome, igUsuario: salvo.igUsuario };
  }

  function desconectar() { try { fs.unlinkSync(ARQ); } catch (err) { /* já não existia */ } cache.clear(); }

  async function anuncios(conta, dias) {
    const hoje = Date.now();
    const periodo = { since: diaSP(hoje - (dias - 1) * 86400000), until: diaSP(hoje) };
    const anterior = { since: diaSP(hoje - (2 * dias - 1) * 86400000), until: diaSP(hoje - dias * 86400000) };
    const ins = (extra) => graph(conta + '/insights', Object.assign({ time_range: periodo, limit: 500 }, extra));
    const campos = 'spend,impressions,reach,clicks,frequency,actions';

    const [diario, total, ant, porAnuncio, idadeSexo, regiao, campanhas] = await Promise.all([
      tenta(async () => (await ins({ fields: 'spend,impressions,clicks,actions', time_increment: 1 })).data.map((l) => Object.assign({ d: l.date_start }, resumo(l)))),
      tenta(async () => resumo((await ins({ fields: campos })).data[0] || {})),
      tenta(async () => resumo((await graph(conta + '/insights', { fields: campos, time_range: anterior })).data[0] || {})),
      tenta(async () => (await ins({ fields: 'ad_id,ad_name,campaign_name,spend,impressions,clicks,actions', level: 'ad' })).data
        .map((l) => Object.assign({ nome: l.ad_name, campanha: l.campaign_name }, resumo(l)))),
      tenta(async () => (await ins({ fields: 'spend,impressions,actions', breakdowns: 'age,gender' })).data
        .map((l) => Object.assign({ idade: l.age, sexo: l.gender }, resumo(l)))),
      tenta(async () => (await ins({ fields: 'spend,impressions,actions', breakdowns: 'region' })).data
        .map((l) => Object.assign({ regiao: String(l.region || '').replace(/ \((state|estado)\)$/i, '') }, resumo(l)))),
      tenta(async () => (await graph(conta + '/campaigns', { fields: 'name,effective_status,daily_budget,lifetime_budget,objective', limit: 50 })).data
        .map((c) => ({ nome: c.name, status: c.effective_status, orcamentoDia: num(c.daily_budget) / 100, objetivo: c.objective })))
    ]);
    return { diario, total, anterior: ant, porAnuncio, idadeSexo, regiao, campanhas };
  }

  async function instagram(ig, dias) {
    const hoje = Date.now();
    const desde = hoje - dias * 86400000;
    // A Meta aceita no máximo 30 dias por consulta de métricas da conta: busca em pedaços
    const pedacos = [];
    for (let fim = hoje; fim > desde; fim -= 30 * 86400000) pedacos.push([Math.max(desde, fim - 30 * 86400000), fim]);
    const seg = (t) => Math.floor(t / 1000);

    const [perfil, diario, totais, posts] = await Promise.all([
      tenta(async () => { const p = await graph(ig, { fields: 'username,followers_count,media_count' }); return { usuario: p.username, seguidores: num(p.followers_count), posts: num(p.media_count) }; }),
      tenta(async () => {
        const porDia = {};
        for (const [a, b] of pedacos) {
          const r = await graph(ig + '/insights', { metric: 'reach', period: 'day', since: seg(a), until: seg(b) });
          for (const v of ((r.data || [])[0] || {}).values || []) porDia[v.end_time.slice(0, 10)] = num(v.value);
        }
        return Object.entries(porDia).sort().map(([d, alcance]) => ({ d, alcance }));
      }),
      tenta(async () => {
        const soma = {};
        for (const [a, b] of pedacos) {
          const r = await graph(ig + '/insights', { metric: 'profile_views,website_clicks,accounts_engaged,total_interactions', metric_type: 'total_value', period: 'day', since: seg(a), until: seg(b) });
          for (const m of r.data || []) soma[m.name] = (soma[m.name] || 0) + num((m.total_value || {}).value);
        }
        return soma;
      }),
      tenta(async () => {
        const r = await graph(ig + '/media', { fields: 'id,caption,media_type,media_product_type,timestamp,like_count,comments_count,permalink,thumbnail_url,media_url', limit: 50 });
        const lista = (r.data || []).filter((m) => new Date(m.timestamp).getTime() >= desde).slice(0, 30);
        return Promise.all(lista.map(async (m) => {
          const met = {};
          const ins = await tenta(() => graph(m.id + '/insights', { metric: 'reach,saved,shares,views,total_interactions' }));
          const ins2 = ins.erro ? await tenta(() => graph(m.id + '/insights', { metric: 'reach,saved,shares' })) : ins;
          for (const x of ins2.data || []) met[x.name] = num(((x.values || [])[0] || {}).value);
          return {
            legenda: String(m.caption || '').slice(0, 140), tipo: m.media_product_type === 'REELS' ? 'Reel' : m.media_type === 'CAROUSEL_ALBUM' ? 'Carrossel' : m.media_type === 'VIDEO' ? 'Vídeo' : 'Foto',
            data: m.timestamp, link: m.permalink, imagem: m.thumbnail_url || m.media_url || '',
            curtidas: num(m.like_count), comentarios: num(m.comments_count), alcance: met.reach || 0, salvos: met.saved || 0, compart: met.shares || 0, views: met.views || 0
          };
        }));
      })
    ]);
    return { perfil, diario, totais, posts };
  }

  async function dados(dias) {
    const c = config();
    if (!c.token) return { configurado: false };
    const chave = dias + '|' + c.conta + '|' + c.ig;
    const guardado = cache.get(chave);
    if (guardado && Date.now() - guardado.em < CACHE_MS) return guardado.dados;
    const [ads, ig] = await Promise.all([c.conta ? anuncios(c.conta, dias) : null, c.ig ? instagram(c.ig, dias) : null]);
    const out = { configurado: true, contaNome: lerConfig().contaNome || '', anuncios: ads, instagram: ig, gerado: Date.now() };
    cache.set(chave, { em: Date.now(), dados: out });
    return out;
  }

  return { dados, configurar, desconectar };
};
