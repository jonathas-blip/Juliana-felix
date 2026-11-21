// `npm run criar-senha`: pergunta usuário e senha e mostra as linhas para colar no .env.
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { gerarHash } from './auth.js';

const rl = readline.createInterface({ input: stdin, output: stdout });
const usuario = (await rl.question('Usuário do painel: ')).trim();
const senha = await rl.question('Senha (mínimo 10 caracteres): ');
rl.close();
if (!usuario || senha.length < 10) {
  console.error('Usuário vazio ou senha curta demais.');
  process.exit(1);
}
console.log('\nCole no arquivo .env:\n');
console.log(`PAINEL_USUARIO=${usuario}`);
console.log(`PAINEL_SENHA_HASH=${gerarHash(senha)}`);
