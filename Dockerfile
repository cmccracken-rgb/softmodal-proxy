# Playwright provides an official image with Chromium + all deps preinstalled
FROM mcr.microsoft.com/playwright:v1.47.2-jammy

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

EXPOSE 3000
CMD ["node", "src/server.js"]
