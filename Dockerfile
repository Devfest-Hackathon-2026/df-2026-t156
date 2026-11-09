FROM node:22-alpine
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/index.js server/game.js server/station-use.js server/static.js server/valley.js server/motion.js server/melee.js server/crossbow.js server/stream.js server/scenery-shape.js server/scenery-mining.js ./
COPY server/scenery-rock.json ./scenery-rock.json
COPY valley.json ./valley.json
COPY build-web/ ./public/
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/public VALLEY_PATH=/app/valley.json
USER node
EXPOSE 8080
CMD ["node", "index.js"]
