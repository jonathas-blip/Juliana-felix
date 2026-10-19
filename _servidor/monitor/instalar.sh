#!/bin/bash
# Instala/atualiza o monitor na VPS, sem tocar nos contêineres do Aviks.
# Rodar na VPS a partir desta pasta (ex.: /opt/jf-monitor):  bash instalar.sh
# Pré-requisito: registro DNS "painel.julianafelix.com.br" do tipo A apontando para o IP da VPS.
set -euo pipefail

DOMINIO="${DOMINIO:-painel.julianafelix.com.br}"
CADDY="${CADDY:-aviks-caddy-1}"
cd "$(dirname "$0")"

# 1) Senha do painel (gerada uma vez, guardada em .env)
if [ ! -f .env ]; then
  SENHA=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16)
  printf 'SENHA_PAINEL=%s\n' "$SENHA" > .env
  chmod 600 .env
  echo "Senha do painel criada: $SENHA  (guarde; está em $(pwd)/.env)"
fi
mkdir -p dados

# 2) Descobre a rede do Caddy e sobe o contêiner do monitor nela
REDE=$(docker inspect "$CADDY" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' | awk '{print $1}')
echo "Rede do Caddy: $REDE"
grep -q '^REDE_CADDY=' .env || printf 'REDE_CADDY=%s\n' "$REDE" >> .env
docker compose up -d
sleep 2
docker exec jf-monitor wget -qO- http://localhost:8080/saude && echo " ← monitor no ar"

# 3) Acrescenta o domínio no Caddyfile do Aviks (só se ainda não existir) e recarrega sem derrubar nada
CF=$(docker inspect "$CADDY" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')
if [ -z "$CF" ]; then echo "Não achei o Caddyfile montado no $CADDY — adicione o bloco manualmente (ver LEIA-ME.md)"; exit 1; fi
if ! grep -q "$DOMINIO" "$CF"; then
  cp "$CF" "$CF.bak-$(date +%Y%m%d%H%M%S)"
  printf '\n# Monitor do site da Juliana Felix (adicionado por _servidor/monitor/instalar.sh)\n%s {\n\tencode gzip\n\treverse_proxy jf-monitor:8080\n}\n' "$DOMINIO" >> "$CF"
fi
docker exec "$CADDY" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec "$CADDY" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
echo "Pronto: https://$DOMINIO/adm"
