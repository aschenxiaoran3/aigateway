FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY src ./src

ENV NODE_ENV=production
ENV PORT=3104

EXPOSE 3104

CMD ["npm", "start"]
