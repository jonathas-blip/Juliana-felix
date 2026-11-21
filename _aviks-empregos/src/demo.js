// `npm run demo`: abre o painel com dados FICTÍCIOS (pasta dados-demo/) para você ver como fica, sem chave e sem contas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.AVIKS_DEMO = '1';
process.env.DATA_DIR = path.join(raiz, 'dados-demo');
process.env.PAINEL_USUARIO = process.env.PAINEL_USUARIO || '';
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });

const { db } = await import('./db.js');

const empresas = ['Nubank', 'Itaú', 'Ambev', 'Natura', 'Magalu', 'iFood', 'Stone', 'Raia Drogasil', 'Localiza', 'Vivo', 'Votorantim', 'Hapvida', 'TOTVS', 'Suzano', 'B3'];
const cargos = ['Analista de Dados Pleno', 'Analista de BI Sênior', 'Analista de Processos', 'Analista de Dados Sênior', 'Especialista em Power BI'];
const fontes = ['LinkedIn', 'Gupy', 'Catho', 'Vagas.com', 'Indeed', 'Carreiras Natura'];
const motivosDescarte = ['Exige Spark e Databricks como obrigatórios; o currículo não tem.', 'Presencial em Campinas, fora das localizações do perfil.',
  'Vaga de estágio (palavra excluída).', 'Salário informado de R$ 4.500, abaixo do mínimo.', 'Coordenação de equipe de 12 pessoas; senioridade acima do alvo.'];
const ins = db.prepare(`INSERT INTO vagas (fonte, url, chave, titulo, empresa, local, modelo, nota, motivo, pontos_fortes, lacunas, status, etapa, carta,
  encontrada_em, candidatada_em, atualizada_em, descricao) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const ev = db.prepare('INSERT INTO eventos (vaga_id, quando, tipo, texto) VALUES (?,?,?,?)');
const fmt = (d) => d.toISOString().replace('T', ' ').slice(0, 19);
let n = 0;
for (let dia = 29; dia >= 0; dia--) {
  const qtd = 4 + ((dia * 7) % 6);
  for (let i = 0; i < qtd; i++) {
    n++;
    const d = new Date(Date.now() - dia * 864e5 - i * 3.6e6);
    const nota = 45 + ((n * 37) % 53);
    const aprovada = nota >= 80;
    let status = aprovada ? 'candidatada' : 'descartada';
    let etapa = aprovada ? 'Candidatura enviada' : '';
    if (aprovada && n % 5 === 0) { status = 'em_processo'; etapa = 'Currículo em análise pelo RH'; }
    if (aprovada && n % 11 === 0) { status = 'reprovada'; etapa = 'Empresa seguiu com outros candidatos'; }
    if (aprovada && n % 13 === 0) { status = 'teste'; etapa = 'Case de SQL e Power BI, prazo de 3 dias'; }
    if (aprovada && n % 17 === 0) { status = 'entrevista'; etapa = 'Entrevista com gestor (Google Meet)'; }
    if (dia === 0 && i === 0) { status = 'precisa_de_voce'; etapa = 'Formulário pergunta: "Você tem disponibilidade para viagens mensais?"'; }
    const emp = empresas[n % empresas.length];
    const cargo = cargos[n % cargos.length];
    const r = ins.run(fontes[n % fontes.length], `https://exemplo.com/vaga/${n}`, `${emp}|${cargo}|${n}`, cargo, emp, n % 3 ? 'São Paulo - SP' : 'Remoto',
      n % 3 ? 'híbrido' : 'remoto', nota, aprovada ? 'Boa aderência: SQL, Power BI e automação com Python batem com os requisitos.' : motivosDescarte[n % motivosDescarte.length],
      aprovada ? 'Power BI avançado • SQL • Automação de relatórios' : '', aprovada ? 'Não cita experiência com Azure' : 'Requisito obrigatório ausente',
      status, etapa, aprovada ? 'Texto de apresentação de exemplo, escrito no estilo da pessoa.' : null,
      fmt(d), aprovada ? fmt(new Date(d.getTime() + 3.6e6)) : null, fmt(new Date(d.getTime() + 7.2e6)), 'Descrição de exemplo da vaga.');
    const id = Number(r.lastInsertRowid);
    ev.run(id, fmt(d), 'avaliacao', `${nota} — ${cargo} (${emp}) → ${aprovada ? 'candidatar' : 'descartada'}`);
    if (aprovada) ev.run(id, fmt(new Date(d.getTime() + 3.6e6)), 'candidatura', 'Enviada. Confirmação exibida na tela.');
    if (status === 'entrevista' || status === 'teste') {
      const quando = new Date(Date.now() + ((n % 6) + 1) * 864e5);
      quando.setHours(10 + (n % 6), 0, 0, 0);
      db.prepare(`INSERT INTO emails (conta, uid, de, assunto, recebido_em, tipo, resumo, data_evento, link, vaga_id, respondido)
        VALUES ('demo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(n, `Recrutamento ${emp}`, `Próxima etapa — ${cargo}`, fmt(d), status,
        status === 'entrevista' ? `Convite para entrevista com a gestora; horário confirmado automaticamente.` : 'Case técnico enviado por e-mail.',
        fmt(quando).slice(0, 16), 'https://meet.google.com/', id, status === 'entrevista' ? 1 : 0);
    }
    if (status === 'precisa_de_voce') {
      db.prepare('INSERT INTO pendencias (vaga_id, pergunta, contexto) VALUES (?, ?, ?)').run(id,
        'Você tem disponibilidade para viagens mensais (2 a 3 dias por mês)?', 'Pergunta obrigatória do formulário da Gupy. Não há resposta no perfil.');
    }
  }
}
db.prepare("INSERT INTO estado (chave, valor) VALUES ('ultimo_ciclo', ?)").run(JSON.stringify({ quando: new Date().toISOString(), resumo: '38 vagas novas, 6 aprovadas, 6 candidaturas enviadas (21 min)' }));
console.log(`Demonstração com ${n} vagas fictícias.`);
await import('./servidor.js');
