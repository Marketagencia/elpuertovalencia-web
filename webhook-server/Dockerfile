FROM node:20-alpine
WORKDIR /app
COPY webhook-server/package.json .
RUN npm install --production
COPY webhook-server/server.js .
EXPOSE 3000
CMD ["node", "server.js"]
