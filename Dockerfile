# --- 1. Estágio de Build ---
# Usa uma imagem Node.js 18 "alpine" (leve)
FROM node:18-alpine AS builder

# Define o diretório de trabalho
WORKDIR /usr/src/app

# Copia os ficheiros de dependência
COPY package*.json ./

# Instala as dependências
RUN npm install

# Copia todo o resto do código
COPY . .

# Gera o Prisma Client (essencial!)
RUN npx prisma generate

# Constrói a aplicação (compila o TypeScript)
RUN npm run build

# --- 2. Estágio de Produção ---
# Começa de uma imagem limpa
FROM node:18-alpine
WORKDIR /usr/src/app

# Copia apenas os ficheiros necessários da etapa de build
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/prisma ./prisma
COPY package*.json ./

# Expõe a porta que a sua app usa (definida no .env ou 3000 por defeito)
EXPOSE 3000

# O comando para iniciar a aplicação
# (Vamos sobrepor isto no Railway para incluir as migrações)
CMD ["node", "main"]