# ملف تعريف root — يُطلق قائمة appliance تلقائيًّا على الكونسول.
if [ -t 0 ] && [ "$(tty)" = "/dev/tty1" ] && [ -x /usr/local/sbin/nm-console ]; then
    /usr/local/sbin/nm-console
fi
