# =========================================================
# Dockerfile لنظام مراقبة أجهزة الشبكة المحلية
# متعدد المراحل (multi-stage): بناء صورة خفيفة على أساس Node 20 LTS
# =========================================================

# ---- مرحلة 1: قاعدة تعتمد على Node 20 LTS (LTS لأن better-sqlite3 له prebuilt) ----
FROM node:20-bookworm-slim AS base

# تثبيت ما يحتاجه better-sqlite3 في وقت التشغيل (مكتبات C++ أساسية)
# وعلى بناء صورة رسمية Node، prebuilt binaries تعمل مباشرة في الغالب، لكن نثبّت هذه كاحتياط.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# مجلد العمل داخل الحاوية
WORKDIR /app

# نسخ package files أولاً للاستفادة من طبقات Docker (cache) عند npm install
COPY backend/package*.json ./backend/

# تثبيت اعتمادات backend (production only)
RUN cd backend && npm install --omit=dev

# نسخ باقي ملفات المشروع (backend src + frontend + database schema)
COPY backend/src ./backend/src
COPY backend/.env.example ./backend/.env.example
COPY frontend ./frontend
COPY database ./database

# =========================================================
# إعدادات التشغيل
# =========================================================

# منفذ Express
EXPOSE 4000

# مجلد بيانات دائم (سيُربط volume من المضيف لهذا المسار)
# ملف monitoring.db سيُحفظ هنا ليُدوم بعد إعادة بناء الحاوية.
RUN mkdir -p /app/data
ENV DB_PATH=/app/data/monitoring.db

# healthcheck: فحص /api/health كل 30 ثانية
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# تشغيل السيرفر. نضبط cwd إلى backend لأن server.js يستخدم مسارات نسبية.
WORKDIR /app/backend
CMD ["node", "src/server.js"]
