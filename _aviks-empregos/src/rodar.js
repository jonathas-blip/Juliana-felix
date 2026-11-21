// Ciclo completo: buscar → avaliar → candidatar → ler e-mails. Usado pelo agendador do servidor e por `npm run rodar`.
import { pathToFileURL } from 'node:url';
import { registrar, lerEstado, gravarEstado } from './db.js';
import { abrirContexto, salvarSessao, fecharNavegador } from './navegador.js';
import { buscarVagas, avaliarNovas } from './buscar.js';
import { candidatarAprovadas } from './candidatar.js';
import { verificarEmails } from './emails.js';

let rodando = false;
export const estaRodando = () => rodando;

export async function cicloCompleto({ soBuscar = false } = {}) {
  if (rodando) return { ok: false, motivo: 'Já existe uma execução em andamento' };
  if (lerEstado('pausado', false)) return { ok: false, motivo: 'Agente pausado no painel' };
  rodando = true;
  const inicio = Date.now();
  let contexto;
  try {
    registrar('ciclo', 'Início do ciclo');
    contexto = await abrirContexto();
    const novas = await buscarVagas(contexto);
    const aprovadas = await avaliarNovas(contexto);
    const enviadas = soBuscar ? 0 : await candidatarAprovadas(contexto);
    await salvarSessao(contexto);
    await verificarEmails();
    const resumo = `${novas} vagas novas, ${aprovadas} aprovadas, ${enviadas} candidaturas enviadas (${Math.round((Date.now() - inicio) / 60000)} min)`;
    registrar('ciclo', resumo);
    gravarEstado('ultimo_ciclo', { quando: new Date().toISOString(), resumo });
    return { ok: true, resumo };
  } catch (e) {
    registrar('erro', `Ciclo interrompido: ${e.message}`);
    return { ok: false, motivo: e.message };
  } finally {
    await contexto?.close().catch(() => {});
    await fecharNavegador();
    rodando = false;
  }
}

export async function cicloEmails() {
  if (lerEstado('pausado', false)) return;
  await verificarEmails();
  gravarEstado('ultimo_email', new Date().toISOString());
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv.slice(2);
  const p = arg.includes('--so-emails') ? cicloEmails() : cicloCompleto({ soBuscar: arg.includes('--so-buscar') });
  p.then((r) => { console.log(r || 'ok'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
}
