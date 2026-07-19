#!/usr/bin/env bash
# =========================================================
# deploy.sh — سكريبت نشر نظام مراقبة أجهزة الشبكة على سيرفر Ubuntu
# =========================================================
# الاستخدام:
#   sudo bash deploy.sh            # تثبيت كامل (المتطلبات + Docker + المشروع + تشغيل)
#   sudo bash deploy.sh update     # تحديث بعد سحب كود جديد من git
#   sudo bash deploy.sh logs       # عرض السجلات الحية
#   sudo bash deploy.sh stop       # إيقاف النظام
#   sudo bash deploy.sh restart    # إعادة التشغيل
#   sudo bash deploy.sh status     # حالة الحاوية
#   sudo bash deploy.sh uninstall  # حذف الحاوية (البيانات تبقى في volume)
# =========================================================
set -uo pipefail

# ---- إعدادات ----
PROJECT_DIR="${PROJECT_DIR:-/opt/network-monitor}"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"

# ألوان لإخراج أوضح
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1" >&2; }

# التأكد من تشغيل السكريبت بـ root
if [[ $EUID -ne 0 ]]; then
    error "يجب تشغيل هذا السكريبت بصلاحية root. استخدم: sudo bash deploy.sh"
    exit 1
fi

export DEBIAN_FRONTEND=noninteractive

# تحدّث فهرس apt بشكل آمن (ما يوقفش السكريبت بالكامل لو فشل)
apt_update_safe() {
    log "تحديث فهرس الحزم (apt-get update)..."
    apt-get update -y || warn "تعذّر apt-get update — أكمل المحاولة بالحزم المتاحة."
}

# تثبيت حزمة عبر apt-get بشكل آمن ( لازم apt_update_safe قبلها)
apt_install_safe() {
    local pkgs=("$@")
    log "تثبيت: ${pkgs[*]}"
    if apt-get install -y --no-install-recommends "${pkgs[@]}"; then
        log "تم تثبيت الحزم."
    else
        error "فشل تثبيت الحزم: ${pkgs[*]}"
        return 1
    fi
}

# =========================================================
# ضمان وجود الأدوات الأساسية قبل أي خطوة
# =========================================================
ensure_prerequisites() {
    local need=()
    command -v curl    &> /dev/null || need+=(curl)
    command -v openssl &> /dev/null || need+=(openssl)
    command -v gpg    &> /dev/null || need+=(gnupg)
    command -v apt-get &> /dev/null || { error "apt-get غير موجود — هذا السكريبت لـ Ubuntu/Debian فقط."; exit 1; }
    [[ -d /usr/share/doc/ca-certificates ]] || need+=(ca-certificates)

    apt_update_safe

    if [[ ${#need[@]} -gt 0 ]]; then
        apt_install_safe "${need[@]}" || { error "تعذّر تثبيت المتطلبات الأساسية."; exit 1; }
    else
        log "المتطلبات الأساسية (curl, openssl, gnupg, ca-certificates) موجودة."
    fi
}

# =========================================================
# تثبيت Docker و Docker Compose على طريقة apt الرسمية
# =========================================================
install_docker() {
    if command -v docker &> /dev/null; then
        log "Docker مثبّت مسبقاً: $(docker --version)"
    else
        log "تثبيت Docker عبر المستودع الرسمي..."

        apt_update_safe

        # الحزم الأساسية لإضافة مستودع موقّع
        local repo_pkgs=(ca-certificates curl gnupg lsb-release)
        command -v gpg &> /dev/null || repo_pkgs+=(gnupg)
        apt_install_safe "${repo_pkgs[@]}" || { error "تعذّر تثبيت حزم المستودع."; exit 1; }

        # مجلد المفاتيح (طريقة Docker الرسمية 2024+)
        install -m 0755 -d /etc/apt/keyrings

        # تنزيل وتسجيل مفتاح GPG
        if ! curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg; then
            error "تعذّر تنزيل مفتاح GPG الخاص بـ Docker."
            exit 1
        fi
        chmod a+r /etc/apt/keyrings/docker.gpg

        # تحديد الإصدار والمعمارية
        local codename arch
        codename="$(. /etc/os-release && echo "${VERSION_CODENAME:-}")"
        if [[ -z "$codename" ]]; then
            codename="$(lsb_release -cs 2>/dev/null || echo stable)"
            warn "تعذّر اكتشاف VERSION_CODENAME، استخدام: $codename"
        fi
        arch="$(dpkg --print-architecture 2>/dev/null || echo amd64)"

        local repo_line="deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${codename} stable"
        echo "$repo_line" > /etc/apt/sources.list.d/docker.list
        log "تم إضافة مستودع Docker: $repo_line"

        apt_update_safe
        if ! apt_install_safe docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; then
            error "تعذّر تثبيت Docker. حاول يدوياً: apt-get install docker-ce docker-ce-cli containerd.io docker-compose-plugin"
            exit 1
        fi

        systemctl enable docker
        systemctl start docker
        log "تم تثبيت Docker."
    fi

    # التأكد من Docker Compose (plugin v2)
    if docker compose version &> /dev/null; then
        log "Docker Compose متاح: $(docker compose version)"
    else
        warn "Docker Compose غير متاح، محاولة تثبيته..."
        apt_install_safe docker-compose-plugin \
            && log "تم تثبيت docker-compose-plugin." \
            || { error "Docker Compose غير متاح. ثبّته يدوياً: apt-get install docker-compose-plugin"; exit 1; }
    fi
}

# =========================================================
# إعداد ملف .env على السيرفر إن لم يوجد
# =========================================================
setup_env() {
    local env_file="$PROJECT_DIR/backend/.env"
    if [[ -f "$env_file" ]]; then
        log "ملف backend/.env موجود."
        return
    fi
    warn "إنشاء backend/.env من .env.example — عدّله لاحقاً بقيم سرية حقيقية."

    if [[ -f "$PROJECT_DIR/backend/.env.example" ]]; then
        cp "$PROJECT_DIR/backend/.env.example" "$env_file"
    else
        warn "backend/.env.example غير موجود — إنشاء ملف .env بسيط."
        {
            echo "# أُنشئ تلقائياً بواسطة deploy.sh — عدّله بقيمك الحقيقية"
            echo "SESSION_SECRET=REPLACE_ME"
            echo "DEFAULT_ADMIN_PASSWORD=REPLACE_ME"
            echo "DB_PATH=/app/data/database.db"
        } > "$env_file"
    fi

    # توليد SESSION_SECRET عشوائي
    local secret
    if command -v openssl &> /dev/null; then
        secret=$(openssl rand -hex 32)
    else
        secret=$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 64)
    fi
    sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$secret|g" "$env_file"
    log "تم توليد SESSION_SECRET عشوائي وتخزينه في backend/.env"
    warn "تذكير: عدّل DEFAULT_ADMIN_PASSWORD في backend/.env إلى كلمة مرور قوية!"
}

# =========================================================
# العمليات الرئيسية
# =========================================================
case "${1:-install}" in

    install)
        log "بدء تثبيت نظام مراقبة أجهزة الشبكة..."
        ensure_prerequisites
        install_docker

        # لو السكريبت في مجلد المشروع (الحالة الطبيعية)، فPROJECT_DIR هو مجلد السكريبت
        SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        if [[ "$SCRIPT_DIR" != "$PROJECT_DIR" ]] && [[ -f "$SCRIPT_DIR/docker-compose.yml" ]]; then
            PROJECT_DIR="$SCRIPT_DIR"
            COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"
            log "استخدام مجلد المشروع: $PROJECT_DIR"
        fi

        setup_env

        log "بناء الصورة وتشغيل الحاوية..."
        cd "$PROJECT_DIR"
        docker compose --env-file "$PROJECT_DIR/backend/.env" up -d --build

        log "تهيئة قاعدة البيانات وإنشاء حساب المدير الافتراضي..."
        docker exec network-monitor sh -c '
            cd /app/backend &&
            node -e "const db=require(\"better-sqlite3\")(process.env.DB_PATH); const fs=require(\"fs\"); db.exec(fs.readFileSync(\"../database/schema.sql\",\"utf-8\")); console.log(\"schema OK\"); db.close();" 2>/dev/null || echo "schema may already exist"
        ' || warn "تعذّر تشغيل تهيئة قاعدة البيانات (ربما موجودة مسبقاً)"

        docker exec network-monitor sh -c 'cd /app/backend && node src/seedAdmin.js' || warn "seedAdmin قد يكون قد شُغّل مسبقاً"

        log "============================================"
        log "تم النشر بنجاح!"
        log "النظام يعمل على: http://$(hostname -I | awk '{print $1}'):4000"
        log "صفحة الدخول:     http://localhost:4000/admin/login.html"
        log "البيانات الافتراضية للمدير موجودة في: $PROJECT_DIR/backend/.env"
        log "لعرض السجلات:    sudo bash deploy.sh logs"
        log "============================================"
        ;;

    update)
        log "تحديث المشروع: إعادة بناء الصورة وإعادة تشغيل الحاوية..."
        cd "$PROJECT_DIR"
        docker compose --env-file "$PROJECT_DIR/backend/.env" up -d --build
        log "تم التحديث. البيانات محفوظة في volume."
        ;;

    logs)
        log "عرض سجلات الحاوية (Ctrl+C للخروج)..."
        docker compose -f "$COMPOSE_FILE" logs -f
        ;;

    stop)
        log "إيقاف النظام..."
        docker compose -f "$COMPOSE_FILE" stop
        log "تم الإيقاف."
        ;;

    restart)
        log "إعادة تشغيل النظام..."
        docker compose -f "$COMPOSE_FILE" restart
        log "تمت إعادة التشغيل."
        ;;

    status)
        docker compose -f "$COMPOSE_FILE" ps
        echo ""
        docker compose -f "$COMPOSE_FILE" logs --tail=20
        ;;

    uninstall)
        warn "سيتم حذف الحاوية والصورة. البيانات ستبقى في volume (nm-data)."
        read -p "هل أنت متأكد؟ (y/N) " confirm
        if [[ "$confirm" == "y" || "$confirm" == "Y" ]]; then
            docker compose -f "$COMPOSE_FILE" down --rmi local
            log "تم الحذف. لإزالة البيانات أيضاً نفّذ: docker volume rm network-monitor_nm-data"
        else
            log "تم الإلغاء."
        fi
        ;;

    *)
        echo "استخدام: sudo bash deploy.sh [install|update|logs|stop|restart|status|uninstall]"
        echo ""
        echo "  install    — تثبيت كامل (افتراضي)"
        echo "  update     — إعادة بناء بعد git pull"
        echo "  logs       — عرض السجلات الحية"
        echo "  stop       — إيقاف النظام"
        echo "  restart    — إعادة التشغيل"
        echo "  status     — حالة الحاوية + آخر السجلات"
        echo "  uninstall  — حذف الحاوية والصورة (البيانات تبقى)"
        exit 1
        ;;
esac
