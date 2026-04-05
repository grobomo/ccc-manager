FROM node:20-slim

WORKDIR /app

# Run as non-root for security (K8s runAsNonRoot enforcement)
RUN groupadd -r ccc && useradd -r -g ccc -d /app ccc \
    && mkdir -p /app/state /app/bridge \
    && chown -R ccc:ccc /app

COPY --chown=ccc:ccc package.json ./
COPY --chown=ccc:ccc src/ ./src/
COPY --chown=ccc:ccc config/example.yaml ./config/
COPY --chown=ccc:ccc scripts/demo.js scripts/healthcheck.js ./scripts/

# No npm install needed — zero dependencies

USER ccc

ENTRYPOINT ["node", "src/index.js"]
CMD ["config/example.yaml"]
