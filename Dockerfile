# One image for both services: `npm start` runs the web app, `npm run worker` runs the worker.
FROM node:22-bookworm-slim

# ffmpeg renders local-engine videos (Debian's build includes libass, needed for burned-in captions).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
EXPOSE 3000
CMD ["npm", "start"]
