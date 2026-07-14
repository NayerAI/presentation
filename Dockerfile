FROM node:22-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Application source.
COPY server.js ./
COPY public ./public

# All persistent data (metadata + uploaded PDFs) is written here. In
# docker-compose this path is bind-mounted to ./data on the host.
ENV DATA_DIR=/data
ENV PORT=8000
RUN mkdir -p /data

EXPOSE 8000
CMD ["node", "server.js"]
