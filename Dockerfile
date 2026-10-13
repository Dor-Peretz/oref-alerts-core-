FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY schema ./schema
COPY data ./data
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV OREF_MODE=mock
ENV OREF_HOST=0.0.0.0
ENV OREF_PORT=8080
COPY --from=build /app /app
EXPOSE 8080
USER node
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/cli.js"]
