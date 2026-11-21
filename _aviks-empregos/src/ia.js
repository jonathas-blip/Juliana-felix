// Chamadas ao Claude: nota de compatibilidade, texto de apresentação, leitura de e-mails e extração de vagas de páginas.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { ENV, carregarPerfil, carregarTextos } from './config.js';
import { respostasAprendidas } from './db.js';

export const claude = new Anthropic(); // usa ANTHROPIC_API_KEY do .env

// Se o modelo principal recusar um pedido, a própria API tenta de novo num modelo reserva.
export const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

// Contexto fixo (perfil + currículo + estilo). Fica no início do prompt e vai para o cache, então custa pouco repetir.
export function contextoCandidata() {
  const perfil = carregarPerfil();
  const { curriculo, estilo } = carregarTextos();
  const aprendidas = respostasAprendidas();
  return [
    '# PERFIL E OBJETIVO (config/perfil.json)',
    JSON.stringify(perfil, null, 2),
    '# CURRÍCULO (fonte da verdade sobre experiência e habilidades)',
    curriculo || '(currículo não preenchido)',
    '# AMOSTRAS DE COMO A PESSOA ESCREVE',
    estilo || '(sem amostras)',
    '# RESPOSTAS QUE A PESSOA JÁ DEU EM CANDIDATURAS ANTERIORES',
    aprendidas.length ? aprendidas.map((r) => `- ${r.pergunta}: ${r.resposta}`).join('\n') : '(nenhuma ainda)',
  ].join('\n\n');
}

function sistema(papel) {
  return [
    { type: 'text', text: contextoCandidata(), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: papel },
  ];
}

async function estruturado({ papel, pedido, schema, esforco = 'low', maxTokens = 8000 }) {
  const r = await claude.beta.messages.parse({
    model: ENV.modelo,
    max_tokens: maxTokens,
    ...FALLBACK,
    output_config: { effort: esforco, format: betaZodOutputFormat(schema) },
    system: sistema(papel),
    messages: [{ role: 'user', content: pedido }],
  });
  if (r.stop_reason === 'refusal' || !r.parsed_output) {
    throw new Error(`Claude não devolveu resposta válida (stop_reason=${r.stop_reason})`);
  }
  return r.parsed_output;
}

// ---------- 1. Nota de compatibilidade ----------
const Avaliacao = z.object({
  nota: z.number().describe('inteiro de 0 a 100'),
  decisao: z.enum(['candidatar', 'descartar']),
  motivo: z.string().describe('1-2 frases, em português, explicando a nota'),
  pontos_fortes: z.array(z.string()),
  lacunas: z.array(z.string()),
  modelo_trabalho: z.string().describe('presencial, híbrido, remoto ou "não informado"'),
  salario_informado: z.string().describe('faixa salarial citada na vaga, ou ""'),
  bloqueio: z.string().describe('regra do perfil que a vaga viola (local, salário, senioridade, empresa excluída...), ou ""'),
});

export async function avaliarVaga(vaga) {
  const perfil = carregarPerfil();
  return estruturado({
    papel: `Você é a recrutadora pessoal da pessoa acima. Dê uma nota de 0 a 100 de compatibilidade entre a vaga e o perfil REAL
(currículo), não o perfil desejado. Critérios: aderência do cargo aos cargos-alvo, habilidades exigidas que ela comprovadamente
tem, senioridade, local/modelo de trabalho, salário (se informado) e empresas/palavras excluídas. Seja exigente: requisito
obrigatório que ela não tem derruba a nota. Se a vaga viola uma regra dura do perfil (local, modelo de trabalho, salário mínimo,
empresa excluída, palavra excluída), preencha "bloqueio" e decida "descartar". Decida "candidatar" só com nota >= ${perfil.nota_minima}.`,
    pedido: `VAGA\nFonte: ${vaga.fonte}\nTítulo: ${vaga.titulo}\nEmpresa: ${vaga.empresa}\nLocal: ${vaga.local}\nURL: ${vaga.url}\n\n${(vaga.descricao || '').slice(0, 20000)}`,
    schema: Avaliacao,
  });
}

// ---------- 2. Texto de apresentação no estilo da pessoa ----------
export async function escreverCarta(vaga, limiteCaracteres = 1500) {
  const r = await estruturado({
    papel: `Escreva o texto de apresentação para a vaga, em português, na primeira pessoa e no MESMO JEITO de escrever das amostras
(vocabulário, tamanho das frases, tom). Use somente fatos do currículo: nunca invente experiência, número, ferramenta ou certificação.
Conecte 2 ou 3 experiências reais aos requisitos da vaga. Sem clichês, sem emojis, sem "venho por meio desta".
Máximo de ${limiteCaracteres} caracteres.`,
    pedido: `VAGA\n${vaga.titulo} — ${vaga.empresa}\n\n${(vaga.descricao || '').slice(0, 15000)}`,
    schema: z.object({ texto: z.string() }),
    esforco: 'medium',
  });
  return r.texto.slice(0, limiteCaracteres);
}

// ---------- 3. Leitura de e-mail ----------
const LeituraEmail = z.object({
  tipo: z.enum(['entrevista', 'teste', 'prazo', 'oferta', 'pergunta_recrutador', 'confirmacao_candidatura',
    'em_analise', 'reprovacao', 'irrelevante']),
  empresa: z.string().describe('empresa do processo seletivo, ou ""'),
  cargo: z.string().describe('vaga citada, ou ""'),
  resumo: z.string().describe('1 frase em português'),
  data_evento: z.string().describe('data/hora da entrevista, teste ou prazo no formato AAAA-MM-DD HH:MM, ou ""'),
  link: z.string().describe('link da entrevista, do teste ou do formulário, ou ""'),
  pode_responder_sozinho: z.boolean(),
  motivo_para_perguntar: z.string().describe('se não pode responder sozinho, o que falta saber da pessoa; senão ""'),
  resposta: z.string().describe('texto da resposta ao recrutador no estilo da pessoa, ou "" se não precisa responder'),
});

export async function lerEmail(email, vagasAbertas) {
  const perfil = carregarPerfil();
  return estruturado({
    papel: `Você cuida da caixa de entrada da pessoa durante a busca de emprego. Classifique o e-mail e, se for de um recrutador
pedindo algo, decida se dá para responder sozinho.
Pode responder sozinho SOMENTE quando a resposta sai inteira do perfil, do currículo ou das respostas já dadas: confirmar
recebimento, confirmar interesse, confirmar um horário de entrevista que caiba na disponibilidade "${perfil.disponibilidade_entrevistas || 'não informada'}",
reenviar link do LinkedIn/portfólio.
NUNCA responda sozinho: proposta ou negociação de salário, aceitar/recusar oferta, pedido de documentos (RG, CPF, conta bancária),
dados de saúde/família/religião, perguntas pessoais, senhas, códigos de verificação, ou qualquer coisa fora do perfil.
Nesses casos pode_responder_sozinho=false e diga em motivo_para_perguntar o que perguntar à pessoa.
Golpes (pedem pagamento, PIX, dados bancários, "taxa de cadastro") são "irrelevante" e o resumo começa com "POSSÍVEL GOLPE".`,
    pedido: `PROCESSOS EM ANDAMENTO: ${vagasAbertas.map((v) => `#${v.id} ${v.empresa} — ${v.titulo}`).join('; ') || 'nenhum'}

E-MAIL
De: ${email.de}
Assunto: ${email.assunto}
Data: ${email.data}

${(email.texto || '').slice(0, 12000)}`,
    schema: LeituraEmail,
  });
}

// ---------- 4. Extrair lista de vagas de uma página qualquer (Catho, Vagas.com, Indeed, site de carreiras) ----------
const ListaVagas = z.object({
  vagas: z.array(z.object({
    titulo: z.string(),
    empresa: z.string(),
    local: z.string(),
    url: z.string().describe('URL absoluta da página da vaga'),
  })),
});

export async function extrairVagasDaPagina(urlPagina, texto, links, empresaPadrao = '') {
  const r = await estruturado({
    papel: 'Extraia as vagas de emprego listadas na página. Use somente links que aparecem na lista de links. Ignore anúncios e menus.',
    pedido: `PÁGINA: ${urlPagina}\nEMPRESA (se for site de carreiras): ${empresaPadrao || '-'}\n\nTEXTO:\n${texto.slice(0, 25000)}\n\nLINKS:\n${links.slice(0, 400).join('\n')}`,
    schema: ListaVagas,
  });
  return r.vagas;
}
