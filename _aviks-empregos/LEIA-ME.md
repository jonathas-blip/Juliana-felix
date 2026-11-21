# Aviks Empregos

Agente que procura vagas, dá uma nota para cada uma, se candidata sozinho nas boas, acompanha os seus e-mails
e só chama você para o que precisa de você: entrevista, teste, prazo, proposta ou uma pergunta que ele não pode responder.

```
 todo dia no horário do perfil                                  a cada 30 min
 ┌──────────┐   ┌───────────┐   ┌──────────────┐          ┌──────────────────┐
 │ 1 BUSCA  │ → │ 2 NOTA    │ → │ 3 CANDIDATURA │          │ 4 E-MAILS         │
 │ LinkedIn │   │ 0–100 vs. │   │ preenche o    │          │ lê as 2+ caixas,  │
 │ Gupy     │   │ currículo │   │ formulário,   │          │ atualiza a etapa, │
 │ Catho    │   │ < mínima: │   │ anexa o PDF,  │          │ responde o simples│
 │ Vagas    │   │ descarta  │   │ escreve a     │          │ e avisa no celular│
 │ Indeed   │   │ com motivo│   │ apresentação  │          └──────────────────┘
 │ carreiras│   └───────────┘   └──────────────┘
 └──────────┘          tudo registrado no PAINEL (status, nota, motivo, etapa, histórico)
```

## O que ele nunca faz (regras no código, não só no prompt)

- **Não inventa** habilidade, experiência ou ferramenta: só usa o que está em `config/curriculo.md`.
- **Não digita senha**, código de SMS ou cartão. O campo de senha é bloqueado na ferramenta de digitação.
  Quem faz login é você, uma vez, com `npm run login`.
- **Não resolve CAPTCHA.** Para e pergunta.
- **Não responde pergunta pessoal** (documentos, saúde, PcD, família, banco) nem negocia salário ou aceita proposta.
  Ele cria uma pendência no painel, avisa no celular e, quando você responde, **guarda a resposta** e tenta a vaga de novo.
  Na próxima vez que a mesma pergunta aparecer, ele já sabe.
- Tem limite diário de candidaturas (`max_candidaturas_por_dia`) e espera de 20 a 60 s entre uma e outra.

## Instalação (no seu computador, Windows/Mac/Linux)

Precisa do **Node.js 22.13 ou mais novo** (https://nodejs.org).

```powershell
cd _aviks-empregos
npm install                       # instala tudo, inclusive o navegador Chromium
copy .env.example .env            # e preencha (chave do Claude, senha do painel, tópico do ntfy)
copy config\perfil.exemplo.json   config\perfil.json
copy config\curriculo.exemplo.md  config\curriculo.md
copy config\estilo.exemplo.md     config\estilo.md
copy config\emails.exemplo.json   config\emails.json
```

1. **`config/perfil.json`**: cargos que você quer, local, modelo de trabalho, salário mínimo, nota mínima (80),
   empresas dos sonhos (link do site de carreiras), empresas/palavras para excluir e respostas prontas para perguntas
   comuns de formulário.
2. **`config/curriculo.md`**: seu currículo real, em texto. É a fonte da verdade do agente.
3. **`config/curriculo.pdf`**: o PDF que ele anexa nas candidaturas.
4. **`config/estilo.md`**: 2 a 4 textos seus (cartas, posts, e-mails) para ele escrever do seu jeito.
5. **`config/emails.json`**: suas caixas de e-mail. Use **senha de app**, não a senha normal:
   - Gmail: ative a verificação em 2 etapas → https://myaccount.google.com/apppasswords
   - Outlook/Hotmail: https://account.microsoft.com/security → Senhas de app
6. **Avisos no celular**: instale o app **ntfy** (Android/iPhone) e assine o tópico que você colocou em `NTFY_TOPICO`.
7. **Login nos sites**: `npm run login` abre um navegador. Entre no LinkedIn, Gupy, Catho, Vagas.com e Indeed
   (e em sites de carreira que pedem cadastro), depois aperte ENTER no terminal. Refaça quando algum site deslogar
   (o painel mostra a pendência "faça login").

Para ver o painel antes de configurar: `npm run demo` → http://localhost:3900 (dados fictícios).

## Uso

```powershell
npm start          # painel em http://localhost:3900 + agenda automática (deixe rodando)
npm run rodar      # roda um ciclo completo agora, no terminal
npm run buscar     # só busca e dá nota (não se candidata) — bom para calibrar o perfil
npm run emails     # só lê os e-mails
```

**Primeira semana, recomendado:** rode `npm run buscar` e confira no painel se as notas e os motivos de descarte fazem
sentido. Ajuste `perfil.json` e `curriculo.md`. Depois ative as candidaturas com `NAVEGADOR_VISIVEL=1` no `.env` para
assistir algumas sendo feitas, e só então deixe sozinho.

No painel: cartões de resumo, **Precisa de você** (responda ali mesmo), agenda de entrevistas/testes/prazos, funil,
lista de candidaturas com filtros (clique numa vaga para ver nota, motivo, texto enviado, e-mails e histórico, e mudar
o status à mão), gráfico por dia e o registro de tudo que o agente fez. Botões **Rodar agora** e **Pausar**.

## Rodar 24 h numa VPS (opcional)

```bash
docker compose up -d --build
```

Faça o `npm run login` no seu computador e copie `dados/sessao-navegador.json` para `dados/` na VPS (o servidor não
tem tela para você logar). Publique o painel pelo Caddy com `SENHA_PAINEL` definida.

## Custos e riscos — leia antes de ligar

- **Claude API**: cada vaga avaliada é uma chamada curta; cada candidatura é uma conversa de vários passos (mais cara).
  Acompanhe o uso em https://console.anthropic.com e ajuste `max_vagas_avaliadas_por_dia` e `max_candidaturas_por_dia`.
- **Termos de uso**: LinkedIn, Catho e Indeed proíbem automação nas contas. Existe risco real de a conta ser
  limitada ou bloqueada, principalmente com muitas candidaturas por dia. Mantenha limites baixos (10–15/dia).
- **Indeed** costuma bloquear navegadores automatizados (Cloudflare); se a busca dele falhar sempre, tire do perfil.
- Sites mudam: as buscas da Catho, Vagas.com, Indeed e carreiras usam o Claude para ler a página, então aguentam
  mudança de layout, mas login expirado, CAPTCHA e formulários muito diferentes viram pendência para você.
- O LinkedIn e a Gupy são buscados pelas páginas públicas de vagas. Se mudarem, o erro aparece no registro do painel.

## Arquivos

```
src/servidor.js    painel + agenda (cron)          src/candidatar.js  agente que preenche formulários
src/rodar.js       ciclo completo                  src/emails.js      leitura/resposta de e-mails
src/buscar.js      busca + nota                    src/ia.js          chamadas ao Claude
src/fontes/        LinkedIn, Gupy, páginas         src/avisos.js      avisos no celular (ntfy)
src/login.js       login manual nos sites          src/db.js          banco SQLite em dados/
public/painel.html o painel                        config/            seu perfil (fora do Git)
```
