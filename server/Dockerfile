FROM node:20-alpine
WORKDIR /app
COPY package.json index.js ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
EXPOSE 8787
USER node
CMD ["node", "index.js"]
