// update-apply.service.js — apply a release tree as a FULL REPLACEMENT (no stale leftovers).
// ─────────────────────────────────────────────────────────────────────────────
// Why this exists (the defect it fixes): the updater used to copy the new release
// OVER the existing tree (cp -a / rsync without --delete). Any file or folder that
// existed in the old version but was removed in the new one survived the update
// (deleted JS pages, removed docs folders, abandoned directories) — i.e. "some
// files/pages are NOT replaced". Here every top-level entry shipped by the release
// replaces its old counterpart completely:
//   1) All new entries are staged in a temp dir INSIDE the install dir (same
//      filesystem, so the final move is a rename). Staging is strictly read-only
//      with respect to the existing tree — a staging failure changes nothing at all.
//   2) Entries are then swapped one by one with rename(); the old entry is moved
//      aside first, preserved runtime children are moved into the staged copy, and
//      everything is restored if the new entry cannot be moved in (per-entry
//      rollback). No file is ever left half-written.
//
// What is NEVER deleted or overwritten (user data — enumerated explicitly):
//   <root>/database/                     : merge-only. On plain installs this holds the
//                                          live SQLite DB (DB_PATH=../database/monitoring.db),
//                                          backups/, svc-backups/, WAL/SHM files. Files the
//                                          release ships here (schema.sql) are overwritten;
//                                          nothing else is ever deleted.
//   <root>/backend/node_modules/         : kept (npm ci reinstalls deps afterwards; keeping
//                                          them means a failed npm ci cannot leave the app without deps)
//   <root>/backend/.env                  : kept as-is (secrets / local configuration)
//   <root>/backend/database/             : kept as-is (relative DB paths may live here,
//                                          plus the transient update-web-status.json)
//   <root>/backend/uploads/ + backups/ + svc-backups/   : kept as-is
//   <root>/frontend/.env + uploads/      : kept as-is
//   <root>/docs/_notes/ + private/       : kept as-is (local-only notes, git-ignored)
//   <root>/.git  .env  node_modules      : never taken from the release
//   Anything at the install root that the release does NOT ship (e.g. ui-redesign/,
//   memory-backup/, .zcode/, .git/) is not an archive entry, so it is untouched by design.
'use strict';
const fs = require('fs');
const path = require('path');

// Runtime / user-data paths preserved INSIDE a replaced directory, by directory name.
const PRESERVE_INSIDE = {
  backend: ['node_modules', '.env', 'database', 'uploads', 'backups', 'svc-backups'],
  frontend: ['.env', 'uploads'],
  docs: ['_notes', 'private'],
};
// Top-level names never taken from the release even if present in it.
const PRESERVE_ROOT = new Set(['.git', '.env', 'node_modules']);

function exists(p) {
  try { return fs.existsSync(p); } catch (e) { return false; }
}

// Recursive copy that keeps file modes (executable bits for scripts) and symlinks.
function copyTree(src, dest) {
  const st = fs.lstatSync(src);
  if (st.isDirectory()) {
    const isNew = !exists(dest);
    fs.mkdirSync(dest, { recursive: true });
    // Only set the mode on directories we create — never widen/narrow an existing
    // data directory (e.g. the live database dir on a merge).
    if (isNew) { try { fs.chmodSync(dest, st.mode & 0o777); } catch (e) { /* non-fatal (Windows) */ } }
    for (const name of fs.readdirSync(src).sort()) {
      copyTree(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  if (st.isSymbolicLink()) {
    const target = fs.readlinkSync(src);
    try { fs.rmSync(dest, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    try { fs.symlinkSync(target, dest); } catch (e) { /* best effort */ }
    return;
  }
  fs.copyFileSync(src, dest);
  try { fs.chmodSync(dest, st.mode & 0o777); } catch (e) { /* non-fatal (Windows) */ }
}

// Count entries (files + dirs) present in oldDir but absent from newDir — reporting only.
// `skipTop` are top-level names that are preserved (they intentionally stay in oldDir
// until the commit) so they must not be counted as "stale".
function countStaleEntries(oldDir, newDir, skipTop = []) {
  let n = 0;
  const skip = new Set(skipTop);
  const walk = (o, nw, top) => {
    let entries;
    try { entries = fs.readdirSync(o, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of entries) {
      if (top && skip.has(ent.name)) continue;
      const op = path.join(o, ent.name);
      const np = path.join(nw, ent.name);
      const present = exists(np);
      if (!present) { n += 1; continue; }
      if (ent.isDirectory()) walk(op, np, false);
    }
  };
  walk(oldDir, newDir, true);
  return n;
}

// The extracted archive usually has a single top-level folder (owner-repo-<sha>/ or
// repo-<tag>/); accept either the container or that folder directly.
function resolveReleaseRoot(srcDir) {
  const abs = path.resolve(srcDir);
  if (!exists(abs)) throw new Error('release source directory not found: ' + abs);
  const looksLikeRoot = (d) => exists(path.join(d, 'backend')) || exists(path.join(d, 'frontend'));
  if (looksLikeRoot(abs)) return abs;
  const dirs = fs.readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const d of dirs) {
    const cand = path.join(abs, d);
    if (looksLikeRoot(cand)) return cand;
  }
  throw new Error('unexpected release tree (no backend/ or frontend/) under: ' + abs);
}

// Phase 1 — stage everything. STRICTLY read-only with respect to the existing tree:
// it touches only <destDir>/.nm-update-staging-<stamp>/ (removed again on any error).
// Preserved runtime children are only *planned* here; they are moved within the
// commit swap so a staging failure can never lose or displace them.
function stageReleaseTree(srcDir, destDir) {
  const releaseRoot = resolveReleaseRoot(srcDir);
  const destAbs = path.resolve(destDir);
  fs.mkdirSync(destAbs, { recursive: true });
  const stagingDir = path.join(destAbs, `.nm-update-staging-${process.pid}-${Date.now()}`);
  fs.mkdirSync(stagingDir, { recursive: true });
  const entries = [];
  const skipped = [];
  let removedStaleEntries = 0;
  try {
    for (const name of fs.readdirSync(releaseRoot).sort()) {
      if (PRESERVE_ROOT.has(name)) { skipped.push(name); continue; }
      const srcP = path.join(releaseRoot, name);
      const destP = path.join(destAbs, name);
      if (name === 'database') {
        // Handled at commit time as merge-only (never deletes anything there).
        entries.push({ name, kind: 'merge' });
        continue;
      }
      const staged = path.join(stagingDir, name);
      copyTree(srcP, staged);
      const keepNames = PRESERVE_INSIDE[name] || [];
      if (exists(destP)) removedStaleEntries += countStaleEntries(destP, staged, keepNames);
      entries.push({ name, kind: 'swap', staged, keepNames });
    }
  } catch (err) {
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    throw err;
  }
  return { releaseRoot, stagingDir, entries, skipped, removedStaleEntries, preserved: {} };
}

// Phase 2 — swap staged entries into place. Each entry is renamed with rollback;
// `database` is merged (copy over, never delete). Staging dir is removed on success.
// Swap order per entry: dest -> backup, move preserved children backup -> staged,
// staged -> dest. If anything fails, the preserved children are moved back and the
// backup is restored, so the old entry stays complete.
function commitStagedTree(stage, destDir) {
  const destAbs = path.resolve(destDir);
  const stamp = path.basename(stage.stagingDir).replace('.nm-update-staging-', '');
  const report = {
    releaseRoot: stage.releaseRoot,
    replaced: [], merged: [], skipped: stage.skipped,
    preserved: stage.preserved, removedStaleEntries: stage.removedStaleEntries,
  };

  for (const entry of stage.entries) {
    if (entry.kind !== 'swap') continue;
    const dest = path.join(destAbs, entry.name);
    const backup = path.join(destAbs, `.nm-update-old-${entry.name}-${stamp}`);
    const hadDest = exists(dest);
    const moved = [];   // preserved children moved out of `backup` into the staged copy
    if (hadDest) fs.renameSync(dest, backup);
    try {
      for (const child of entry.keepNames || []) {
        const from = path.join(backup, child);
        if (!exists(from)) continue;
        const to = path.join(entry.staged, child);
        fs.rmSync(to, { recursive: true, force: true });
        fs.renameSync(from, to);
        moved.push(child);
      }
      fs.renameSync(entry.staged, dest);
    } catch (err) {
      // rollback: put preserved children back, then the old entry itself.
      for (const child of moved) {
        try {
          const from = path.join(entry.staged, child);
          const to = path.join(backup, child);
          if (exists(from) && !exists(to)) fs.renameSync(from, to);
        } catch (e) { /* keep the backup copy — data is still inside destDir */ }
      }
      if (hadDest) { try { fs.renameSync(backup, dest); } catch (e) { /* keep backup */ } }
      throw err;
    }
    if (moved.length) report.preserved[entry.name] = moved;
    // Best-effort: the new entry is already in place, so a failed cleanup must not
    // turn a successful swap into a reported update failure.
    if (hadDest) { try { fs.rmSync(backup, { recursive: true, force: true }); } catch (e) { /* leftover .nm-update-old-* */ } }
    report.replaced.push(entry.name);
  }

  // database merge last: copy released files (schema.sql) over the existing dir but
  // never delete anything there (this dir may hold the live DB and backups).
  const dbEntry = stage.entries.find((e) => e.kind === 'merge');
  if (dbEntry) {
    const srcDb = path.join(stage.releaseRoot, 'database');
    if (exists(srcDb)) copyTree(srcDb, path.join(destAbs, 'database'));
    report.merged.push('database');
  }

  try { fs.rmSync(stage.stagingDir, { recursive: true, force: true }); } catch (e) { /* leave for manual cleanup */ }
  return report;
}

// Full replacement of application files from a release tree into an install dir.
// Returns a report: { releaseRoot, replaced, merged, skipped, preserved, removedStaleEntries }.
function applyReleaseTree({ srcDir, destDir }) {
  const stage = stageReleaseTree(srcDir, destDir);
  return commitStagedTree(stage, destDir);
}

// Best-effort refresh of the appliance root helpers (OS-level files, not app files).
// Only attempted when the appliance units are installed — their presence is also what
// marks "appliance mode" for the web service, and a plain install must not receive it.
// Never throws and never fails an update.
function refreshApplianceHelpers(releaseRoot) {
  const out = [];
  try {
    if (!exists('/etc/systemd/system/nm-update.service')) return out;
    const srcSbin = path.join(releaseRoot, 'appliance', 'config', 'includes.chroot', 'usr', 'local', 'sbin');
    if (!exists(srcSbin) || !exists('/usr/local/sbin')) return out;
    for (const f of ['nm-update', 'nm-remote']) {
      const src = path.join(srcSbin, f);
      if (!exists(src)) continue;
      const dst = path.join('/usr/local/sbin', f);
      try {
        fs.copyFileSync(src, dst);
        fs.chmodSync(dst, 0o755);
        out.push(f);
      } catch (e) { /* no permission — skip silently */ }
    }
  } catch (e) { /* never fail the update because of helpers */ }
  return out;
}

module.exports = { applyReleaseTree, stageReleaseTree, commitStagedTree, resolveReleaseRoot, refreshApplianceHelpers, PRESERVE_INSIDE, PRESERVE_ROOT };
