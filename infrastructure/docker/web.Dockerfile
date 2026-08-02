FROM node:26.5.0-alpine3.23 AS dependencies
WORKDIR /app
RUN apk add --no-cache bash coreutils
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM dependencies AS build
COPY . .
ARG NEXT_PUBLIC_API_BASE_URL=/api
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
RUN npm run build

FROM node:26.5.0-alpine3.23 AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup --system --gid 10001 app && adduser --system --uid 10001 --ingroup app app
COPY --from=build --chown=app:app /app ./
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
USER app
EXPOSE 3000
CMD ["node", "node_modules/vinext/dist/cli.js", "start"]
