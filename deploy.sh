#!/usr/bin/env bash
# =========================================================
# deploy.sh — سكريبت نشر نظام مراقبة أجهزة الشبكة على أي توزيعة Linux
# =========================================================
# يدعم: Ubuntu/Debian/Mint • RHEL/CentOS/Rocky/Alma/Fedora • Arch/Manjaro • Alpine • openSUSE
#
# الاستخدام:
#   sudo bash deploy.sh install      # تثبيت كامل (الأدوات + Node.js + PM2 + المشروع + تشغيل)
#   sudo bash deploy.sh update       # تحديث بعد سحب كود جديد من git
#   sudo bash deploy.sh logs         # عرض السجلات الحية
#   sudo bash deploy.sh stop         # إيقاف النظام
#   sudo bash deploy.sh restart      # إعادة التشغيل
#   sudo bash deploy.sh status       # حالة العملية
#   sudo bash deploy.sh uninstall    # حذف النظام (البيانات تبقى)
# =========================================================

# استخدام set -e فقط (بدون pipefail لتوافق أفضل مع bash الأقدم)
set -eu

# ---- إعدادات قابلة للتعديل ----
PROJECT_DIR="${PROJECT_DIR:-/opt/network-monitor}"
APP_USER="${APP_USER:-root}"
NODE_REQUIRED="${NODE_REQUIRED:-20}"
PORT="${PORT:-4000}"

# ألوان لإخراج أوضح
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }
info()  { echo -e "${BLUE}[i]${NC} $1"; }

# التأكد من تشغيل السكريبت بصلاحية root
if [[ $EUID -ne 0 ]]; then
    error "يجب تشغيل هذا السكريبت بصلاحية root. استخدم: sudo bash deploy.sh"
    exit 1
fi

# لو السكريبت في مجلد المشروع، ف PROJECT_DIR هو مجلد السكريبت
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/ecosystem.config.js" ]]; then
    PROJECT_DIR="$SCRIPT_DIR"
fi

# =========================================================
# كشف التوزيعة ومدير الحزم المناسب
# يرجع: PACKAGE_MANAGER, OS_FAMILY (debian|rhel|arch|alpine|suse)
# =========================================================
detect_distro() {
    # 1) محاولة /etc/os-release (المعيار الحديث)
    if [[ -f /etc/os-release ]]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        DISTRO_ID="${ID:-}"
        DISTRO_FAMILY="${ID_LIKE:-}"
    else
        DISTRO_ID=""
        DISTRO_FAMILY=""
    fi

    # 2) كشف مباشر بوجود ملفات توزيعات معروفة
    if [[ -f /etc/debian_version ]]; then
        DISTRO_ID="debian"
        DISTRO_FAMILY="debian"
    elif [[ -f /etc/redhat-release ]] || [[ -f /etc/system-release ]]; then
        DISTRO_ID="rhel"
        DISTRO_FAMILY="rhel fedora"
    elif [[ -f /etc/arch-release ]]; then
        DISTRO_ID="arch"
        DISTRO_FAMILY="arch"
    elif [[ -f /etc/alpine-release ]]; then
        DISTRO_ID="alpine"
        DISTRO_FAMILY="alpine"
    elif [[ -f /etc/SuSE-release ]] || [[ -f /etc/SUSE-brand ]]; then
        DISTRO_ID="suse"
        DISTRO_FAMILY="suse sles"
    fi

    # 3) كشف مدير الحزم المتاح فعلياً
    if command -v apt-get &> /dev/null; then
        PACKAGE_MANAGER="apt"
        OS_FAMILY="debian"
    elif command -v dnf &> /dev/null; then
        PACKAGE_MANAGER="dnf"
        OS_FAMILY="rhel"
    elif command -v yum &> /dev/null; then
        PACKAGE_MANAGER="yum"
        OS_FAMILY="rhel"
    elif command -v pacman &> /dev/null; then
        PACKAGE_MANAGER="pacman"
        OS_FAMILY="arch"
    elif command -v apk &> /dev/null; then
        PACKAGE_MANAGER="apk"
        OS_FAMILY="alpine"
    elif command -v zypper &> /dev/null; then
        PACKAGE_MANAGER="zypper"
        OS_FAMILY="suse"
    else
        error "تعذّر كشف مدير الحزم. هذا السكريبت يدعم: apt/dnf/yum/pacman/apk/zypper."
        error "نظامك: ${DISTRO_ID:-unknown} (${DISTRO_FAMILY:-unknown})"
        exit 1
    fi

    info "التوزيعة: ${DISTRO_ID:-unknown} (${DISTRO_FAMILY:-unknown})"
    info "مدير الحزم: $PACKAGE_MANAGER"
    info "عائلة النظام: $OS_FAMILY"
}

# =========================================================
# تحديث الحزم + تثبيت الحزمة (مدخل موحّد لكل المدراء)
# الاستخدام: pkg_install "package_name"
# =========================================================
pkg_update() {
    case "$PACKAGE_MANAGER" in
        apt)      apt-get update -y ;;
        dnf)      dnf check-update || true ;;
        yum)      yum check-update || true ;;
        pacman)   pacman -Sy --noconfirm || true ;;
        apk)      apk update ;;
        zypper)   zypper --non-interactive refresh ;;
    esac
    # على apt نعمل upgrade أيضاً (كما طلب المستخدم)
    if [[ "$PACKAGE_MANAGER" == "apt" ]]; then
        log "تحديث الحزم المثبتة (apt upgrade)..."
        DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" upgrade
    fi
}

pkg_install() {
    local pkgs=("$@")
    case "$PACKAGE_MANAGER" in
        apt)
            DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${pkgs[@]}"
            ;;
        dnf)
            dnf install -y "${pkgs[@]}"
            ;;
        yum)
            yum install -y "${pkgs[@]}"
            ;;
        pacman)
            pacman -S --noconfirm --needed "${pkgs[@]}"
            ;;
        apk)
            apk add --no-cache "${pkgs[@]}"
            ;;
        zypper)
            zypper --non-interactive install "${pkgs[@]}"
            ;;
    esac
}

# =========================================================
# تثبيت أدوات النظام الأساسية (git, curl, ca-certificates, build tools)
# =========================================================
install_system_tools() {
    log "تحديث فهرس الحزم وتحديث النظام..."
    pkg_update

    log "تثبيت الأدوات الأساسية (git, curl, wget, ca-certificates, sudo)..."
    case "$OS_FAMILY" in
        debian)
            pkg_install git curl wget ca-certificates sudo gnupg lsb-release
            ;;
        rhel)
            pkg_install git curl wget ca-certificates sudo gnupg2
            # on RHEL/CentOS قد تحتاج EPEL
            if command -v dnf &> /dev/null; then
                dnf install -y epel-release 2>/dev/null || true
            fi
            ;;
        arch)
            pkg_install git curl wget ca-certificates sudo gnupg
            ;;
        alpine)
            pkg_install git curl wget ca-certificates sudo gnupg bash
            ;;
        suse)
            pkg_install git curl wget ca-certificates sudo gpg2
            ;;
    esac
    log "الأدوات الأساسية مثبّتة."
}

# =========================================================
# تثبيت أدوات البناء (python3, make, g++/gcc) اللازمة لترجمة better-sqlite3
# =========================================================
install_build_tools() {
    log "تثبيت أدوات البناء (python3, make, gcc/g++)..."
    case "$OS_FAMILY" in
        debian)
            pkg_install python3 make g++ build-essential
            ;;
        rhel)
            # مجموعة Development Tools تعطي make + gcc + g++
            pkg_install python3 make gcc gcc-c++
            if command -v dnf &> /dev/null; then
                dnf groupinstall -y "Development Tools" 2>/dev/null || true
            else
                yum groupinstall -y "Development Tools" 2>/dev/null || true
            fi
            ;;
        arch)
            pkg_install python make gcc base-devel
            ;;
        alpine)
            # على Alpine، busybox يوفّر make أحياناً، نثبّت صراحة
            pkg_install python3 make g++ build-base
            ;;
        suse)
            pkg_install python3 make gcc gcc-c++
            zypper --non-interactive install -t pattern devel_basis 2>/dev/null || true
            ;;
    esac
    # تحقق سريع
    if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then
        warn "Python غير متاح — might تحتاجه better-sqlite3. حاول تثبيته يدوياً."
    fi
    if ! command -v make &> /dev/null; then
        warn "make غير متاح — ضروري لبناء better-sqlite3."
    fi
    log "أدوات البناء جاهزة."
}

# =========================================================
# تثبيت sqlite3 CLI (لاستيراد schema.sql)
# =========================================================
install_sqlite_cli() {
    if command -v sqlite3 &> /dev/null; then
        log "sqlite3 CLI متاح."
        return
    fi
    log "تثبيت sqlite3 CLI..."
    case "$OS_FAMILY" in
        debian|alpine) pkg_install sqlite3 ;;
        rhel)          pkg_install sqlite ;;
        arch)          pkg_install sqlite ;;
        suse)          pkg_install sqlite3 ;;
    esac
}

# =========================================================
# تثبيت Node.js عبر NodeSource (Ubuntu/Debian/Fedora/RHEL)
# أو عبر مدير الحزم على الباقي
# =========================================================
install_node() {
    if command -v node &> /dev/null; then
        local current_major
        current_major=$(node -v | sed 's/v//' | cut -d. -f1)
        if (( current_major >= NODE_REQUIRED )); then
            log "Node.js مثبّت: $(node -v) ($(command -v node))"
            return
        else
            warn "Node.js الحالي $(node -v) أقدم من المطلوب ($NODE_REQUIRED). سيتم تثبيت أحدث."
        fi
    fi

    info "تثبيت Node.js $NODE_REQUIRED LTS..."
    case "$OS_FAMILY" in
        debian)
            # NodeSource الرسمي (Ubuntu/Debian)
            apt-get update -y
            apt-get install -y ca-certificates curl gnupg
            mkdir -p /etc/apt/keyrings
            curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
                | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
            echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_REQUIRED.x nodistro main" \
                > /etc/apt/sources.list.d/nodesource.list
            apt-get update -y
            apt-get install -y nodejs
            ;;
        rhel)
            # NodeSource على RHEL/Fedora/CentOS
            curl -fsSL https://rpm.nodesource.com/setup_${NODE_REQUIRED}.x | bash -
            if command -v dnf &> /dev/null; then
                dnf install -y nodejs
            else
                yum install -y nodejs
            fi
            ;;
        arch)
            # Arch غالباً لديه آخر Node، nodejs package يكفي
            pkg_install nodejs npm
            ;;
        alpine)
            # Alpine package يحتوي Node جاهز
            pkg_install nodejs npm
            ;;
        suse)
            # SUSE: نثبّت من مستودع devel:languages:nodejs
            zypper --non-interactive ar -f https://download.opensuse.org/repositories/devel:/languages:/nodejs/openSUSE_Tumbleweed/ nodejs-devel 2>/dev/null || true
            zypper --non-interactive --gpg-auto-import-keys install -y nodejs npm
            ;;
    esac

    if ! command -v node &> /dev/null; then
        error "فشل تثبيت Node.js."
        error "حاول تثبيته يدوياً من https://nodejs.org/en/download/package-manager"
        exit 1
    fi
    log "تم تثبيت Node.js: $(node -v) - npm: $(npm -v)"
}

# =========================================================
# تثبيت PM2 عالمياً (إدارة العمليات في الإنتاج)
# =========================================================
install_pm2() {
    if command -v pm2 &> /dev/null; then
        local pm2_ver
        pm2_ver=$(pm2 --version)
        log "PM2 مثبّت: ${pm2_ver}"
        return
    fi
    log "تثبيت PM2 عالمياً..."
    npm install -g pm2
    log "تم تثبيت PM2: $(pm2 --version)"
}

# =========================================================
# إعداد ملف .env على السيرفر إن لم يوجد
# =========================================================
setup_env() {
    local env_file="$PROJECT_DIR/backend/.env"
    if [[ -f "$env_file" ]]; then
        log "ملف backend/.env موجود."
        # تأكد من ضبط PORT بصورة صحيحة
        if ! grep -q "^PORT=" "$env_file"; then
            echo "PORT=$PORT" >> "$env_file"
        fi
        return
    fi
    if [[ ! -f "$PROJECT_DIR/backend/.env.example" ]]; then
        warn "ملف .env.example غير موجود — سأنشئ .env مباشرة بقيم أساسية."
        cat > "$env_file" <<EOF
PORT=$PORT
SESSION_SECRET=PLACEHOLDER_CHANGE_ME
DB_PATH=../database/monitoring.db

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# WhatsApp
WHATSAPP_API_URL=
WHATSAPP_API_TOKEN=
WHATSAPP_TO_NUMBER=

# حساب المدير الافتراضي
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=ChangeMe123!
EOF
    else
        warn "إنشاء backend/.env من .env.example — عدّله لاحقاً بقيم سرية حقيقية."
        cp "$PROJECT_DIR/backend/.env.example" "$env_file"
        # ضبط PORT
        if ! grep -q "^PORT=" "$env_file"; then
            echo "PORT=$PORT" >> "$env_file"
        fi
    fi

    # توليد SESSION_SECRET عشوائي
    local secret=""
    if command -v openssl &> /dev/null; then
        secret=$(openssl rand -hex 32)
    elif command -v python3 &> /dev/null; then
        secret=$(python3 -c "import secrets; print(secrets.token_hex(32))")
    else
        secret=$(head -c 32 /dev/urandom | base64)
    fi
    if [[ -n "$secret" ]]; then
        # استخدام sed مع محدد مختلف لتجنب مشاكل الشرطة المائلة
        sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$secret|g" "$env_file" 2>/dev/null || \
        sed -i.bak "s|^SESSION_SECRET=.*|SESSION_SECRET=$secret|g" "$env_file"
        log "تم توليد SESSION_SECRET عشوائي وتخزينه في backend/.env"
    fi
    warn "تذكير: عدّل DEFAULT_ADMIN_PASSWORD في backend/.env إلى كلمة مرور قوية!"
}

# =========================================================
# تهيئة قاعدة البيانات + إنشاء حساب المدير الافتراضي
# =========================================================
init_database() {
    log "تهيئة قاعدة البيانات..."
    mkdir -p "$PROJECT_DIR/database"
    install_sqlite_cli

    # تنفيذ المخطط (CREATE TABLE IF NOT EXISTS آمن للتكرار)
    if [[ -f "$PROJECT_DIR/database/schema.sql" ]]; then
        # على Alpine يجب استخدام absolute path لـ sqlite3
        if command -v sqlite3 &> /dev/null; then
            sqlite3 "$PROJECT_DIR/database/monitoring.db" < "$PROJECT_DIR/database/schema.sql" && \
                log "تم تنفيذ schema.sql عبر sqlite3 CLI." || \
                warn "تعذّر تنفيذ schema.sql عبر CLI. سنحاول عبر Node."
        fi
        # تنفيذ احتياطي عبر Node better-sqlite3
        if ! sqlite3 "$PROJECT_DIR/database/monitoring.db" "SELECT 1 FROM device_types LIMIT 1" 2>/dev/null; then
            log "تنفيذ احتياطي للمخطط عبر Node better-sqlite3..."
            (cd "$PROJECT_DIR/backend" && node -e "
                const db = require('better-sqlite3')(process.env.DB_PATH || '../database/monitoring.db');
                const fs = require('fs');
                db.exec(fs.readFileSync('../database/schema.sql', 'utf-8'));
                console.log('schema OK via node');
                db.close();
            ") || warn "تعذّر تهيئة المخطط تماماً — تحقق من السجلات."
        fi
    else
        warn "database/schema.sql غير موجود."
    fi

    log "إنشاء حساب المدير الافتراضي (إن لم يوجد)..."
    (cd "$PROJECT_DIR/backend" && node src/seedAdmin.js) || warn "seedAdmin قد يكون قد شُغّل مسبقاً"
}

# =========================================================
# تثبيت تبعيات المشروع (npm install) مع إعادة بناء better-sqlite3 للنظام المستهدف
# =========================================================
install_project_deps() {
    log "تثبيت حزم الخادم (npm install)..."
    cd "$PROJECT_DIR/backend"
    
    # حذف node_modules و package-lock.json لضمان بناء نظيف
    rm -rf node_modules package-lock.json
    
    # على Alpine قد نحتاج --build-from-source لـ better-sqlite3 إذا لم يوجد prebuilt
    if [[ "$OS_FAMILY" == "alpine" ]]; then
        npm install --omit=dev --build-from-source 2>/dev/null || npm install --omit=dev
    else
        npm install --omit=dev
    fi
    log "تم تثبيت حزم الخادم."
}

# =========================================================
# إنشاء/إصلاح ecosystem.config.js للمسار الصحيح
# =========================================================
fix_ecosystem_config() {
    local ecosystem_file="$PROJECT_DIR/ecosystem.config.js"
    cat > "$ecosystem_file" <<'EOF'
// ecosystem.config.js: إعدادات PM2 لتشغيل خادم المراقبة في الإنتاج.
module.exports = {
  apps: [
    {
      name: 'network-monitor',
      script: './src/server.js',
      cwd: "${PROJECT_DIR}/backend",
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
    },
  ],
};
EOF
    # استبدال المسار الثابت بالمسار الفعلي للمشروع
    sed -i "s|/home/ubuntu/network-monitor_V1|$PROJECT_DIR|g" "$ecosystem_file"
    log "تم تحديث ecosystem.config.js للمسار: $PROJECT_DIR/backend"
}

# =========================================================
# تشغيل/إدارة PM2
# =========================================================
pm2_start() {
    cd "$PROJECT_DIR"
    pm2 delete network-monitor 2>/dev/null || true
    pm2 start ecosystem.config.js
    pm2 save
    # ضمان بدء PM2 مع إقلاع النظام (systemd على الأنظمة الحديثة)
    local startup_cmd
    startup_cmd=$(pm2 startup systemd -u "$APP_USER" --hp "/root" 2>/dev/null | grep -E "^sudo " | head -1)
    if [[ -n "$startup_cmd" ]]; then
        eval "$startup_cmd" 2>/dev/null || true
    else
        pm2 startup systemd 2>/dev/null || true
    fi
    pm2 save
}

# =========================================================
# العمليات الرئيسية
# =========================================================
case "${1:-install}" in

    install)
        log "بدء تثبيت نظام مراقبة أجهزة الشبكة على Linux..."
        detect_distro
        install_system_tools
        install_build_tools
        install_node
        install_pm2
        setup_env

        if [[ ! -d "$PROJECT_DIR/backend" ]]; then
            error "مجلد $PROJECT_DIR/backend غير موجود. تأكد من نسخ المشروع أولاً:"
            error "  git clone <repo-url> $PROJECT_DIR"
            exit 1
        fi

        install_project_deps
        fix_ecosystem_config
        init_database

        log "تشغيل التطبيق عبر PM2..."
        pm2_start

        log "============================================"
        log "تم النشر بنجاح على ($DISTRO_ID)!"
        log "النظام يعمل على: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo localhost):$PORT"
        log "صفحة الدخول:     http://localhost:$PORT/admin/login.html"
        log "البيانات الافتراضية للمدير موجودة في: $PROJECT_DIR/backend/.env"
        log "لعرض السجلات:    sudo bash deploy.sh logs"
        log "============================================"
        ;;

    update)
        log "تحديث المشروع: إعادة تثبيت الحزم وإعادة تشغيل PM2..."
        detect_distro
        cd "$PROJECT_DIR/backend"
        if [[ "$OS_FAMILY" == "alpine" ]]; then
            npm install --omit=dev --build-from-source 2>/dev/null || npm install --omit=dev
        else
            npm install --omit=dev
        fi
        cd "$PROJECT_DIR"
        fix_ecosystem_config
        pm2 restart network-monitor --update-env
        log "تم التحديث. البيانات محفوظة في قاعدة البيانات."
        ;;

    logs)
        log "عرض سجلات PM2 (Ctrl+C للخروج)..."
        cd "$PROJECT_DIR"
        pm2 logs network-monitor
        ;;

    stop)
        log "إيقاف النظام..."
        cd "$PROJECT_DIR"
        pm2 stop network-monitor
        log "تم الإيقاف."
        ;;

    restart)
        log "إعادة تشغيل النظام..."
        cd "$PROJECT_DIR"
        fix_ecosystem_config
        pm2 restart network-monitor --update-env
        log "تمت إعادة التشغيل."
        ;;

    status)
        cd "$PROJECT_DIR"
        pm2 describe network-monitor
        ;;

    uninstall)
        warn "سيتم إيقاف وحذف التطبيق من PM2. قاعدة البيانات ستبقى محفوظة."
        read -p "هل أنت متأكد؟ (y/N) " confirm
        if [[ "$confirm" == "y" || "$confirm" == "Y" ]]; then
            cd "$PROJECT_DIR"
            pm2 delete network-monitor
            pm2 save
            log "تم الحذف من PM2."
            log "قاعدة البيانات محفوظة في: $PROJECT_DIR/database/monitoring.db"
            log "لإزالة PM2 نهائياً: npm uninstall -g pm2"
        else
            log "تم الإلغاء."
        fi
        ;;

    *)
        echo "استخدام: sudo bash deploy.sh [install|update|logs|stop|restart|status|uninstall]"
        echo ""
        echo "  install    — تثبيت كامل (افتراضي): أدوات + Node.js + PM2 + المشروع"
        echo "  update     — إعادة تثبيت الحزم وإعادة التشغيل بعد git pull"
        echo "  logs       — عرض السجلات الحية"
        echo "  stop       — إيقاف النظام"
        echo "  restart    — إعادة التشغيل"
        echo "  status     — حالة العملية"
        echo "  uninstall  — إيقاف وحذف التطبيق من PM2 (البيانات تبقى)"
        echo ""
        echo "الأنظمة المدعومة:"
        echo "  • Debian / Ubuntu / Mint           (apt)"
        echo "  • RHEL / CentOS / Rocky / Alma     (dnf/yum)"
        echo "  • Fedora                           (dnf)"
        echo "  • Arch / Manjaro                   (pacman)"
        echo "  • Alpine                           (apk)"
        echo "  • openSUSE / SLES                  (zypper)"
        exit 1
        ;;
esac