FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY src ./src

ENV NODE_ENV=production
ENV EGRESS_PROXY_PORT=8899

EXPOSE 8899

CMD ["npm", "start"]
