// Abre um navegador VISÍVEL para você entrar nas suas contas (LinkedIn, Gupy, Catho, Vagas.com, Indeed...).
// Quem digita a senha é você. Ao fechar, os cookies ficam em dados/sessao-navegador.json e o agente usa essa sessão.
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { chromium } from 'playwright';
import { ARQ_SESSAO } from './config.js';

const SITES = [
  'https://www.linkedin.com/login',
  'https://login.gupy.io/candidates/signin',
  'https://www.catho.com.br/signin/',
  'https://www.vagas.com.br/login-candidatos',
  'https://secure.indeed.com/account/login',
];

const nav = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await nav.newContext({
  storageState: fs.existsSync(ARQ_SESSAO) ? ARQ_SESSAO : undefined,
  locale: 'pt-BR',
  viewport: null,
});
for (const url of SITES) await (await ctx.newPage()).goto(url).catch(() => {});

console.log('\nEntre em cada aba com sua conta (marque "manter conectado").');
console.log('Pode abrir outras abas para sites de carreira de empresas que pedem cadastro.');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question('\nQuando terminar, aperte ENTER aqui para salvar a sessão... ');
rl.close();
await ctx.storageState({ path: ARQ_SESSAO });
await nav.close();
console.log(`Sessão salva em ${ARQ_SESSAO}. Refaça este passo se algum site pedir login de novo.`);
