// ecosystem.config.js: إعدادات PM2 لتشغيل خادم المراقبة في الإنتاج.
module.exports = {
  apps: [
    {
      name: 'network-monitor',
      script: './backend/src/server.js',
      cwd: __dirname,
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
