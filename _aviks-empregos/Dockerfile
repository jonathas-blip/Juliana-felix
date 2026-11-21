# Para rodar 24 h numa VPS (ex.: a mesma do monitor). No seu computador não precisa de Docker: use npm start.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npx playwright install --with-deps chromium
COPY src ./src
COPY public ./public
ENV DATA_DIR=/data NAVEGADOR_VISIVEL=0
CMD ["node", "--no-warnings=ExperimentalWarning", "src/servidor.js"]
