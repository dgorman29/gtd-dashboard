// Cloud sync for the GTD dashboard.
//
// The dashboard keeps its whole state as one JSON blob in localStorage under
// 'gtd_state_v1'. This script runs before the bundle unpacks and:
//   1. signs the user in to Supabase,
//   2. pulls the cloud copy into localStorage so the app boots with it,
//   3. watches localStorage writes and pushes them to Supabase (debounced).
// Pushes are conditional on the row's updated_at, so two devices can't
// silently overwrite each other; a mismatch shows a conflict prompt instead.
(function () {
  var KEY = 'gtd_state_v1';
  var META_KEY = 'gtd_sync_meta';
  var TABLE = 'gtd_state';
  var cfg = window.GTD_SUPABASE || {};
  var ls = window.localStorage;
  var rawSet = Storage.prototype.setItem;

  if (!cfg.url || !cfg.anonKey || !window.supabase) {
    console.warn('GTD sync disabled: Supabase not configured or library failed to load.');
    window.__gtdSyncReady = Promise.resolve();
    return;
  }

  var sb = window.supabase.createClient(cfg.url, cfg.anonKey);
  var user = null;
  var ready = false;
  var pushing = false;
  var again = false;
  var timer = null;
  var conflict = false;
  var status = 'Connecting…';

  // ---- local metadata: last cloud version we saw + whether we have unpushed edits
  function readMeta() {
    try { return JSON.parse(ls.getItem(META_KEY)) || {}; } catch (e) { return {}; }
  }
  var meta = readMeta();
  function writeMeta() { try { rawSet.call(ls, META_KEY, JSON.stringify(meta)); } catch (e) {} }
  function writeLocalState(data) { try { rawSet.call(ls, KEY, JSON.stringify(data)); } catch (e) {} }
  function readLocalState() {
    try { var r = ls.getItem(KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; }
  }

  // ---- status badge (re-attached if the bundle swaps the document)
  var STYLE = 'position:fixed;left:12px;bottom:12px;z-index:10002;font:12px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;' +
    'background:#fff;color:#555;padding:6px 10px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.15);display:flex;gap:8px;align-items:center;';
  function badge() {
    if (!ready || !document.body) return;
    var el = document.getElementById('gtd-sync');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gtd-sync';
      el.setAttribute('style', STYLE);
      document.body.appendChild(el);
    }
    var html = '<span>' + status + '</span>';
    if (conflict) {
      el.style.background = '#fdecea'; el.style.color = '#8a1c1c';
      html += '<button data-a="cloud">Load cloud version</button><button data-a="mine">Keep this device\'s</button>';
    } else {
      el.style.background = '#fff'; el.style.color = '#555';
      html += '<a href="#" data-a="signout" style="color:#888" title="' + (user && user.email || '') + '">Sign out</a>';
    }
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  function setStatus(s) { status = s; badge(); }
  setInterval(badge, 1500);
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.getAttribute && e.target.getAttribute('data-a');
    if (!a || !e.target.closest('#gtd-sync')) return;
    e.preventDefault();
    if (a === 'signout') signOut();
    if (a === 'cloud') loadCloudAndReload();
    if (a === 'mine') keepMine();
  });

  // ---- cloud access
  function fetchRow() {
    return sb.from(TABLE).select('data,updated_at').eq('user_id', user.id).maybeSingle()
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }

  function push() {
    if (conflict || !user) return;
    if (pushing) { again = true; return; }
    var data = readLocalState();
    if (!data) return;
    pushing = true; again = false;
    setStatus('Saving…');
    var q = meta.updated_at
      ? sb.from(TABLE).update({ data: data, updated_at: new Date().toISOString() })
          .eq('user_id', user.id).eq('updated_at', meta.updated_at).select('updated_at')
      : sb.from(TABLE).insert({ user_id: user.id, data: data }).select('updated_at');
    q.then(function (r) {
      pushing = false;
      if (r.error && r.error.code !== '23505') throw r.error;
      if (r.error || !r.data || !r.data.length) { // row changed (or appeared) elsewhere
        conflict = true;
        setStatus('Changed on another device.');
        return;
      }
      meta.updated_at = r.data[0].updated_at;
      meta.dirty = again;
      writeMeta();
      if (again) push(); else setStatus('Synced ✓');
    }).catch(function (err) {
      pushing = false;
      console.warn('GTD sync push failed', err);
      setStatus(navigator.onLine ? 'Sync error – will retry' : 'Offline – changes saved locally');
      clearTimeout(timer); timer = setTimeout(push, 15000);
    });
  }

  function schedulePush() {
    meta.dirty = true; writeMeta();
    setStatus('Saving…');
    clearTimeout(timer); timer = setTimeout(push, 800);
  }

  // Hook the app's own saves.
  Storage.prototype.setItem = function (k, v) {
    rawSet.call(this, k, v);
    if (ready && this === ls && k === KEY) schedulePush();
  };

  function loadCloudAndReload() {
    fetchRow().then(function (row) {
      if (row) { writeLocalState(row.data); meta = { updated_at: row.updated_at, dirty: false }; writeMeta(); }
      location.reload();
    });
  }
  function keepMine() {
    fetchRow().then(function (row) {
      meta.updated_at = row ? row.updated_at : null;
      conflict = false;
      push();
    });
  }
  function signOut() {
    if (meta.dirty && !confirm('Some changes have not synced yet and will be lost. Sign out anyway?')) return;
    sb.auth.signOut().finally(function () {
      try { ls.removeItem(KEY); ls.removeItem(META_KEY); } catch (e) {}
      location.reload();
    });
  }

  // When returning to the tab, pick up edits made on other devices.
  function checkRemote() {
    if (!ready || !user || pushing || meta.dirty || conflict || document.visibilityState !== 'visible') return;
    fetchRow().then(function (row) {
      if (row && row.updated_at !== meta.updated_at) loadCloudAndReload();
    }).catch(function () {});
  }
  document.addEventListener('visibilitychange', checkRemote);
  window.addEventListener('focus', checkRemote);
  window.addEventListener('online', function () { if (meta.dirty) push(); });
  setInterval(checkRemote, 60000);

  // ---- sign-in screen
  function signIn() {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.setAttribute('style', 'position:fixed;inset:0;z-index:10003;background:#f5ead8;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif;');
      wrap.innerHTML =
        '<form style="background:#fff;padding:28px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.1);width:min(340px,calc(100vw - 32px));display:flex;flex-direction:column;gap:12px">' +
        '<h2 style="font-size:18px;color:#333">GTD Dashboard</h2>' +
        '<p style="font-size:13px;color:#777">Sign in to sync across devices.</p>' +
        '<input name="email" type="email" placeholder="Email" autocomplete="username" required style="padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px">' +
        '<input name="password" type="password" placeholder="Password" autocomplete="current-password" required style="padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px">' +
        '<button style="padding:10px;border:0;border-radius:8px;background:#5a6b4e;color:#fff;font-size:14px;cursor:pointer">Sign in</button>' +
        '<div class="err" style="font-size:13px;color:#b00020;min-height:1em"></div></form>';
      document.body.appendChild(wrap);
      var form = wrap.querySelector('form');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var err = form.querySelector('.err');
        err.textContent = '';
        sb.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value })
          .then(function (r) {
            if (r.error) { err.textContent = r.error.message; return; }
            wrap.remove();
            resolve(r.data.user);
          });
      });
    });
  }

  // ---- startup: gate the bundle until local state matches the cloud
  window.__gtdSyncReady = new Promise(function (resolve) {
    function start() {
      sb.auth.getSession()
        .then(function (r) { return (r.data.session && r.data.session.user) || signIn(); })
        .then(function (u) { user = u; return fetchRow(); })
        .then(function (row) {
          var local = readLocalState();
          if (!row) {
            // First device: the existing local data becomes the cloud copy.
            meta.updated_at = null;
            if (local) meta.dirty = true;
          } else if (!meta.dirty || !local) {
            writeLocalState(row.data);
            meta = { updated_at: row.updated_at, dirty: false };
          } else if (meta.updated_at !== row.updated_at) {
            // Unsynced edits here AND newer edits in the cloud.
            if (confirm('This device has unsynced changes, and the cloud copy was changed elsewhere.\n\nOK = keep this device\'s version\nCancel = use the cloud version')) {
              meta.updated_at = row.updated_at; meta.dirty = true;
            } else {
              writeLocalState(row.data);
              meta = { updated_at: row.updated_at, dirty: false };
            }
          }
          writeMeta();
        })
        .catch(function (err) {
          console.warn('GTD sync startup failed; using local data', err);
          status = 'Offline – changes saved locally';
        })
        .then(function () {
          ready = true;
          if (status === 'Connecting…') status = 'Synced ✓';
          if (meta.dirty && user) push();
          resolve();
        });
    }
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  });
})();
