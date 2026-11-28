FROM node:22-alpine
WORKDIR /app
COPY package.json LICENSE ./
COPY relay ./relay
COPY src ./src
COPY bin ./bin
ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0
VOLUME ["/data"]
ENV CONSTELLATION_RELAY_DATA=/data
EXPOSE 8787
CMD ["node", "relay/relay-server.mjs"]
