# One image for both services: `npm start` runs the web app, `npm run worker` runs the worker.
FROM node:22-bookworm-slim

# ffmpeg (Debian's build includes libass, needed for burned-in captions), and yt-dlp for the
# YouTube clip pipeline. yt-dlp ships as a Python zipapp, so it needs python3.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl \
  && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
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
