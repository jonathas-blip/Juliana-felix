# Monitor do site (visitas e cliques no WhatsApp)

Serviço pequeno em Node (sem dependências) que roda num contêiner próprio na VPS:

- `POST /api` — o site envia cada visita e cada clique em botão de WhatsApp
- `GET /api?dias=…` — o painel lê os dados (senha no cabeçalho `Authorization: Bearer …`)
- `GET /adm` — o painel (gerado por `_modelo/build.ps1` a partir de `_modelo/painel.html`)

Dados ficam em `dados/eventos.ndjson` (uma linha por evento). Nada pessoal é guardado (nem IP).

## Como está instalado (VPS 187.77.58.31)

- Pasta: `/opt/jf-monitor` — senha do painel em `/opt/jf-monitor/.env` (`SENHA_PAINEL`).
- Contêiner `jf-monitor` na rede `aviks_sites`, que só tem o Caddy e os sites. Ele **não** alcança o banco nem a API do Aviks.
- DNS: registro **A** `painel` → `187.77.58.31` no registro.br.
- O bloco `painel.julianafelix.com.br` fica **no código do Aviks** (`deploy/Caddyfile`, commit 9cbc422). Não edite o Caddyfile direto
  no servidor: ele é versionado e o próximo deploy do Aviks quebraria ou apagaria a mudança.

## Localização (cidade/estado)

`geo.js` consulta a base gratuita **DB-IP IP to City Lite** (CC BY 4.0, ~130 MB) em `geo/dbip-city-lite.mmdb`.
Baixe/atualize com `bash atualizar-geo.sh` (o `instalar.sh` já baixa na primeira vez). O IP é usado só na hora e não é
guardado. Sem o arquivo, o monitor funciona normalmente, só sem localização. A precisão é de cidade e falha às vezes
no 4G (a operadora pode aparecer como outra cidade).

## Palavra pesquisada no Google

O site guarda `utm_term` da URL. No Google Ads, use como sufixo do URL final da campanha:
`utm_source=google&utm_medium=cpc&utm_term={keyword}`.

## Ícone do app

`build.ps1` gera `public/icone-192.png`, `icone-512.png`, `apple-touch-icon.png` e `manifest.webmanifest` a partir da
logo e das cores do `cliente.json`. No celular: abrir `/adm` → “Adicionar à tela de início”.

## Atualizar

- **Painel:** gere de novo (`build.ps1`) e copie `public/adm.html` para `/opt/jf-monitor/public/`. Não precisa reiniciar nada.
- **server.js:** copie para `/opt/jf-monitor/` e rode `bash instalar.sh` (só recria o `jf-monitor`).

## Desinstalar

`docker compose down` na pasta e remova o bloco `painel.julianafelix.com.br` do Caddyfile no repositório do Aviks (e publique).

## Não contar os próprios acessos

Abra o site uma vez com `?naocontar` no fim do endereço (vale para aquele navegador).
