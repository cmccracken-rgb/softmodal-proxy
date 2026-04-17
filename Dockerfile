# Use the official Playwright image (includes all browser deps)
FROM mcr.microsoft.com/playwright:v1.47.2-jammy
 
WORKDIR /app
 
# Copy manifest first for better layer caching
COPY package.json package-lock.json* ./
 
# Install only production deps
RUN npm install --omit=dev
 
# Install Chromium browser binaries (deps already in the base image)
RUN npx playwright install chromium
 
# Copy source
COPY src ./src
 
EXPOSE 3000
 
CMD ["node", "src/server.js"]
 
