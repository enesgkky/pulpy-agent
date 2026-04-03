FROM node:22-alpine AS base

WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# Build
FROM deps AS build
COPY . .
RUN npm run build

# Production
FROM base AS production
ENV NODE_ENV=production

# Install Python and data processing libraries for agent skills
RUN apk add --no-cache python3 py3-pip && \
    python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir \
      pandas openpyxl xlsxwriter \
      pdfplumber pypdf reportlab \
      pytesseract pdf2image

ENV PATH="/opt/venv/bin:$PATH"

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/skills ./skills
COPY package.json ./

EXPOSE ${PORT:-4000}

CMD ["node", "dist/main"]
