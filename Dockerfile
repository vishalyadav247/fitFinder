FROM node:22-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

COPY package.json package-lock.json* ./

# All dependencies: the build needs vite (dev) and the worker runs with tsx (dev).
RUN npm ci && npm cache clean --force

COPY . .

RUN npm run build

ENV NODE_ENV=production

# Web process. Worker process: same image with the command `npm run worker`
# (or JOBS_INLINE=true to run jobs inside the web process).
CMD ["npm", "run", "docker-start"]
