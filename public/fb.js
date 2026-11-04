// Apoca Drive · Firebase bridge (auth + Firestore), loaded as a module.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, setDoc as _setDoc, deleteDoc, onSnapshot, serverTimestamp, getDocs, Bytes, query, where } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage, ref as sRef, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js";

const VAPID_KEY = "BF9nQTVfFatR-FvbQyIlvI9QKKFSgfzNZDttSo-OIhtsdOzRjz0R7P2QNMS3H1S6tFoP-_KwGQ-PG8xv3oDbseM";

const host = location.hostname;
const firebaseConfig = {
  apiKey: "AIzaSyC9gZ9xNB3vYiYcOE9pIsgqINYTvT768lc",
  // Same domain as the app: needed for sign-in from the installed app (Safari blocks cross-site storage).
  authDomain: (host === "apoca-drive.web.app" || host === "apoca-drive.firebaseapp.com") ? host : "apoca-drive.firebaseapp.com",
  projectId: "apoca-drive",
  storageBucket: "apoca-drive.firebasestorage.app",
  messagingSenderId: "826000114685",
  appId: "1:826000114685:web:4ed7cf006753e352a24f94"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fs = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

/* ---------- Stockage des fichiers (photos et vidéos) ----------
   Chaque photo envoyée devient un vrai fichier en ligne (rapide à afficher partout) au lieu d'être rangée dans la base.
   Si le stockage ne répond pas, on garde l'ancienne méthode : rien ne se perd. */
const st = getStorage(app);
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };
async function upFile(path, blob, onProgress) {
  const task = uploadBytesResumable(sRef(st, path), blob, { contentType: blob.type || "application/octet-stream", cacheControl: "public, max-age=31536000, immutable" });
  await new Promise((ok, ko) => task.on("state_changed", (x) => onProgress && x.totalBytes && onProgress(x.bytesTransferred / x.totalBytes), ko, ok));
  return getDownloadURL(task.snapshot.ref);
}
async function hashOf(buf) { const h = new Uint8Array(await crypto.subtle.digest("SHA-256", buf)); return Array.from(h.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join(""); }
function dataToBlob(u) { const i = u.indexOf(","), head = u.slice(5, i), mime = head.split(";")[0] || "application/octet-stream"; const b64 = /;base64/.test(head); const raw = b64 ? atob(u.slice(i + 1)) : decodeURIComponent(u.slice(i + 1)); const a = new Uint8Array(raw.length); for (let k = 0; k < raw.length; k++) a[k] = raw.charCodeAt(k); return new Blob([a], { type: mime }); }
let stOff = false;
async function dataUrlToFile(u, folder) {
  if (stOff) return u;
  try {
    const blob = dataToBlob(u), buf = await blob.arrayBuffer();
    return await upFile(`media/${folder}/${await hashOf(buf)}.${EXT[blob.type] || "bin"}`, blob);
  } catch (e) { console.warn("Stockage indisponible, photo gardée dans la base", e); stOff = true; setTimeout(() => { stOff = false; }, 60000); return u; }
}
const plain = (x) => x && typeof x === "object" && (Array.isArray(x) || Object.getPrototypeOf(x) === Object.prototype);
async function toFiles(x, folder) {
  if (typeof x === "string") return (/^data:(image|video)\//.test(x) && x.length > 2000) ? dataUrlToFile(x, folder) : x;
  if (!plain(x)) return x;
  if (Array.isArray(x)) { const out = []; for (const v of x) out.push(await toFiles(v, folder)); return out; }
  const out = {}; for (const k of Object.keys(x)) out[k] = await toFiles(x[k], folder); return out;
}
const hasData = (x) => typeof x === "string" ? (/^data:(image|video)\//.test(x) && x.length > 2000) : plain(x) && Object.values(x).some(hasData);
// Toutes les écritures passent par ici : les photos sont transformées en fichiers avant d'être enregistrées.
const setDoc = async (r, d, o) => (!String(r.path).startsWith("users/") && hasData(d)) ? _setDoc(r, await toFiles(d, String(r.path).split("/")[0]), o) : _setDoc(r, d, o);
async function videoToFile(folder, file, onProgress) {
  if (stOff) return "";
  try { return await upFile(`media/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${EXT[file.type] || "mp4"}`, file, onProgress); }
  catch (e) { console.warn("Stockage indisponible, vidéo découpée dans la base", e); return ""; }
}
async function chunkBlob(col, field, val, n, type) {
  const qq = field ? query(collection(fs, col), where(field, "==", val)) : collection(fs, col);
  let parts = (await getDocs(qq)).docs.map((d) => d.data());
  if (!field) parts = parts.filter((d) => d.v === val);
  parts = parts.filter((d) => d.i < n).sort((a, b) => a.i - b.i);
  return parts.length === n ? new Blob(parts.map((d) => d.b.toUint8Array()), { type: type || "video/mp4" }) : null;
}

const gate = document.getElementById("gate");
const gbtn = document.getElementById("gbtn");
const gmsg = document.getElementById("gmsg");
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function mapErr(e) {
  const err = new Error((e && e.message) || "Erreur");
  const c = e && e.code;
  err.code = c === "resource-exhausted" ? "quota_exceeded" : c === "permission-denied" ? "invalid_argument" : "unavailable";
  throw err;
}
const clean = (x) => JSON.parse(JSON.stringify(x));
const wrap = (s) => ({ id: s.id, exists: s.exists(), data: () => s.data() });

function makeDb(uid) {
  const base = `users/${uid}`;
  return {
    doc(path) {
      const ref = doc(fs, `${base}/${path}`);
      return {
        set: (data) => setDoc(ref, clean(data)).catch(mapErr),
        delete: () => deleteDoc(ref).catch(mapErr),
        onSnapshot: (cb, onErr) => onSnapshot(ref, (s) => cb(wrap(s)), (e) => onErr && onErr(e))
      };
    },
    collection(name) {
      const ref = collection(fs, `${base}/${name}`);
      return {
        onSnapshot: (cb, onErr) => onSnapshot(ref, (s) => cb({ docs: s.docs.map(wrap) }), (e) => onErr && onErr(e))
      };
    }
  };
}

const friendly = (e) => {
  const c = (e && e.code) || "";
  if (c.includes("popup-closed") || c.includes("cancelled")) return "Connexion annulée.";
  if (c.includes("network")) return "Pas de connexion internet. Vérifiez le réseau et réessayez.";
  if (c.includes("unauthorized-domain")) return "Cette adresse n'est pas autorisée pour la connexion.";
  return "La connexion n'a pas abouti. Réessayez.";
};

gbtn.addEventListener("click", async () => {
  gmsg.textContent = ""; gbtn.disabled = true;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await setPersistence(auth, browserLocalPersistence);
    if (standalone) { await signInWithRedirect(auth, provider); return; }
    try { await signInWithPopup(auth, provider); }
    catch (e) {
      const c = (e && e.code) || "";
      if (c.includes("popup-blocked") || c.includes("operation-not-supported")) await signInWithRedirect(auth, provider);
      else throw e;
    }
  } catch (e) { gmsg.textContent = friendly(e); }
  gbtn.disabled = false;
});

getRedirectResult(auth).catch((e) => { gmsg.textContent = friendly(e); });

let started = false;
onAuthStateChanged(auth, (user) => {
  if (user) {
    gate.hidden = true;
    window.__apocaEmail = user.email || "";
    if (!started) { started = true; window.__apocaResolveDb(makeDb(user.uid)); }
    if (user.email === "apocadrive7@gmail.com") setTimeout(async () => {
      try { if (localStorage.getItem("apoca_mig1")) return; } catch (e) {}
      try { const r = await window.__apocaMigrate(); if (typeof r === "number") { try { localStorage.setItem("apoca_mig1", "1"); } catch (e) {} if (r && window.toast) window.toast("Photos et vidéos déplacées vers le stockage rapide"); } } catch (e) { console.warn("déménagement interrompu", e); }
    }, 8000);
  } else {
    if (started) { location.reload(); return; }
    gate.hidden = false;
  }
});

window.__apocaSignOut = () => signOut(auth);

/* ---------- Notifications (Firebase Cloud Messaging) ---------- */
const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let swReg = null;
const swReady = ("serviceWorker" in navigator) ? navigator.serviceWorker.register("/sw.js").then((r) => (swReg = r)).catch(() => null) : Promise.resolve(null);
const LSK = "apoca-push-on";
const lsGet = () => { try { return localStorage.getItem(LSK) === "1"; } catch (e) { return false; } };
const lsSet = (v) => { try { localStorage.setItem(LSK, v ? "1" : "0"); } catch (e) {} };
async function tokenId(t) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].slice(0, 16).map((x) => x.toString(16).padStart(2, "0")).join("");
}
window.__apocaPush = {
  // unsupported | install | denied | on | off
  state() {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return isiOS && !standalone ? "install" : "unsupported";
    if (Notification.permission === "denied") return "denied";
    if (Notification.permission === "granted" && lsGet()) return "on";
    return "off";
  },
  async enable() {
    const u = auth.currentUser; if (!u) throw new Error("not-signed-in");
    if (!(await isSupported())) throw Object.assign(new Error("unsupported"), { code: "unsupported" });
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { lsSet(false); throw Object.assign(new Error("denied"), { code: "denied" }); }
    const reg = (await swReady) || (await navigator.serviceWorker.ready);
    const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) throw new Error("no-token");
    await setDoc(doc(fs, `users/${u.uid}/devices/${await tokenId(token)}`), {
      token, ua: navigator.userAgent.slice(0, 200), platform: isiOS ? "iOS" : (navigator.platform || ""), standalone, updated: serverTimestamp()
    });
    lsSet(true);
    return true;
  },
  async test() {
    const u = auth.currentUser; if (!u) throw new Error("not-signed-in");
    await setDoc(doc(collection(fs, `users/${u.uid}/pushTests`)), { at: serverTimestamp() });
  }
};

/* Foreground: when the app is open, the system does not show the push itself, so show it here. */
isSupported().then((ok) => {
  if (!ok) return;
  onMessage(getMessaging(app), async (p) => {
    const n = (p && p.notification) || {};
    const title = n.title || "Apoca Drive", body = n.body || "";
    try { const reg = (await swReady) || (await navigator.serviceWorker.ready); if (reg && Notification.permission === "granted") await reg.showNotification(title, { body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { link: (p && p.fcmOptions && p.fcmOptions.link) || "/" } }); } catch (e) {}
    if (window.toast) { try { window.toast(`${title} · ${body}`); } catch (e) {} }
  });
}).catch(() => {});

/* ---------- Destinations (public, shown on the website) ---------- */
window.__apocaDest = {
  listen(cb) { return onSnapshot(collection(fs, "destinations"), (q) => cb(q.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb(null)); },
  listenPhotos(id, cb) { return onSnapshot(collection(fs, `destinations/${id}/photos`), (q) => cb(q.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([])); },
  save(id, data) { return setDoc(doc(fs, `destinations/${id}`), JSON.parse(JSON.stringify(data)), { merge: true }); },
  addPhoto(id, pid, data) { return setDoc(doc(fs, `destinations/${id}/photos/${pid}`), data); },
  delPhoto(id, pid) { return deleteDoc(doc(fs, `destinations/${id}/photos/${pid}`)); },
  async delDest(id) { const ps = await getDocs(collection(fs, `destinations/${id}/photos`)); await Promise.all(ps.docs.map((d) => deleteDoc(d.ref))); await deleteDoc(doc(fs, `destinations/${id}`)); }
};

/* ---------- Carte QR (page www.apocadrive.com/carte) ---------- */
window.__apocaCarte = {
  listen(cb) { return onSnapshot(doc(fs, "site/carte"), (s) => cb(s.exists() ? s.data() : {}), () => cb({})); },
  save(patch) { return setDoc(doc(fs, "site/carte"), JSON.parse(JSON.stringify(patch)), { merge: true }); },
  async setJourVideo(file, onProgress) {
    const url = await videoToFile("carte", file, onProgress);
    if (url) {
      await setDoc(doc(fs, "site/carte"), { jour: { vid: { v: String(Date.now()), n: 0, url, type: file.type || "video/mp4", size: file.size, name: String(file.name || "").slice(0, 80) } } }, { merge: true });
      const old = await getDocs(collection(fs, "carteJour")); await Promise.all(old.docs.map((d) => deleteDoc(d.ref)));
      return;
    }
    const buf = new Uint8Array(await file.arrayBuffer()), CH = 900 * 1024, n = Math.ceil(buf.length / CH), v = String(Date.now());
    for (let i = 0; i < n; i++) {
      await setDoc(doc(fs, `carteJour/${v}_${i}`), { v, i, b: Bytes.fromUint8Array(buf.subarray(i * CH, Math.min(buf.length, (i + 1) * CH))) });
      onProgress && onProgress((i + 1) / n);
    }
    await setDoc(doc(fs, "site/carte"), { jour: { vid: { v, n, type: file.type || "video/mp4", size: buf.length, name: String(file.name || "").slice(0, 80) } } }, { merge: true });
    const old = await getDocs(collection(fs, "carteJour"));
    await Promise.all(old.docs.filter((d) => d.data().v !== v).map((d) => deleteDoc(d.ref)));
  }
};

/* ---------- Galeries des prestations (page « réalisations » du site) ---------- */
window.__apocaGal = {
  listen(cat, cb) { return onSnapshot(query(collection(fs, "galerie"), where("cat", "==", cat)), (q) => cb(q.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || (a.created || 0) - (b.created || 0))), () => cb([])); },
  listenInfo(cat, cb) { return onSnapshot(doc(fs, `galerieInfo/${cat}`), (s) => cb(s.exists() ? s.data() : {}), () => cb({})); },
  saveInfo(cat, d) { return setDoc(doc(fs, `galerieInfo/${cat}`), JSON.parse(JSON.stringify(d)), { merge: true }); },
  save(id, d) { return setDoc(doc(fs, `galerie/${id}`), JSON.parse(JSON.stringify(d)), { merge: true }); },
  async addVideo(id, cat, file, poster, order, onProgress) {
    const url = await videoToFile("galerie", file, onProgress);
    if (url) return setDoc(doc(fs, `galerie/${id}`), { cat, type: "video", img: poster || "", mime: file.type || "video/mp4", n: 0, url, size: file.size, order, created: Date.now() });
    const buf = new Uint8Array(await file.arrayBuffer()), CH = 900 * 1024, n = Math.ceil(buf.length / CH);
    for (let i = 0; i < n; i++) {
      await setDoc(doc(fs, `galerieChunks/${id}_${i}`), { vid: id, i, b: Bytes.fromUint8Array(buf.subarray(i * CH, Math.min(buf.length, (i + 1) * CH))) });
      onProgress && onProgress((i + 1) / n);
    }
    await setDoc(doc(fs, `galerie/${id}`), { cat, type: "video", img: poster || "", mime: file.type || "video/mp4", n, size: buf.length, order, created: Date.now() });
  },
  async del(x) {
    await deleteDoc(doc(fs, `galerie/${x.id}`));
    if (x.type === "video") { const q = await getDocs(query(collection(fs, "galerieChunks"), where("vid", "==", x.id))); await Promise.all(q.docs.map((d) => deleteDoc(d.ref))); }
  }
};

/* ---------- Devis en ligne (page publique du site) ---------- */
window.__apocaDevis = {
  publish(token, d) { return setDoc(doc(fs, `devis/${token}`), JSON.parse(JSON.stringify(d)), { merge: true }); },
  outbox(id, d) { const u = auth.currentUser; if (!u) return Promise.reject(new Error("not-signed-in")); return setDoc(doc(fs, `users/${u.uid}/outbox/${id}`), d); },
  watch(id, cb) { const u = auth.currentUser; if (!u) return () => {}; return onSnapshot(doc(fs, `users/${u.uid}/outbox/${id}`), (s) => cb(s.exists() ? s.data() : null), () => {}); },
  saveMail(d) { const u = auth.currentUser; if (!u) return Promise.reject(new Error("not-signed-in")); return setDoc(doc(fs, `users/${u.uid}/private/mail`), d); },
  watchMail(cb) { const u = auth.currentUser; if (!u) return () => {}; return onSnapshot(doc(fs, `users/${u.uid}/private/mail`), (s) => { const x = s.exists() ? s.data() : {}; cb({ gmail: x.gmail || "", ok: !!(x.gmail && x.pass) }); }, () => cb({ gmail: "", ok: false })); },
  email() { return (auth.currentUser && auth.currentUser.email) || ""; }
};

/* ---------- Cartes cadeaux : la page publique que voit l'acheteur ---------- */
window.__apocaCadeau = {
  publish(id, d) { return setDoc(doc(fs, `cartesCadeau/${id}`), JSON.parse(JSON.stringify(d)), { merge: true }); },
  remove(id) { return deleteDoc(doc(fs, `cartesCadeau/${id}`)); },
  saveSecret(secret) { const u = auth.currentUser; if (!u) return Promise.reject(new Error("not-signed-in")); return setDoc(doc(fs, `users/${u.uid}/private/paypal`), { secret: String(secret || "").trim(), updated: Date.now() }); },
  watchStatus(cb) { const u = auth.currentUser; if (!u) return () => {}; return onSnapshot(doc(fs, `users/${u.uid}/meta/paypalStatus`), (s) => cb(s.exists() ? s.data() : null), () => cb(null)); },
  watchSecret(cb) { const u = auth.currentUser; if (!u) return () => {}; return onSnapshot(doc(fs, `users/${u.uid}/private/paypal`), (s) => cb(!!(s.exists() && s.data().secret)), () => cb(false)); }
};

/* ---------- Mon site (contenu public du site, modifiable par le propriétaire) ---------- */
window.__apocaSiteAdmin = {
  listen(cb) {
    const u = [
      onSnapshot(doc(fs, "site/content"), (s) => cb("content", s.exists() ? s.data() : {}), () => cb("content", {})),
      onSnapshot(doc(fs, "site/heroPhoto"), (s) => cb("heroPhoto", s.exists() ? (s.data().img || "") : ""), () => cb("heroPhoto", "")),
      onSnapshot(doc(fs, "site/heroVideoMeta"), (s) => cb("heroVideoMeta", s.exists() ? s.data() : null), () => cb("heroVideoMeta", null)),
      onSnapshot(doc(fs, "site/aboutPhoto"), (s) => cb("aboutPhoto", s.exists() ? (s.data().img || "") : ""), () => cb("aboutPhoto", "")),
      onSnapshot(doc(fs, "site/coulisse1Photo"), (s) => cb("coulisse1Photo", s.exists() ? (s.data().img || "") : ""), () => cb("coulisse1Photo", "")),
      onSnapshot(doc(fs, "site/coulisse2Photo"), (s) => cb("coulisse2Photo", s.exists() ? (s.data().img || "") : ""), () => cb("coulisse2Photo", "")),
      onSnapshot(collection(fs, "films"), (q) => cb("films", q.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb("films", [])),
      onSnapshot(collection(fs, "avis"), (q) => cb("avis", q.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb("avis", [])),
      onSnapshot(collection(fs, "journal"), (q) => cb("journal", q.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb("journal", [])),
      onSnapshot(collection(fs, "insta"), (q) => cb("insta", q.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb("insta", [])),
      onSnapshot(collection(fs, "moments"), (q) => cb("moments", q.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb("moments", []))
    ];
    return () => u.forEach((f) => f());
  },
  save(patch) { return setDoc(doc(fs, "site/content"), JSON.parse(JSON.stringify(patch)), { merge: true }); },
  setPhoto(w, img) { const r = doc(fs, `site/${w}Photo`); return img ? setDoc(r, { img, updated: Date.now() }) : deleteDoc(r); },
  saveFilm(id, d) { return setDoc(doc(fs, `films/${id}`), JSON.parse(JSON.stringify(d)), { merge: true }); },
  delFilm(id) { return deleteDoc(doc(fs, `films/${id}`)); },
  saveAvis(id, d) { return setDoc(doc(fs, `avis/${id}`), JSON.parse(JSON.stringify(d)), { merge: true }); },
  delAvis(id) { return deleteDoc(doc(fs, `avis/${id}`)); },
  listenPending(cb) { return onSnapshot(collection(fs, "avisClients"), (q) => cb(q.docs.map((d) => { const x = d.data(); return { id: d.id, ...x, at: x.at && x.at.toMillis ? x.at.toMillis() : Date.now() }; })), () => cb([])); },
  async publish(id, d) { await setDoc(doc(fs, `avis/${id}`), JSON.parse(JSON.stringify(d))); await deleteDoc(doc(fs, `avisClients/${id}`)); },
  delPending(id) { return deleteDoc(doc(fs, `avisClients/${id}`)); },
  // Vidéo d'accueil : découpée en morceaux de 900 Ko dans la base (pas besoin d'activer le stockage de fichiers).
  // Image d'attente (première image de la vidéo) pour l'accueil du site, affichée pendant le chargement.
  async heroPoster(makePoster) {
    const m = (await getDocs(collection(fs, "heroVideo"))).docs.map((d) => d.data());
    const meta = await new Promise((r) => { const u = onSnapshot(doc(fs, "site/heroVideoMeta"), (s) => { u(); r(s.exists() ? s.data() : null); }, () => r(null)); });
    if (!meta) return "";
    if (meta.url) return meta.poster || "";
    const parts = m.filter((d) => d.v === meta.updated).sort((a, b) => a.i - b.i);
    if (parts.length !== meta.n) return "";
    const poster = await makePoster(new Blob(parts.map((d) => d.b.toUint8Array()), { type: meta.type || "video/mp4" }));
    if (poster) await setDoc(doc(fs, "site/heroVideoMeta"), { poster }, { merge: true });
    return poster;
  },
  async setHeroVideo(file, onProgress, poster) {
    const url = await videoToFile("accueil", file, onProgress);
    if (url) {
      await setDoc(doc(fs, "site/heroVideoMeta"), { n: 0, url, type: file.type || "video/mp4", size: file.size, name: String(file.name || "").slice(0, 80), updated: Date.now(), poster: poster || "" });
      const old = await getDocs(collection(fs, "heroVideo")); await Promise.all(old.docs.map((d) => deleteDoc(d.ref)));
      return;
    }
    const buf = new Uint8Array(await file.arrayBuffer()), CH = 900 * 1024, n = Math.ceil(buf.length / CH), v = Date.now();
    for (let i = 0; i < n; i++) {
      await setDoc(doc(fs, `heroVideo/${i}`), { i, v, b: Bytes.fromUint8Array(buf.subarray(i * CH, Math.min(buf.length, (i + 1) * CH))) });
      onProgress && onProgress((i + 1) / n);
    }
    await setDoc(doc(fs, "site/heroVideoMeta"), { n, type: file.type || "video/mp4", size: buf.length, name: String(file.name || "").slice(0, 80), updated: v, poster: poster || "" });
    const old = await getDocs(collection(fs, "heroVideo"));
    await Promise.all(old.docs.filter((d) => d.data().v !== v).map((d) => deleteDoc(d.ref)));
  },
  async delHeroVideo() {
    await deleteDoc(doc(fs, "site/heroVideoMeta"));
    const old = await getDocs(collection(fs, "heroVideo"));
    await Promise.all(old.docs.map((d) => deleteDoc(d.ref)));
  },
  saveJournal(id, d) { return setDoc(doc(fs, `journal/${id}`), JSON.parse(JSON.stringify(d)), { merge: true }); },
  delJournal(id) { return deleteDoc(doc(fs, `journal/${id}`)); },
  saveInsta(id, d) { return setDoc(doc(fs, `insta/${id}`), JSON.parse(JSON.stringify(d)), { merge: true }); },
  delInsta(id) { return deleteDoc(doc(fs, `insta/${id}`)); },
  saveMoment(id, d) { return setDoc(doc(fs, `moments/${id}`), JSON.parse(JSON.stringify(d)), { merge: true }); },
  delMoment(id) { return deleteDoc(doc(fs, `moments/${id}`)); },
  listenStats(cb) { return onSnapshot(collection(fs, "stats"), (q) => { const m = {}; q.docs.forEach((d) => { m[d.id] = d.data(); }); cb(m); }, () => cb({})); },
  listenResa(cb) { return onSnapshot(collection(fs, "resaPhotos"), (q) => { const m = {}; q.docs.forEach((d) => { if (d.data().img) m[d.id] = d.data().img; }); cb(m); }, () => cb({})); },
  setResa(k, img) { const r = doc(fs, `resaPhotos/${k}`); return img ? setDoc(r, { img, updated: Date.now() }) : deleteDoc(r); }
};

/* ---------- Déménagement des anciennes photos et vidéos vers le stockage de fichiers ----------
   Lancé tout seul une fois connecté. Il reprend là où il s'est arrêté, et ne touche rien si le stockage ne répond pas. */
window.__apocaMigrate = async function (log) {
  const say = (m) => { try { console.log("[déménagement]", m); log && log(m); } catch (e) {} };
  try { await upFile("media/.test", new Blob(["ok"], { type: "text/plain" })); } catch (e) { say("stockage pas encore prêt"); return "off"; }
  let done = 0;
  const fix = async (r, d) => { if (!hasData(d)) return; await _setDoc(r, await toFiles(d, String(r.path).split("/")[0])); done++; };
  const cols = ["site", "films", "journal", "insta", "moments", "avis", "resaPhotos", "galerie", "galerieInfo", "destinations", "cartesCadeau"];
  for (const c of cols) {
    const q = await getDocs(collection(fs, c)).catch(() => null); if (!q) continue;
    for (const d of q.docs) {
      await fix(d.ref, d.data());
      if (c === "destinations") { const ph = await getDocs(collection(fs, `destinations/${d.id}/photos`)).catch(() => null); if (ph) for (const p of ph.docs) await fix(p.ref, p.data()); }
    }
  }
  // vidéo d'accueil
  const hm = (await getDocs(collection(fs, "site"))).docs.find((d) => d.id === "heroVideoMeta");
  const m = hm && hm.data();
  if (m && m.n && !m.url) { const b = await chunkBlob("heroVideo", null, m.updated, m.n, m.type); if (b) { const url = await upFile(`media/accueil/${m.updated}.${EXT[b.type] || "mp4"}`, b); await _setDoc(hm.ref, { url, n: 0 }, { merge: true }); const old = await getDocs(collection(fs, "heroVideo")); await Promise.all(old.docs.map((d) => deleteDoc(d.ref))); done++; } }
  // film du jour de la carte
  const cd = (await getDocs(collection(fs, "site"))).docs.find((d) => d.id === "carte");
  const j = cd && cd.data().jour;
  if (j && j.vid && j.vid.n && !j.vid.url) { const b = await chunkBlob("carteJour", "v", j.vid.v, j.vid.n, j.vid.type); if (b) { const url = await upFile(`media/carte/${j.vid.v}.${EXT[b.type] || "mp4"}`, b); await _setDoc(cd.ref, { jour: { vid: { ...j.vid, url, n: 0 } } }, { merge: true }); const old = await getDocs(collection(fs, "carteJour")); await Promise.all(old.docs.map((d) => deleteDoc(d.ref))); done++; } }
  // vidéos des galeries
  const g = await getDocs(collection(fs, "galerie"));
  for (const d of g.docs) { const x = d.data(); if (x.type !== "video" || !x.n || x.url) continue;
    const b = await chunkBlob("galerieChunks", "vid", d.id, x.n, x.mime); if (!b) continue;
    const url = await upFile(`media/galerie/${d.id}.${EXT[b.type] || "mp4"}`, b);
    await _setDoc(d.ref, { url, n: 0 }, { merge: true });
    const q = await getDocs(query(collection(fs, "galerieChunks"), where("vid", "==", d.id))); await Promise.all(q.docs.map((y) => deleteDoc(y.ref))); done++; }
  say(`terminé · ${done} élément(s) déplacé(s)`); return done;
};
