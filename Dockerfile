FROM node:22-slim

ARG SOURCE_COMMIT
ARG RELEASE_VERSION

LABEL org.opencontainers.image.source="https://github.com/tangtianshuo/cms" \
    org.opencontainers.image.revision="${SOURCE_COMMIT}" \
    org.opencontainers.image.version="${RELEASE_VERSION}"

WORKDIR /app

RUN apt-get -o Acquire::Retries=8 update \
    && apt-get -o Acquire::Retries=8 install --no-install-recommends -y ffmpeg zip unzip \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci --prefix backend --ignore-scripts

COPY ui/package.json ui/package-lock.json ./ui/
RUN npm ci --prefix ui --ignore-scripts

COPY . /app

RUN npm run build:ui \
    && npm run build:backend \
    && rm -rf _scripts node_modules cli client proxy ui/public ui/node_modules ui/src backend/plugins

WORKDIR /app/backend

ENTRYPOINT ["npm", "run", "start"]
