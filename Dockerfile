FROM oven/bun:1 AS deps
WORKDIR /app
# Bun 1.x emits a text `bun.lock`; older builds wrote `bun.lockb` (binary).
# Glob both so this image works regardless of which lockfile the contributor
# committed.
COPY package.json bun.lock* bun.lockb* ./
COPY packages ./packages
RUN bun install --frozen-lockfile || bun install

FROM oven/bun:1 AS build
WORKDIR /app
COPY --from=deps /app /app
RUN bun --cwd packages/types run build
RUN bun --cwd packages/core run build
RUN bun --cwd packages/themes run build
RUN bun --cwd packages/github-contrib run build
RUN bun --cwd packages/svg-creator run build
RUN bun --cwd packages/api run build

FROM oven/bun:1 AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/packages /app/packages
COPY --from=deps /app/node_modules /app/node_modules
COPY package.json /app/package.json
EXPOSE 3000
CMD ["bun", "--cwd", "packages/api", "run", "start"]

