#!/bin/bash
# Instala/atualiza o monitor na VPS, sem tocar nos contêineres do Aviks.
# Rodar na VPS a partir desta pasta (ex.: /opt/jf-monitor):  bash instalar.sh
#
# O domínio painel.julianafelix.com.br já está no Caddyfile do Aviks — que é versionado no git do Aviks
# (commit 9cbc422). NÃO edite o Caddyfile no servidor: o próximo deploy do Aviks quebraria ou apagaria o bloco.
# O monitor fica numa rede só dele com o Caddy (aviks_sites); não enxerga banco nem API do Aviks.
set -euo pipefail
cd "$(dirname "$0")"

REDE="${REDE_CADDY:-aviks_sites}"

# 1) Senha do painel (gerada uma vez, guardada em .env)
if [ ! -f .env ]; then
  SENHA=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16)
  printf 'SENHA_PAINEL=%s\n' "$SENHA" > .env
  chmod 600 .env
  echo "Senha do painel criada e guardada em $(pwd)/.env"
fi
grep -q '^REDE_CADDY=' .env || printf 'REDE_CADDY=%s\n' "$REDE" >> .env
mkdir -p dados

# 2) A rede precisa existir e o Caddy precisa estar nela (isso é feito pelo deploy do Aviks)
docker network inspect "$REDE" >/dev/null 2>&1 || { echo "Rede $REDE não existe — ela é criada pelo deploy do Aviks."; exit 1; }

# 3) Sobe/atualiza o contêiner
docker compose up -d --force-recreate
sleep 2
docker exec jf-monitor wget -qO- http://localhost:8080/saude && echo " ← monitor no ar"
