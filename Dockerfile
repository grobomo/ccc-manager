FROM node:20-slim

WORKDIR /app

COPY package.json ./
COPY src/ ./src/
COPY config/ ./config/
COPY scripts/ ./scripts/

# No npm install needed — zero dependencies

ENTRYPOINT ["node", "src/index.js"]
CMD ["config/example.yaml"]
