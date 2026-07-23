#!/bin/bash
# update.sh: سكريبت تحديث المشروع من GitHub
# الاستخدام: ./update.sh [branch]

set -e  # إيقاف عند أي خطأ

# الألوان للإخراج
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# الإعدادات
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANCH="${1:-main}"
PM2_APP_NAME="network-monitor"
GITHUB_REPO="https://github.com/kerolos-it2022/network-monitor.git"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  تحديث نظام مراقبة الشبكة من GitHub${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# التحقق من أننا في مستودع Git
if [ ! -d "$REPO_DIR/.git" ]; then
    echo -e "${RED}خطأ: هذا ليس مستودع Git!${NC}"
    exit 1
fi

# دالة للإخراج الملون
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 1. التحقق من وجود تغييرات غير محفوظة
log_info "التحقق من التغييرات المحلية..."
if [ -n "$(git status --porcelain)" ]; then
    log_warning "يوجد تغييرات محفوظة محلياً. سيتم حفظها في stash..."
    git stash push -m "auto-stash-before-update-$(date +%Y%m%d-%H%M%S)"
    STASHED=true
else
    STASHED=false
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
LATEST_COMMIT=$(git rev-parse origin/$BRANCH)

if [ "$CURRENT_COMMIT" = "$LATEST_COMMIT" ]; then
    log_success "أنت بالفعل على أحدث إصدار! ($CURRENT_COMMIT)"
    
    # استرجاع stash إذا كان موجوداً
    if [ "$STASHED" = true ]; then
        log_info "استرجاع التغييرات المحلية..."
        git stash pop
    fi
    exit 0
fi

log_info "إصدار جديد متاح!"
log_info "الحالي:  $CURRENT_COMMIT"
log_info "الجديد:  $LATEST_COMMIT"

# عرض ملخص التغييرات
log_info "التغييرات الجديدة:"
git log --oneline --graph --decorate $CURRENT_COMMIT..$LATEST_COMMIT | head -20

# 4. تأكيد التحديث (في الوضع التلقائي نتخطى التأكيد)
if [ -t 0 ] && [ "${AUTO_UPDATE:-false}" != "true" ]; then
    read -p "هل تريد المتابعة بالتحديث؟ (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_warning "تم إلغاء التحديث."
        if [ "$STASHED" = true ]; then
            git stash pop
        fi
        exit 0
    fi
fi

# 4. تنفيذ التحديث
log_info "سحب أحدث التغييرات..."
git pull origin $BRANCH

# 5. تحديث التبعيات
log_info "تحديث تبعيات Node.js (backend)..."
cd "$REPO_DIR/backend"
npm ci --production

# 6. إعادة بناء الملفات إذا لزم الأمر (للمشاريع التي تحتاج بناء)
if [ -f "package.json" ] && grep -q '"build"' package.json; then
    log_info "بناء المشروع..."
    npm run build
fi

# 7. إعادة تشغيل PM2
log_info "إعادة تشغيل التطبيق عبر PM2..."
if pm2 list | grep -q "$PM2_APP_NAME"; then
    pm2 restart $PM2_APP_NAME --update-env
    log_success "تم إعادة تشغيل $PM2_APP_NAME"
else
    log_warning "التطبيق غير مسجل في PM2، يتم تشغيله لأول مرة..."
    pm2 start ecosystem.config.js --env production
    pm2 save
    log_success "تم تشغيل $PM2_APP_NAME وحفظ تكوين PM2"
fi

# 8. استرجاع التغييرات المحلية (stash) إذا كانت موجودة
if [ "$STASHED" = true ]; then
    log_info "استرجاع التغييرات المحلية المحفوظة..."
    cd "$REPO_DIR"
    git stash pop
    log_success "تم استرجاع التغييرات المحلية"
fi

# 9. عرض حالة PM2
log_info "حالة التطبيق:"
pm2 list

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  تم التحديث بنجاح! ✅${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "الإصدار الجديد: $(git rev-parse --short HEAD)"
echo -e "الفرع: $(git branch --show-current)"
echo ""
echo -e "${BLUE}روابط الوصول:${NC}"
echo -e "  لوحة التحكم: http://localhost:4000/admin/dashboard.html"
echo -e "  الصفحة العامة: http://localhost:4000/"
echo ""