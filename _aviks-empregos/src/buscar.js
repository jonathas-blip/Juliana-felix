// Etapa 1 e 2: encontra vagas novas em todas as fontes e dá a nota de compatibilidade de cada uma.
import { carregarPerfil } from './config.js';
import { db, inserirVaga, atualizarVaga, registrar, avaliadasHoje } from './db.js';
import { avaliarVaga } from './ia.js';
import { buscarGupy, completarDescricaoGupy } from './fontes/gupy.js';
import { buscarLinkedin, descricaoLinkedin } from './fontes/linkedin.js';
import { buscarEmPagina, descricaoPorPagina } from './fontes/paginas.js';

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

async function tentar(nome, fn) {
  try {
    return await fn();
  } catch (e) {
    registrar('erro', `${nome}: ${e.message}`);
    return [];
  }
}

export async function buscarVagas(contexto) {
  const perfil = carregarPerfil();
  const termos = perfil.cargos_alvo || [];
  const locais = perfil.localizacoes?.length ? perfil.localizacoes : ['Brasil'];
  const achadas = [];

  for (const termo of termos) {
    achadas.push(...await tentar(`Gupy "${termo}"`, () => buscarGupy(termo)));
    for (const local of locais) {
      achadas.push(...await tentar(`LinkedIn "${termo}" ${local}`, () => buscarLinkedin(termo, local, { modelos: perfil.modelos_trabalho || [] })));
    }
  }
  for (const url of perfil.buscas_em_paginas) {
    achadas.push(...await tentar(url, () => buscarEmPagina(contexto, url)));
  }
  for (const emp of perfil.empresas_desejadas) {
    if (emp.url_carreiras) achadas.push(...await tentar(`Carreiras ${emp.nome}`, () => buscarEmPagina(contexto, emp.url_carreiras, emp.nome)));
  }

  let novas = 0;
  for (const v of achadas) {
    if (!v.url) continue;
    const id = inserirVaga(v);
    if (id) {
      novas++;
      if (v.id_externo) db.prepare('INSERT INTO eventos (vaga_id, tipo, texto) VALUES (?,?,?)').run(id, 'id_externo', v.id_externo);
    }
  }
  registrar('busca', `${achadas.length} vagas vistas, ${novas} novas`);
  return novas;
}

function bloqueioRapido(vaga, perfil) {
  const emp = norm(vaga.empresa);
  if (perfil.excluir_empresas.some((e) => emp.includes(norm(e)))) return 'Empresa na lista de exclusão';
  const texto = norm(`${vaga.titulo} ${vaga.descricao}`);
  const palavra = perfil.excluir_palavras.find((p) => texto.includes(norm(p)));
  if (palavra) return `Contém palavra excluída: "${palavra}"`;
  return null;
}

async function completarDescricao(contexto, vaga) {
  if (vaga.descricao && vaga.descricao.length > 600) return vaga;
  if (vaga.fonte === 'LinkedIn') {
    const ext = db.prepare("SELECT texto FROM eventos WHERE vaga_id = ? AND tipo = 'id_externo'").get(vaga.id);
    return descricaoLinkedin({ ...vaga, id_externo: ext?.texto || vaga.url.match(/(\d{6,})/)?.[1] });
  }
  if (vaga.url.includes('gupy.io')) return completarDescricaoGupy(contexto, vaga);
  return descricaoPorPagina(contexto, vaga);
}

export async function avaliarNovas(contexto) {
  const perfil = carregarPerfil();
  const restante = Math.max(0, perfil.max_vagas_avaliadas_por_dia - avaliadasHoje());
  const fila = db.prepare("SELECT * FROM vagas WHERE status = 'nova' ORDER BY encontrada_em DESC LIMIT ?").all(restante);
  let aprovadas = 0;

  for (const vaga of fila) {
    try {
      const rapido = bloqueioRapido(vaga, perfil);
      if (rapido) {
        atualizarVaga(vaga.id, { status: 'descartada', nota: 0, motivo: rapido });
        continue;
      }
      const v = await completarDescricao(contexto, vaga);
      if (!v.descricao || v.descricao.length < 150) {
        atualizarVaga(vaga.id, { status: 'descartada', motivo: 'Não foi possível ler a descrição da vaga' });
        continue;
      }
      const a = await avaliarVaga(v);
      a.nota = Math.round(a.nota);
      const aprovar = a.decisao === 'candidatar' && a.nota >= perfil.nota_minima && !a.bloqueio;
      atualizarVaga(vaga.id, {
        descricao: v.descricao,
        nota: a.nota,
        motivo: a.bloqueio ? `${a.bloqueio}. ${a.motivo}` : a.motivo,
        pontos_fortes: a.pontos_fortes.join(' • '),
        lacunas: a.lacunas.join(' • '),
        modelo: a.modelo_trabalho,
        salario: a.salario_informado || vaga.salario,
        status: aprovar ? 'aprovada' : 'descartada',
      });
      registrar('avaliacao', `${a.nota} — ${vaga.titulo} (${vaga.empresa}) → ${aprovar ? 'candidatar' : 'descartada'}`, vaga.id);
      if (aprovar) aprovadas++;
    } catch (e) {
      registrar('erro', `Avaliação falhou: ${e.message}`, vaga.id);
    }
  }
  return aprovadas;
}
