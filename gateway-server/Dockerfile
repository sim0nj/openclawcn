FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm i --omit=dev || npm i --legacy-peer-deps --omit=dev
COPY server.js ./
EXPOSE 3200
CMD ["node", "server.js"]
