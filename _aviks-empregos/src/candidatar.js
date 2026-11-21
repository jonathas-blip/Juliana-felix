// Etapa 3: candidatura. O Claude "enxerga" o formulário (lista de campos) e usa ferramentas para clicar e preencher.
// Regras duras ficam no CÓDIGO (não dependem só do prompt): nunca digita senha, nunca resolve CAPTCHA, para e pergunta
// quando falta informação.
import path from 'node:path';
import { z } from 'zod';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { ENV, carregarPerfil, arquivoCurriculoPdf, DIR_PRINTS } from './config.js';
import { db, atualizarVaga, registrar, criarPendencia, candidaturasHoje, agora } from './db.js';
import { claude, FALLBACK, contextoCandidata, escreverCarta } from './ia.js';
import { salvarSessao, pausa } from './navegador.js';
import { avisar } from './avisos.js';

// ---------- leitura do formulário ----------
// Marca cada elemento interativo visível com data-aviks-ref e devolve uma descrição curta de cada um.
function capturarCampos(prefixo) {
  const visivel = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const rotulo = (el) => {
    const partes = [];
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) partes.push(l.innerText);
    }
    const ancestral = el.closest('label');
    if (ancestral) partes.push(ancestral.innerText);
    for (const a of ['aria-label', 'placeholder', 'title', 'name']) if (el.getAttribute(a)) partes.push(el.getAttribute(a));
    const lb = el.getAttribute('aria-labelledby');
    if (lb) lb.split(' ').forEach((i) => { const e = document.getElementById(i); if (e) partes.push(e.innerText); });
    const controle = ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);
    const temLabel = partes.length && !(partes.length === 1 && partes[0] === el.getAttribute('name'));
    if (controle && !temLabel && el.type !== 'radio') {
      // Texto da "pergunta" ao redor do campo, subindo só enquanto o bloco contém apenas este campo
      // (para não misturar o texto de outras perguntas do formulário).
      let p = el.parentElement;
      for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
        if (p.querySelectorAll('input:not([type=hidden]), select, textarea').length > 1) break;
        const t = (p.innerText || '').trim();
        if (t && t.length < 400) { partes.push(t); break; }
      }
    }
    if (el.type === 'radio') {
      // para radio, a pergunta é o grupo (fieldset/legend ou bloco com todos os radios de mesmo name)
      const grupo = el.closest('fieldset, [role=radiogroup]');
      const leg = grupo?.querySelector('legend, [id]')?.innerText || grupo?.getAttribute('aria-label');
      if (leg) partes.push(`pergunta: ${leg}`);
    }
    return [...new Set(partes.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean))].join(' | ').slice(0, 300);
  };
  const seletor = 'input, select, textarea, button, a[href], [role=button], [role=checkbox], [role=radio], [role=combobox], [role=option], [role=menuitem], [role=switch], [contenteditable=true]';
  const itens = [];
  let n = 0;
  for (const el of document.querySelectorAll(seletor)) {
    const tipo = (el.getAttribute('type') || '').toLowerCase();
    const arquivo = el.tagName === 'INPUT' && tipo === 'file';
    if (tipo === 'hidden' || (!arquivo && !visivel(el)) || el.disabled) continue;
    const ref = `${prefixo}${n++}`;
    el.setAttribute('data-aviks-ref', ref);
    const item = { ref, tag: el.tagName.toLowerCase(), tipo: tipo || el.getAttribute('role') || '', rotulo: rotulo(el) };
    if (el.tagName === 'A' || el.tagName === 'BUTTON' || el.getAttribute('role')) item.texto = (el.innerText || '').trim().slice(0, 100);
    if ('value' in el && el.tagName !== 'BUTTON' && tipo !== 'checkbox' && tipo !== 'radio') item.valor = String(el.value || '').slice(0, 200);
    if (tipo === 'checkbox' || tipo === 'radio') item.marcado = el.checked;
    if (el.getAttribute('aria-checked')) item.marcado = el.getAttribute('aria-checked') === 'true';
    if (el.required || el.getAttribute('aria-required') === 'true') item.obrigatorio = true;
    if (el.tagName === 'SELECT') item.opcoes = [...el.options].slice(0, 40).map((o) => o.text.trim());
    if (el.getAttribute('aria-invalid') === 'true') item.erro = true;
    itens.push(item);
    if (itens.length >= 250) break;
  }
  const erros = [...document.querySelectorAll('[role=alert], .error, .errors, [class*="error-message"], [class*="ErrorMessage"]')]
    .filter(visivel).map((e) => e.innerText.trim()).filter(Boolean).slice(0, 10);
  return { itens, erros };
}

export async function fotografarPagina(pagina) {
  const frames = pagina.frames().filter((f) => f === pagina.mainFrame() || /gupy|linkedin|catho|vagas|indeed|greenhouse|lever|workday|kenoby|solides|pandape|breezy|recruitee|abler/i.test(f.url()));
  const todos = [];
  const errosPagina = [];
  for (const [i, f] of frames.entries()) {
    try {
      const { itens, erros } = await f.evaluate(capturarCampos, `f${i}-`);
      todos.push(...itens);
      errosPagina.push(...erros);
    } catch { /* frame sumiu */ }
  }
  const texto = (await pagina.locator('body').innerText().catch(() => '')).replace(/\n{2,}/g, '\n').slice(0, 5000);
  const senha = todos.some((c) => c.tipo === 'password');
  const captcha = pagina.frames().some((f) => /recaptcha|hcaptcha|challenges\.cloudflare|turnstile|arkoselabs|funcaptcha/i.test(f.url()));
  return { url: pagina.url(), titulo: await pagina.title(), texto, campos: todos, erros: errosPagina, tem_campo_senha: senha, tem_captcha: captcha };
}

export function localizar(pagina, ref) {
  const m = ref.match(/^f(\d+)-/);
  if (!m) throw new Error(`ref inválida: ${ref}`);
  const frames = pagina.frames().filter((f) => f === pagina.mainFrame() || /gupy|linkedin|catho|vagas|indeed|greenhouse|lever|workday|kenoby|solides|pandape|breezy|recruitee|abler/i.test(f.url()));
  const f = frames[Number(m[1])];
  if (!f) throw new Error('A página mudou; chame ver_pagina de novo.');
  return f.locator(`[data-aviks-ref="${ref}"]`).first();
}

// ---------- o agente ----------
function papelCandidatura(vaga, carta) {
  const perfil = carregarPerfil();
  return `Você se candidata a vagas de emprego em nome da pessoa acima, usando um navegador já logado nas contas dela.

VAGA: ${vaga.titulo} — ${vaga.empresa}
URL: ${vaga.url}
TEXTO DE APRESENTAÇÃO JÁ ESCRITO (use quando houver campo de carta/apresentação/"por que você"):
"""${carta}"""

Como trabalhar:
1. Chame ver_pagina para ver a página. Procure o botão de candidatura ("Candidatar-se", "Candidatura simplificada",
   "Quero me candidatar", "Easy Apply", "Aplicar"). Se ele levar ao site da empresa, continue lá.
2. Preencha cada campo com dados do perfil/currículo/respostas já dadas. Anexe o currículo quando pedirem.
   Depois de cada passo, chame ver_pagina de novo para conferir (campos obrigatórios, mensagens de erro).
3. Perguntas de formulário: responda com a verdade do currículo. Pretensão salarial: ${perfil.pretensao_salarial || 'use respostas_prontas ou pergunte'}.
   Perguntas de "sim/não" sobre experiência com uma ferramenta: só "sim" se o currículo comprovar.
4. Envie a candidatura e chame finalizar com "enviada" ao ver a confirmação.

Regras que você NUNCA quebra:
- Nunca invente habilidade, experiência, formação, certificação, número ou ferramenta que não está no currículo.
- Nunca digite senha, código de verificação/SMS ou dados de cartão. Se aparecer tela de login, chame pedir_ajuda.
- Nunca tente resolver CAPTCHA ou "não sou um robô": chame pedir_ajuda.
- Pergunta pessoal ou sensível que não está no perfil (documentos, saúde, deficiência, religião, família, endereço completo
  quando não está no perfil, dados bancários, autorizações legais) → pedir_ajuda com a pergunta exata.
- Testes online, vídeo-entrevista gravada e questionários de personalidade longos → finalizar com "teste" (a pessoa faz).
- Se a vaga já foi encerrada ou ela já se candidatou → finalizar com o resultado certo.
- Não aceite termos além dos necessários para enviar a candidatura; não marque newsletters/marketing.
Seja objetivo: use poucas palavras entre as ações.`;
}

export async function candidatar(contexto, vaga) {
  const pdf = arquivoCurriculoPdf();
  let carta = vaga.carta;
  if (!carta) {
    carta = await escreverCarta(vaga);
    atualizarVaga(vaga.id, { carta });
  }
  const pagina = await contexto.newPage();
  let fim = null;

  const ferramentas = [
    betaZodTool({
      name: 'ver_pagina',
      description: 'Lista os campos e botões visíveis da página atual (cada um com uma ref), mensagens de erro e o texto da página. Use com_imagem=true só se a lista não bastar para entender a tela.',
      inputSchema: z.object({ com_imagem: z.boolean().optional() }),
      run: async ({ com_imagem }) => {
        await pagina.waitForLoadState('domcontentloaded').catch(() => {});
        await pausa(800, 1500);
        const foto = await fotografarPagina(pagina);
        const saida = [{ type: 'text', text: JSON.stringify(foto) }];
        if (com_imagem) {
          const img = await pagina.screenshot({ type: 'jpeg', quality: 60 });
          saida.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img.toString('base64') } });
        }
        return saida;
      },
    }),
    betaZodTool({
      name: 'clicar',
      description: 'Clica num botão, link, opção, checkbox ou radio pela ref.',
      inputSchema: z.object({ ref: z.string() }),
      run: async ({ ref }) => {
        const novaAba = contexto.waitForEvent('page', { timeout: 4000 }).catch(() => null);
        await localizar(pagina, ref).click();
        const aba = await novaAba;
        if (aba) {
          await aba.waitForLoadState('domcontentloaded').catch(() => {});
          await pagina.goto(aba.url()).catch(() => {});
          await aba.close().catch(() => {});
          return `Abriu uma nova aba (${pagina.url()}); continuei nela.`;
        }
        await pausa(1200, 2500);
        return `ok (url: ${pagina.url()})`;
      },
    }),
    betaZodTool({
      name: 'preencher',
      description: 'Digita um texto num campo de texto/área de texto pela ref (substitui o conteúdo).',
      inputSchema: z.object({ ref: z.string(), texto: z.string() }),
      run: async ({ ref, texto }) => {
        const el = localizar(pagina, ref);
        const tipo = (await el.getAttribute('type').catch(() => '')) || '';
        const auto = (await el.getAttribute('autocomplete').catch(() => '')) || '';
        if (tipo.toLowerCase() === 'password' || /one-time-code|cc-number|cc-csc/.test(auto)) {
          return 'BLOQUEADO: campo de senha/código/cartão. Use pedir_ajuda.';
        }
        await el.fill(texto);
        await pausa(300, 900);
        return 'ok';
      },
    }),
    betaZodTool({
      name: 'selecionar',
      description: 'Escolhe uma opção de um <select> pela ref, usando o texto da opção.',
      inputSchema: z.object({ ref: z.string(), opcao: z.string() }),
      run: async ({ ref, opcao }) => {
        await localizar(pagina, ref).selectOption({ label: opcao }).catch(async () => localizar(pagina, ref).selectOption(opcao));
        return 'ok';
      },
    }),
    betaZodTool({
      name: 'digitar_e_escolher',
      description: 'Para campos de busca/autocompletar (cidade, cargo, faculdade): digita devagar e escolhe a primeira sugestão que contenha o texto.',
      inputSchema: z.object({ ref: z.string(), texto: z.string() }),
      run: async ({ ref, texto }) => {
        const el = localizar(pagina, ref);
        await el.click();
        await el.pressSequentially(texto, { delay: 80 });
        await pausa(1200, 1800);
        const opcao = pagina.getByRole('option', { name: new RegExp(texto.split(/[ ,-]/)[0], 'i') }).first();
        if (await opcao.count()) { await opcao.click(); return 'ok, sugestão escolhida'; }
        await el.press('ArrowDown').catch(() => {});
        await el.press('Enter').catch(() => {});
        return 'digitado; confira com ver_pagina';
      },
    }),
    betaZodTool({
      name: 'anexar_curriculo',
      description: 'Anexa o currículo em PDF num campo de arquivo (input type=file) pela ref.',
      inputSchema: z.object({ ref: z.string() }),
      run: async ({ ref }) => {
        if (!pdf) return 'Não há config/curriculo.pdf. Use pedir_ajuda.';
        await localizar(pagina, ref).setInputFiles(pdf);
        await pausa(1500, 2500);
        return `anexado ${path.basename(pdf)}`;
      },
    }),
    betaZodTool({
      name: 'rolar',
      description: 'Rola a página para baixo (para carregar mais campos).',
      inputSchema: z.object({}),
      run: async () => { await pagina.mouse.wheel(0, 900); await pausa(600, 1000); return 'ok'; },
    }),
    betaZodTool({
      name: 'pedir_ajuda',
      description: 'Para a candidatura e pergunta à pessoa (login, CAPTCHA, pergunta pessoal ou sem resposta no perfil). Escreva a pergunta exata do formulário.',
      inputSchema: z.object({ pergunta: z.string(), contexto: z.string() }),
      run: async ({ pergunta, contexto: ctx }) => {
        fim = { resultado: 'ajuda', pergunta, detalhe: ctx };
        return 'Pedido registrado. Encerre agora.';
      },
    }),
    betaZodTool({
      name: 'finalizar',
      description: 'Encerra esta vaga com o resultado.',
      inputSchema: z.object({
        resultado: z.enum(['enviada', 'ja_candidatada', 'encerrada', 'teste', 'impossivel']),
        detalhe: z.string(),
      }),
      run: async ({ resultado, detalhe }) => {
        fim = { resultado, detalhe };
        return 'ok';
      },
    }),
  ];

  try {
    await pagina.goto(vaga.url, { waitUntil: 'domcontentloaded' });
    const runner = claude.beta.messages.toolRunner({
      model: ENV.modelo,
      max_tokens: 16000,
      ...FALLBACK,
      betas: [...FALLBACK.betas, 'context-management-2025-06-27'],
      context_management: { edits: [{ type: 'clear_tool_uses_20250919' }] },
      output_config: { effort: 'medium' },
      max_iterations: 60,
      tools: ferramentas,
      system: [
        { type: 'text', text: contextoCandidata(), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: papelCandidatura(vaga, carta) },
      ],
      messages: [{ role: 'user', content: 'Faça a candidatura para esta vaga.' }],
    });
    for await (const msg of runner) {
      if (fim) break;
      if (msg.stop_reason === 'refusal') { fim = { resultado: 'impossivel', detalhe: 'O modelo recusou continuar' }; break; }
    }
  } catch (e) {
    fim = { resultado: 'erro', detalhe: e.message };
  }

  const print = path.join(DIR_PRINTS, `vaga-${vaga.id}-${Date.now()}.jpg`);
  await pagina.screenshot({ path: print, type: 'jpeg', quality: 60, fullPage: false }).catch(() => {});
  await salvarSessao(contexto);
  await pagina.close().catch(() => {});
  return fim || { resultado: 'impossivel', detalhe: 'Agente parou sem concluir (limite de passos)' };
}

export async function candidatarAprovadas(contexto) {
  const perfil = carregarPerfil();
  const vagas = db.prepare("SELECT * FROM vagas WHERE status = 'aprovada' AND tentativas < 3 ORDER BY nota DESC, encontrada_em DESC").all();
  let enviadas = 0;

  for (const vaga of vagas) {
    if (candidaturasHoje() >= perfil.max_candidaturas_por_dia) {
      registrar('aviso', `Limite diário de ${perfil.max_candidaturas_por_dia} candidaturas atingido; o resto fica para amanhã.`);
      break;
    }
    atualizarVaga(vaga.id, { tentativas: vaga.tentativas + 1 });
    registrar('candidatura', `Iniciando: ${vaga.titulo} (${vaga.empresa})`, vaga.id);
    const r = await candidatar(contexto, vaga);

    switch (r.resultado) {
      case 'enviada':
        enviadas++;
        atualizarVaga(vaga.id, { status: 'candidatada', candidatada_em: agora(), etapa: 'Candidatura enviada' });
        registrar('candidatura', `Enviada. ${r.detalhe}`, vaga.id);
        break;
      case 'ja_candidatada':
        atualizarVaga(vaga.id, { status: 'candidatada', etapa: 'Já havia candidatura' });
        break;
      case 'encerrada':
        atualizarVaga(vaga.id, { status: 'encerrada', motivo: r.detalhe });
        break;
      case 'teste':
        atualizarVaga(vaga.id, { status: 'teste', etapa: r.detalhe });
        await avisar(`Teste para fazer: ${vaga.empresa}`, `${vaga.titulo}\n${r.detalhe}\n${vaga.url}`, 'teste');
        break;
      case 'ajuda': {
        atualizarVaga(vaga.id, { status: 'precisa_de_voce', etapa: r.pergunta });
        criarPendencia({ vagaId: vaga.id, pergunta: r.pergunta, contexto: r.detalhe });
        await avisar(`Preciso de você: ${vaga.empresa}`, `${r.pergunta}\nResponda no painel.`, 'precisa_de_voce');
        break;
      }
      default:
        atualizarVaga(vaga.id, { status: vaga.tentativas + 1 >= 3 ? 'falhou' : 'aprovada', etapa: r.detalhe });
        registrar('erro', `Candidatura não concluída: ${r.detalhe}`, vaga.id);
    }
    await pausa(20000, 60000); // ritmo humano entre candidaturas
  }
  return enviadas;
}
