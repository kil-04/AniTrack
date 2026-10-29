FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb xauth tini ca-certificates libnss3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libasound2 libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/anitrack
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/desktop/main ./apps/desktop/main
COPY apps/source-service ./apps/source-service
COPY packages ./packages
COPY automation/remote-config.json automation/remote-config.sig ./automation/
COPY apps/android/app/src/main/assets/anichan_page.js ./apps/android/app/src/main/assets/anichan_page.js
COPY apps/android/app/src/main/assets/toonkotsu_page.js ./apps/android/app/src/main/assets/toonkotsu_page.js
RUN node node_modules/typescript/bin/tsc -p apps/source-service/tsconfig.json \
    && cp apps/source-service/service.package.json package.json \
    && chown root:root node_modules/electron/dist/chrome-sandbox \
    && chmod 4755 node_modules/electron/dist/chrome-sandbox
ENV NODE_ENV=production SOURCE_PROFILE_DIR=/data/profile PORT=8080
RUN mkdir -p /data/profile && chown -R node:node /data
USER node
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["xvfb-run", "-a", "--server-args=-screen 0 1280x900x24 -nolisten tcp", "node_modules/.bin/electron", "."]
