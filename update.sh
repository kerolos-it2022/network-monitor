#!/bin/bash
# update.sh: سكريبت تحديث المشروع من GitHub
# الاستخدام: ./update.sh [branch]
# المتغيرات البيئية:
#   AUTO_UPDATE=true   تخطي التأكيد التفاعلي (للـ CI/CD)
#   SKIP_BUILD=false   تخطي خطوة البناء

set -e  # إيقاف عند أي خطأ

# الألوان للإخراج (تعطّل تلقائياً إن لم يكن طرفية تدعم ANSI)
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    NC='\033[0m' # No Color
else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; NC=''
fi

# الإعدادات
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANCH="${1:-main}"
PM2_APP_NAME="network-monitor"
GITHUB_REPO="https://github.com/kerolos-it2022/network-monitor.git"
STASHED=false

# دالة للإخراج الملون
log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# ===== دالة التنظيف: تسترجع الـ stash عند أي فشل/إيقاف =====
cleanup() {
    local exit_code=$?
    if [ "$STASHED" = true ]; then
        echo ""
        if [ $exit_code -ne 0 ]; then
            log_warning "تم إيقاف السكريبت ($exit_code). محاولة استرجاع التغييرات المحلية..."
        else
            log_info "استرجاع التغييرات المحلية..."
        fi
        cd "$REPO_DIR" 2>/dev/null || true
        # pop بـ keep stash لو تعارض: لا نريد أن يفقد المستخدم البيانات
        if git stash pop; then
            STASHED=false
            log_success "تم استرجاع التغييرات المحلية"
        else
            log_error "تعذر استرجاع الـ stash! التغييرات لا تزال محفوظة في: git stash list"
            git stash list
        fi
    fi
    exit $exit_code
}
trap cleanup EXIT INT TERM

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  تحديث نظام مراقبة الشبكة من GitHub${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# التحقق من أننا في مستودع Git
if [ ! -d "$REPO_DIR/.git" ]; then
    log_error "خطأ: هذا ليس مستودع Git!"
    exit 1
fi

# التحقق من أن HEAD ليس في حالة detached
HEAD_REF="$(git symbolic-ref -q HEAD || true)"
if [ -z "$HEAD_REF" ]; then
    log_error "أنت في حالة 'detached HEAD'. القفز إلى فرع أولاً قبل التحديث:"
    log_error "  git checkout $BRANCH"
    exit 1
fi

# التحقق من وجود pm2 (نُحذّر لكن لا نوقف — قد يريد المستخدم تحديث الكود فقط)
if ! command -v pm2 >/dev/null 2>&1; then
    log_warning "PM2 غير مثبت في PATH! خطوة إعادة التشغيل ستفشل لاحقاً."
    log_warning "ثبّته بـ: npm install -g pm2"
    PM2_AVAILABLE=false
else
    PM2_AVAILABLE=true
fi

# 1. التحقق من وجود تغييرات غير محفوظة
log_info "التحقق من التغييرات المحلية..."
if [ -n "$(git status --porcelain)" ]; then
    log_warning "يوجد تغييرات محلية غير محفوظة. سيتم حفظها في stash..."
    git stash push -m "auto-stash-before-update-$(date +%Y%m%d-%H%M%S)"
    STASHED=true
fi

# 2. جلب أحدث التغييرات من GitHub
log_info "جلب أحدث التغييرات من GitHub (branch: $BRANCH)..."
git fetch origin

# التحقق من وجود فرع الهدف
if ! git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
    log_error "الفرع '$BRANCH' غير موجود في المستودع البعيد!"
    exit 1
fi

# 3. التحقق من الإصدار الحالي مقابل الأحدث
CURRENT_COMMIT=$(git rev-parse HEAD)
# قطع قيمة الفرع البعيد لتجنّب مشاكل المسافات/Git hooks
LATEST_COMMIT=$(git rev-parse "origin/$BRANCH")

if [ "$CURRENT_COMMIT" = "$LATEST_COMMIT" ]; then
    log_success "أنت بالفعل على أحدث إصدار! ($CURRENT_COMMIT)"
    exit 0
fi

log_info "إصدار جديد متاح!"
log_info "الحالي:  $CURRENT_COMMIT"
log_info "الجديد:  $LATEST_COMMIT"

# عرض ملخص التغييرات
log_info "التغييرات الجديدة:"
git log --oneline --graph --decorate "${CURRENT_COMMIT}..${LATEST_COMMIT}" | head -20

# 4. تأكيد التحديث (في الوضع التفاعلي فقط)
if [ -t 0 ] && [ "${AUTO_UPDATE:-false}" != "true" ]; then
    read -p "هل تريد المتابعة بالتحديث؟ (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_warning "تم إلغاء التحديث."
        exit 0
    fi
fi

# 5. تنفيذ التحديث (pull يطابق الفرع البعيد)
log_info "سحب أحدث التغييرات..."
if ! git pull origin "$BRANCH"; then
    log_error "فشل git pull — قد يكون هناك تعارض merge."
    log_error "حلّ التعارض يدوياً: git status، ثم: git merge --continue أو git merge --abort"
    exit 1
fi

# 6. تحديث التبعيات (تثبيت الإنتاج فقط، مع omit devDeps)
log_info "تحديث تبعيات Node.js (backend)..."
cd "$REPO_DIR/backend"
# --omit=dev هي البديل المدعوم في npm الحديث (بدل --production المُلغى)
if ! npm ci --omit=dev 2>&1 | tail -5; then
    log_error "فشل npm ci. حاول يدوياً: cd backend && npm install"
    exit 1
fi

# 7. إعادة بناء الملفات إذا لزم الأمر (ينظر لـ package.json في الجذر — للواجهة الأمامية)
cd "$REPO_DIR"
if [ -f "package.json" ] && grep -q '"build"' package.json; then
    log_info "بناء المشروع (frontend) من جذر المشروع..."
    if ! npm run build; then
        log_error "فشل أمر البناء."
        exit 1
    fi
else
    log_info "لا توجد خطوة build في جذر المشروع — تخطي البناء."
fi

# 8. إعادة تشغيل PM2
if [ "$PM2_AVAILABLE" = true ]; then
    log_info "إعادة تشغيل التطبيق عبر PM2..."
    # المطابقة الدقيقة للاسم (لا يطابق 'network-monitor-beta' لاسم 'network-monitor')
    if pm2 list 2>/dev/null | awk '{print $2}' | grep -qx "$PM2_APP_NAME"; then
        pm2 restart "$PM2_APP_NAME" --update-env
        log_success "تم إعادة تشغيل $PM2_APP_NAME"
    else
        log_warning "التطبيق غير مسجل في PM2 — يتم تشغيله لأول مرة..."
        if pm2 start ecosystem.config.js --env production; then
            pm2 save
            log_success "تم تشغيل $PM2_APP_NAME وحفظ تكوين PM2"
        else
            log_error "فشل تشغيل التطبيق في PM2."
            exit 1
        fi
    fi
else
    log_warning "تخطي إعادة تشغيل PM2 (غير مثبت). أعد التشغيل يدوياً بعد تثبيت PM2."
fi

# 9. عرض حالة PM2 (إن كان متاحاً)
if [ "$PM2_AVAILABLE" = true ]; then
    log_info "حالة التطبيق:"
    pm2 list
fi

# 10. قراءة المنفذ الفعلي من .env إن وُجد (لعرض الروابط الصحيحة)
CONFIGURED_PORT="$(grep -E '^PORT=' "$REPO_DIR/backend/.env" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || true)"
DISPLAY_PORT="${CONFIGURED_PORT:-4000}"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  تم التحديث بنجاح! ✅${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "الإصدار الجديد: $(git rev-parse --short HEAD)"
echo -e "الفرع: $(git branch --show-current)"
echo ""
echo -e "${BLUE}روابط الوصول:${NC}"
echo -e "  لوحة التحكم: http://localhost:${DISPLAY_PORT}/admin/dashboard.html"
echo -e "  الصفحة العامة: http://localhost:${DISPLAY_PORT}/"
echo ""
