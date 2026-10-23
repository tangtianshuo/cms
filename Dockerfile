FROM node:20-slim

WORKDIR /app

COPY . /app

# Install required system packages
RUN apt-get update && apt-get install --no-install-recommends -y ffmpeg zip unzip
# Install dependencies
RUN npm i
RUN npm run build:ui
RUN rm -rf _scripts node_modules cli client proxy ui/public ui/node_modules ui/src backend/plugins

WORKDIR /app/backend

ENTRYPOINT ["npm", "run", "start"]
