FROM node:20-slim

WORKDIR /app

# Install required system packages
RUN apt-get -o Acquire::Retries=8 update \
    && apt-get -o Acquire::Retries=8 install --no-install-recommends -y ffmpeg zip unzip \
    && rm -rf /var/lib/apt/lists/*

COPY . /app

# Install dependencies
RUN npm i
RUN npm run build:ui
RUN npm run build:backend
RUN rm -rf _scripts node_modules cli client proxy ui/public ui/node_modules ui/src backend/plugins

WORKDIR /app/backend

ENTRYPOINT ["npm", "run", "start"]
