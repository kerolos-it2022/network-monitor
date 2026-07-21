// ecosystem.config.js: إعدادات PM2 لتشغيل خادم المراقبة في الإنتاج.
module.exports = {
  apps: [
    {
      name: 'network-monitor',
      script: './src/server.js',
      cwd: __dirname + '/backend',
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
