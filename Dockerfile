FROM node:12.12-alpine

RUN apk update && apk upgrade && \
    apk add --no-cache bash git openssh tzdata

WORKDIR /app

COPY lib lib
COPY etc etc
COPY package.json package.json
COPY package-lock.json package-lock.json
COPY app.js app.js
COPY runner.js runner.js

RUN npm i --production

CMD npm start
