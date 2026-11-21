#!/usr/bin/env bash
# Instala/atualiza o Aviks Empregos na VPS do Aviks.  Uso (como root, na VPS):
#   git clone https://github.com/jonathas-blip/aviks-empregos /opt/aviks-empregos   (só na primeira vez)
#   cd /opt/aviks-empregos && bash deploy/instalar.sh
set -euo pipefail
cd "$(dirname "$0")/.."

docker network inspect "${REDE_CADDY:-aviks_sites}" >/dev/null 2>&1 \
  || { echo "Rede ${REDE_CADDY:-aviks_sites} não existe: o Aviks (Caddy) precisa estar rodando nesta VPS."; exit 1; }

[ -f .env ] || { cp .env.example .env; chmod 600 .env; echo "Criei .env — preencha (ANTHROPIC_API_KEY, PAINEL_USUARIO, PAINEL_SENHA_HASH, NTFY_TOPICO) e rode de novo."; exit 1; }
grep -q '^PAINEL_SENHA_HASH=scrypt:' .env || { echo "Falta PAINEL_SENHA_HASH no .env. Gere no seu computador com 'npm run criar-senha' e cole aqui."; exit 1; }

mkdir -p dados config
for f in perfil.json curriculo.md curriculo.pdf estilo.md emails.json; do
  [ -f "config/$f" ] || echo "Aviso: falta config/$f (veja os arquivos .exemplo)."
done
[ -f dados/sessao-navegador.json ] || echo "Aviso: falta dados/sessao-navegador.json (rode 'npm run login' no seu computador e copie para cá)."

git pull --ff-only 2>/dev/null || true
docker compose up -d --build
echo "Pronto. Painel: https://empregos.aviks.com.br (depois que o Caddy do Aviks tiver o bloco do deploy/Caddyfile.bloco)."
