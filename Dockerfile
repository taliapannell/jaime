# The ETI hosting platform uses this instead of its generated Dockerfile, whose default
# `npm start` path serves dist/ statically and so never answers POST /api/recipes or /api/recipe-image.
FROM public.ecr.aws/docker/library/node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "dist-server/index.mjs"]
