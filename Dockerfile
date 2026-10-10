FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV GEVENTS_BACKEND_MODE=firebase
ENV GEVENTS_API_HOST=0.0.0.0
EXPOSE 8080
CMD ["node", "--import", "tsx", "server/index.ts"]
