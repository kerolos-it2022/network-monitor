# 🚀 Production deployment (Linux)

**English** · [العربية](DEPLOY.ar.md)

How to install Network Monitor on a Linux server — the automatic path with `deploy.sh`, the manual path
step by step, reverse proxy + HTTPS, backups and upgrades. This guide merges and replaces the former
`RUN-ON-LINUX.md`.

---

## 📋 Supported distributions

| Family | Distributions | Package manager |
|---|---|---|
| **Debian** | Ubuntu, Debian, Linux Mint, Pop!_OS, Kali | `apt` |
| **Red Hat** | RHEL, CentOS, Rocky, AlmaLinux, Fedora | `dnf` / `yum` |
| **Arch** | Arch, Manjaro, EndeavourOS | `pacman` |
| **Alpine** | Alpine Linux | `apk` |
| **SUSE** | openSUSE, SLES | `zypper` |

`deploy.sh` detects the distribution and package manager itself.

## 📋 Requirements

| Item | Version | Notes |
|---|---|---|
| Kernel | 4.x or newer | any distribution above |
| Node.js | **24 LTS** (**≥ 22 required**) | installed by the script (`better-sqlite3@13` needs ≥ 22) |
| PM2 | latest | process manager, installed by the script |
| RAM | 512 MB minimum | 1 GB recommended for 50+ devices |
| Privileges | sudo / root | to install packages |
| Internet | required | to fetch packages and NodeSource |

---

## ⚡ Quick deploy (≈5 minutes, recommended)

```bash
# on the server
sudo mkdir -p /opt && sudo chown "$USER":"$USER" /opt
cd /opt
git clone https://github.com/kerolos-it2022/network-monitor.git network-monitor
cd network-monitor
sudo bash deploy.sh install
```

### What `deploy.sh install` does

1. Detects the distribution and package manager (`apt`/`dnf`/`yum`/`pacman`/`apk`/`zypper`).
2. Updates packages and installs the basics: git, curl, wget, ca-certificates, gnupg, **traceroute**.
3. Installs the build tools (python3, make, g++, build-essential) needed by `better-sqlite3`.
4. Installs **Node.js 24 LTS** (NodeSource on Debian/RHEL, the distribution package elsewhere).
5. Installs **PM2** globally and the **sqlite3** CLI.
6. Creates `backend/.env` from the template, generates a random `SESSION_SECRET` **and VAPID keys**.
7. Runs `npm install` and rebuilds `better-sqlite3` **for the target system** (this is what solves the
   “built on Windows, broken on Linux” problem).
8. Prepares the database and seeds the default admin.
9. Starts the app under PM2 with boot-time startup (systemd / OpenRC) and prints the access URLs.

The former manual sequence is available below if you prefer to see every step.

---

## 🛠️ Manual install (no script)

```bash
# 1) Node.js 24 LTS
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt-get install -y nodejs            # Debian/Ubuntu
node -v                                   # must print v24.x

# 2) build tools (needed by better-sqlite3)
# Debian/Ubuntu: sudo apt install -y python3 make g++ build-essential
# RHEL/CentOS:   sudo dnf install -y python3 make gcc gcc-c++
# Arch:          sudo pacman -S python make gcc
# Alpine:        sudo apk add python3 make g++ build-base
# openSUSE:      sudo zypper install python3 make gcc gcc-c++

# 3) project + dependencies
cd /opt && git clone https://github.com/kerolos-it2022/network-monitor.git network-monitor
cd network-monitor/backend && npm install

# 4) database
mkdir -p ../database && sqlite3 ../database/monitoring.db < ../database/schema.sql

# 5) settings
cp .env.example .env && nano .env         # PORT, DB_PATH, admin account, Telegram… (optional)
npm install -g pm2                        # 6) process manager

# 7) first admin + run
node src/seedAdmin.js
npm start                                 # or: pm2 start ../ecosystem.config.js
pm2 startup && pm2 save                   # start automatically at boot (run the printed command)
```

---

## ⚙️ Post-install configuration (important)

Edit `backend/.env` — at minimum:

```env
DEFAULT_ADMIN_PASSWORD=a-strong-unique-password
TELEGRAM_BOT_TOKEN=your-new-token
TELEGRAM_CHAT_ID=your-chat-id
VAPID_PUBLIC_KEY=...        # generated automatically by deploy.sh
VAPID_PRIVATE_KEY=...       # generated automatically by deploy.sh
VAPID_SUBJECT=mailto:you@example.com
MOBILE_ENABLED=1
```

Then `sudo bash deploy.sh restart`. To regenerate VAPID keys by hand:

```bash
cd /opt/network-monitor/backend
node -e "const k=require('web-push').generateVAPIDKeys(); console.log('VAPID_PUBLIC_KEY='+k.publicKey); console.log('VAPID_PRIVATE_KEY='+k.privateKey)"
```

Verify access:

```bash
hostname -I                          # server IP
curl http://localhost:4000/api/health   # {"success":true,"data":"ok"}
```

Open `http://<server-ip>:4000/`.

### 🔑 First login

The admin comes from `DEFAULT_ADMIN_USERNAME` / `DEFAULT_ADMIN_PASSWORD`. Weak defaults are refused unless
`NM_ALLOW_WEAK_ADMIN=1`, so set a real password before the first run. **Change it from the dashboard right
after the first login** (Profile tab).

### On the appliance ISO: one password for every door

The admin password is also the console password (`tty1`) and the Linux `sysadmin` password. The installer
writes it to three places from a single source (`nm-sync-console-password`): the dashboard database
(`seedAdmin`), the console gate `/etc/nm-console.conf`, and the Linux account `sysadmin`. Any later change —
from the Profile tab or from option `[6]` in the console menu — updates all three automatically (the
dashboard updates itself, then calls the same helper through one narrowly-scoped sudo rule).

### Mobile notifications (PWA)

1. Server: VAPID keys present in `.env` (automatic with `deploy.sh install`).
2. Dashboard → Notifications → enable “Phone notifications” → save.
3. Phone: open `http://<server-ip>:4000` in Chrome → **🔔 Enable notifications** → allow → *Add to Home
   Screen*.
4. Test from the dashboard (per-channel test button).

> ⚠️ **Web Push requires HTTPS outside localhost.** `http://localhost:4000` works in Chrome, but iOS Safari
> always requires HTTPS — see the reverse proxy section below. If you only use the LAN, a trusted local
> certificate (mkcert) is enough.

---

## 🔄 Daily operations

| Task | Command |
|---|---|
| Live logs | `sudo bash deploy.sh logs` |
| Restart | `sudo bash deploy.sh restart` |
| Stop | `sudo bash deploy.sh stop` |
| Status | `sudo bash deploy.sh status` |
| Update after `git pull` | `sudo bash deploy.sh update` |
| Uninstall (your data stays) | `sudo bash deploy.sh uninstall` |

Direct PM2 equivalents: `pm2 status` · `pm2 logs network-monitor` · `pm2 restart network-monitor` ·
`pm2 stop network-monitor` · `pm2 monit`.

### Updating to a newer release

The dashboard’s **Updates** tab reads “latest release” from **git tags**, so fetch tags with every update:

```bash
cd /opt/network-monitor
git fetch --tags
git pull
sudo bash deploy.sh update
```

> ⚠️ When you publish a release from your dev machine, push **the code and the tag together**, otherwise the
> server will not see the new version:
> ```bash
> git tag -a vX.Y.Z -m "Release vX.Y.Z"
> git push origin main --follow-tags      # or: git push origin main && git push origin vX.Y.Z
> ```

> ⚠️ **Order matters on old appliances (Node 18 → 24): raise Node first, then update the app immediately**,
> and do not reboot between the two steps — the running service keeps working because the current library is
> already loaded in memory, but restarting before the update finishes fails (the old library will not load on
> Node 24). Since v2.33.0 the updater calls `nm-node-upgrade` itself before copying application files, so
> this is normally automatic (disable with `NM_SKIP_NODE_UPGRADE=1`).

**Rollback:** the Updates tab offers *restore a previous version* from the tag list (same safe path). Node
can be reverted separately (`setup_18.x` + `npm ci --omit=dev`) and the database restored from your backup.

---

## 🌐 Reverse proxy + HTTPS

### 1. Install Nginx + Certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx     # Debian/Ubuntu
sudo dnf install -y nginx certbot python3-certbot-nginx     # RHEL family
sudo pacman -S nginx certbot certbot-nginx                  # Arch
sudo apk add nginx certbot                                  # Alpine
sudo zypper install nginx certbot python3-certbot-nginx     # openSUSE
```

### 2. Configure Nginx (two files on purpose)

```bash
# server block → sites-available (http context through sites-enabled)
sudo cp /opt/network-monitor/nginx.example.conf /etc/nginx/sites-available/network-monitor
sudo ln -sf /etc/nginx/sites-available/network-monitor /etc/nginx/sites-enabled/

# map block → conf.d (must live directly inside http {})
sudo cp /opt/network-monitor/nginx.connection-map.conf /etc/nginx/conf.d/connection-map.conf

sudo nano /etc/nginx/sites-available/network-monitor   # set server_name to your domain
sudo nginx -t && sudo systemctl reload nginx
```

> 💡 **Why two files?** `map $http_upgrade $connection_upgrade {...}` is only valid inside `http { }`, never
> inside `server { }`. Keeping the `map` in `conf.d/` guarantees the right context on every nginx version.
> The shipped server block also disables `proxy_buffering` for the SSE endpoints, which is required for the
> live scan/log streams.

### 3. Free TLS with Let's Encrypt

```bash
sudo certbot --nginx -d monitor.company.com
```

### No public domain? Three LAN-friendly options

| Option | Result | Notes |
|---|---|---|
| **mkcert** (recommended for LAN) | trusted local certificate, no browser warnings, PWA/Web Push work | `mkcert -install` then `mkcert net-monitor.local localhost 127.0.0.1 <server-ip>`; point nginx at the two generated `.pem` files and add `net-monitor.local` to each client’s hosts file |
| **Self-signed** | quick, but every browser shows “connection is not private” | `openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout … -out … -subj "/CN=net-monitor.local"` |
| **Tunnel (Tailscale / ngrok / Cloudflare)** | HTTPS from anywhere without a domain | Tailscale gives `https://device.tailnet.ts.net`; the dashboard can manage an ngrok tunnel itself (Remote access tab) |

---

## 💾 Backups and restore

The database lives at `/opt/network-monitor/database/monitoring.db`.

```bash
# manual
cp /opt/network-monitor/database/monitoring.db /backups/nm-$(date +%F).db

# daily at 02:00
crontab -e
0 2 * * * cp /opt/network-monitor/database/monitoring.db /backups/nm-$(date +\%F).db
```

Restore:

```bash
sudo bash deploy.sh stop
cp /backups/nm-2026-10-18.db /opt/network-monitor/database/monitoring.db
sudo bash deploy.sh restart
```

The dashboard also has a backup tab (create, list, download, restore — a safety copy is taken before any
restore), and a scheduled automatic backup. Before a big upgrade it is worth running
`PRAGMA integrity_check` on a copy.

---

## 🌍 Running for several companies

The project is designed to be deployed per company, not multi-tenant:

1. One Linux server per company (physical, VM or VPS).
2. Clone the same repository.
3. A separate `backend/.env` per company (usually a different Telegram bot).
4. Only that company’s devices are added through its dashboard.

This gives full data isolation, independent failures, per-company notification accounts and the best
performance (each server watches its own LAN directly).

---

## 🔥 Firewall

```bash
# ufw (Debian/Ubuntu)
sudo ufw allow 22/tcp && sudo ufw allow 4000/tcp && sudo ufw enable

# firewalld (RHEL family)
sudo firewall-cmd --permanent --add-port=22/tcp
sudo firewall-cmd --permanent --add-port=4000/tcp
sudo firewall-cmd --reload

# iptables (Alpine / anything)
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 4000 -j ACCEPT
```

---

## 🐛 Troubleshooting

**The app does not start** — `sudo bash deploy.sh logs`, `sudo bash deploy.sh status`,
`pm2 logs network-monitor --err`.

**`better-sqlite3` fails to build** — install the build tools for your distribution (see the manual install
section), then:

```bash
cd /opt/network-monitor/backend
npm rebuild better-sqlite3
sudo bash deploy.sh restart
```

On Alpine the script uses `--build-from-source` automatically.

**Port 4000 is taken** — find it (`sudo ss -tlnp | grep :4000`) or change `PORT` in `backend/.env`, then
restart.

**Ping does not work** — on a plain Linux install ICMP needs no extra privileges; if your setup blocks raw
sockets: `sudo setcap cap_net_raw+p $(which node)` and restart.

**PM2 does not start at boot on Alpine** — Alpine uses OpenRC instead of systemd; add PM2 to the startup
(`rc-update`) or use the provided systemd unit as a reference.

**Reset the admin account** — `cd /opt/network-monitor/backend && node src/seedAdmin.js`.

---

## ✅ Pre-production checklist

- [ ] `DEFAULT_ADMIN_PASSWORD` is strong and unique
- [ ] `SESSION_SECRET` is set (generated by the script — verify)
- [ ] Telegram token + chat id (and/or WhatsApp credentials) configured
- [ ] Firewall enabled; only the needed ports open
- [ ] `backend/.env` copied somewhere safe (it holds the secrets)
- [ ] HTTPS configured if the dashboard is reachable from outside the LAN
- [ ] Daily backup of `monitoring.db` scheduled
- [ ] Login, adding a device and one real Telegram alert tested
- [ ] `node -v` prints **v22 or newer**
- [ ] `cd backend && npm test` passes before an upgrade
- [ ] A backup plus `PRAGMA integrity_check` taken before an upgrade
- [ ] Display settings (public page + NOC) and AI redaction reviewed after the upgrade
- [ ] For large networks: raise `check_interval_seconds` (30/60 s) on non-critical devices

## 📚 Related documents

| Document | Content |
|---|---|
| [../README.md](../README.md) | Project overview and quick start |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the components fit together |
| [I18N.md](I18N.md) | The bilingual UI model |
| [../appliance/README.md](../appliance/README.md) | Building and installing the appliance ISO |
| [linux-setup/](linux-setup/) | systemd unit + Nginx config (alternative to PM2) |
| [../CHANGELOG.md](../CHANGELOG.md) | Release history |
