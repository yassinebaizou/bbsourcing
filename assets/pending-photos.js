/* Product pictures chosen by a new visitor before their account exists (ROADMAP A2).
   They cannot be uploaded yet (no login until the email is confirmed), so they are kept in this
   browser (IndexedDB) and uploaded by /account on the first login, attached to the request.
   Kept 30 days at most. Every function returns a Promise and never throws to the page. */
window.PendingPhotos = (function () {
  "use strict";
  var DB = "ddp-pending-photos", STORE = "uploads", MAX_AGE = 30 * 24 * 3600 * 1000;

  function open() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error("IndexedDB not available"));
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE, { keyPath: "userId" }); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function run(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode), r = fn(t.objectStore(STORE));
        t.oncomplete = function () { db.close(); resolve(r && "result" in r ? r.result : undefined); };
        t.onerror = t.onabort = function () { db.close(); reject(t.error); };
      });
    });
  }

  return {
    // Save the File objects for this new account. Resolves true when stored.
    save: function (userId, files) {
      if (!userId || !files || !files.length) return Promise.resolve(false);
      var items = files.map(function (f) { return { name: f.name, type: f.type, blob: f }; });
      return run("readwrite", function (s) { return s.put({ userId: userId, savedAt: Date.now(), files: items }); })
        .then(function () { return true; }, function () { return false; });
    },
    // The saved pictures as File objects, or null.
    get: function (userId) {
      return run("readonly", function (s) { return s.get(userId); }).then(function (rec) {
        if (!rec || !rec.files || !rec.files.length) return null;
        if (Date.now() - rec.savedAt > MAX_AGE) return null;
        return {
          savedAt: rec.savedAt,
          files: rec.files.map(function (x) {
            try { return new File([x.blob], x.name, { type: x.type }); } catch (e) { x.blob.name = x.name; return x.blob; }
          })
        };
      }, function () { return null; });
    },
    remove: function (userId) {
      return run("readwrite", function (s) { return s.delete(userId); }).then(function () { return true; }, function () { return false; });
    }
  };
})();
