# Most reliable way to run Playwright/Chromium in the cloud: use the official
# Playwright image which already has Chromium + all system libraries installed.
# Both Railway and Render can deploy from a Dockerfile.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
