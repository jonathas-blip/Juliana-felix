#!/bin/bash
# Baixa/atualiza a base gratuita de localização por IP (DB-IP "IP to City Lite", CC BY 4.0, ~130 MB).
# A DB-IP publica uma versão nova todo mês. Rodar na VPS, nesta pasta:  bash atualizar-geo.sh
# Para atualizar sozinho todo dia 5:  (crontab -l; echo "0 4 5 * * cd $(pwd) && bash atualizar-geo.sh") | crontab -
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p geo
MES=$(date +%Y-%m)
URL="https://download.db-ip.com/free/dbip-city-lite-$MES.mmdb.gz"
curl -fsSL "$URL" -o geo/novo.mmdb.gz || { MES=$(date -d '-1 month' +%Y-%m); curl -fsSL "https://download.db-ip.com/free/dbip-city-lite-$MES.mmdb.gz" -o geo/novo.mmdb.gz; }
gunzip -f geo/novo.mmdb.gz
mv -f geo/novo.mmdb geo/dbip-city-lite.mmdb
echo "Base de localização atualizada ($MES): $(du -h geo/dbip-city-lite.mmdb | cut -f1)"
docker restart jf-monitor >/dev/null 2>&1 && echo "jf-monitor reiniciado" || true
