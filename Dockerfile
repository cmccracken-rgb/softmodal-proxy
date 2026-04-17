FROM mcr.microsoft.com/playwright:v1.47.2-jammy

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

# 👇 THIS IS THE IMPORTANT LINE
RUN npx playwright install --with-deps

COPY src ./src

EXPOSE 3000

CMD ["node", "src/server.js"]
