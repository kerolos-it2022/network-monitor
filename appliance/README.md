# Network Monitor Appliance — installable ISO

**English** · [العربية](README.ar.md)

Turns the monitor into a dedicated appliance, the way firewall boxes work: boot the machine from USB/CD →
automatic install to disk → reboot → the whole system runs (minimal Debian + the monitor + a web server) and
you manage it from the browser.

```
┌─────────────── ISO (minimal Debian 12) ─────────────┐
│  Linux + nginx (80) ──► node (127.0.0.1:4001)       │
│  systemd: network-monitor.service                   │
│  nftables: only 80/443 allowed                      │
│  database: /var/lib/network-monitor/                │
└─────────────────────────────────────────────────────┘
```

## 1) Building

### GitHub Actions (recommended — no local tooling)

1. Push the repository (`appliance/` + `.github/workflows/build-iso.yml`).
2. **Actions → Build Appliance ISO → Run workflow**, or push a tag starting with `v`.
3. When it finishes, download the ISO from **Artifacts** (or from **Releases** when a tag triggered the
   build, together with `SHA256SUMS.txt`).

### Locally (WSL2 on Windows)

```bash
sudo apt-get install -y live-build debootstrap debian-archive-keyring \
  squashfs-tools xorriso grub-pc-bin grub-efi-amd64-bin grub2-common \
  mtools dosfstools e2fsprogs parted rsync
cd <repo>/appliance
sudo NM_VERSION=v2.50.0 bash build.sh
# output: network-monitor-appliance-v2.50.0-amd64.iso
```

## 2) Installing on a machine

1. Write the ISO to a USB stick: Rufus (DD mode) · Ventoy · or
   `dd if=network-monitor-appliance-*.iso of=/dev/sdX bs=4M status=progress`.
2. Boot the target machine from the USB (disable Secure Boot — the image carries a normal signature).
3. The console menu appears → choose **[1] Install the system to disk**.
4. Pick the disk → type `YES` to confirm (⚠️ this erases the whole disk).
5. Wait for the copy + GRUB → **write down the admin password shown** (it is printed once).
6. Reboot and boot from the disk.

## 3) Access

| Item | Value |
|---|---|
| Web UI | `http://<device-ip>/` |
| Admin user | `admin` + the password generated during install |
| Console password | **the same admin password** — `tty1` (`nm-console` menu) |
| Linux login | user `sysadmin` with the same password (from the keyboard: `Alt+F2`; SSH is disabled) |
| Open ports | 80 and 443 only (nftables) — SSH disabled |
| Database | `/var/lib/network-monitor/monitoring.db` |
| Service logs | `journalctl -u network-monitor` (or from the console menu) |
| Changing the password | Dashboard → Profile, or console menu `[6]` — **every door is updated automatically** |

> 🔑 **One password, three doors:** the dashboard (`admin`) · the console on `tty1` · and the Linux account
> (`sysadmin`). There is a single writer: `/usr/local/sbin/nm-sync-console-password` reads the password from
> `stdin` (so it never appears in `ps`), writes the console gate `/etc/nm-console.conf` (SHA-512, mode 600)
> and updates `sysadmin`. The dashboard service (`netmon`) may call it through one line in
> `sudoers.d/nm-console-sync` — no password, no other privilege. `root` stays passwordless by design; log in
> as `sysadmin` and use `sudo`.

## 4) Updating later

- **Full path:** build a new ISO and reinstall (⚠️ wipes data — export a backup from the Backup tab first).
- **In-place path (recommended):** the dashboard’s **Updates** tab → check → *backup + update*. The web
  service writes a request file holding **only a tag**; `nm-update.path` starts `nm-update.service` (root),
  which downloads that release archive, `rsync`s the code, runs `npm ci` and restarts the service — the
  database is never touched, and Node is upgraded first when needed (`nm-node-upgrade`). A previous version
  can be restored from the same tab, and progress is streamed to the UI.

## 4.1) Testing the password doors without a machine

```bash
# from the repository root (Docker running) — 19 checks: console gate · Linux account · the dashboard going
# through sudo · the limits of that privilege · and that no plaintext password is left in any file.
docker run --rm -v "$PWD:/work" node:24-bookworm bash /work/appliance/tests/verify-password-doors.sh
```

## 5) File layout

```
appliance/
├── build.sh                          ISO builder (root, inside CI/WSL2)
├── auto/config                       live-build configuration (bookworm amd64)
├── config/
│   ├── package-lists/                system packages (nginx, nftables, …)
│   ├── bootloaders/                  grub-pc · grub-efi · syslinux
│   ├── hooks/live/                   build scripts run inside the chroot:
│   │    0050-install-nodejs          install Node 24 LTS
│   │    0090-create-user             create the netmon service account
│   │    0100-build-app               install the application + npm ci
│   │    0110-enable-services         enable systemd units
│   │    0120-fix-perms               permissions, including the root helpers
│   │    0130-prune-kernels           shrink the image
│   ├── hooks/normal/0990-fix-grub-paths
│   └── includes.chroot/
│       ├── etc/systemd/system/       network-monitor · nm-console · nm-healthcheck(.timer)
│       │                             nm-update(.path/.service) · nm-remote(.path/.service) · nginx drop-in
│       ├── etc/nginx/sites-available/network-monitor
│       ├── etc/nftables.conf         firewall: 80/443 only
│       ├── etc/sudoers.d/nm-console-sync
│       ├── etc/{hostname,issue,motd,os-release}
│       ├── etc/apt/sources.list.d/debian-security.list
│       ├── etc/tmpfiles.d/network-monitor.conf
│       └── usr/local/sbin/           nm-console · nm-install-to-disk · nm-update · nm-node-upgrade
│                                     nm-remote · nm-healthcheck · nm-sync-console-password
└── tests/verify-password-doors.sh    container harness for the password model
```

## Notes

- The first build in CI can reveal live-build version differences — if it fails, read `build.log` in the
  artifact.
- The admin password is **random for every install** (`seedAdmin` skips account creation when a user exists).
- The image also runs **live** (no install) for a quick look — nothing is persisted.
- Read-only integrations (ESXi, Synology, Sophos) are not created automatically; the appliance simply runs
  the monitor, and the passive discovery listener needs no credentials at all.

## Related documents

| Document | Content |
|---|---|
| [../docs/DEPLOY.md](../docs/DEPLOY.md) | Server deployment and upgrades |
| [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | The self-update mechanism in context |
| [../README.md](../README.md) | Project overview |
