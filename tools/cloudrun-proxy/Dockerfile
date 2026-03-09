FROM node:20-slim
WORKDIR /app
COPY index.js .
EXPOSE 8080
CMD ["node", "--max-old-space-size=64", "index.js"]
