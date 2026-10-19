# Monitor do site (visitas e cliques no WhatsApp)

Serviço pequeno em Node (sem dependências) que roda num contêiner próprio na VPS:

- `POST /api` — o site envia cada visita e cada clique em botão de WhatsApp
- `GET /api?senha=…&dias=…` — o painel lê os dados
- `GET /adm` — o painel (gerado por `_modelo/build.ps1` a partir de `_modelo/painel.html`)

Dados ficam em `dados/eventos.ndjson` (uma linha por evento). Nada pessoal é guardado (nem IP).

## Instalação na VPS (uma vez)

1. **DNS:** no registro.br, crie um registro **A** `painel` → IP da VPS (`187.77.58.31`).
2. Copie esta pasta para a VPS, por exemplo em `/opt/jf-monitor`
   (`server.js`, `docker-compose.yml`, `instalar.sh`, `public/adm.html`).
3. Na VPS: `cd /opt/jf-monitor && bash instalar.sh`
   - cria a senha do painel em `.env` e mostra na tela;
   - sobe o contêiner `jf-monitor` na mesma rede do Caddy do Aviks;
   - acrescenta `painel.julianafelix.com.br` no Caddyfile (com backup) e recarrega o Caddy sem derrubar o Aviks.
4. No `_modelo/cliente.json`: `"monitoramento": { "endpoint": "https://painel.julianafelix.com.br/api", "painelApi": "/api" }`,
   gere o site (`build.ps1`) e publique.

## Atualizar o painel

Gere de novo (`build.ps1`) e copie `public/adm.html` para a VPS — não precisa reiniciar nada.

## Desinstalar

`docker compose down` na pasta, remova o bloco `painel.julianafelix.com.br` do Caddyfile e rode
`docker exec aviks-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`.

## Não contar os próprios acessos

Abra o site uma vez com `?naocontar` no fim do endereço (vale para aquele navegador).
