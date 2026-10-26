// Apoca Drive · Firebase bridge (auth + Firestore), loaded as a module.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, setDoc, deleteDoc, onSnapshot, serverTimestamp, getDocs, Bytes, query, where } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
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

/* ---------- Carte QR (page apocadrive.web.app/carte) ---------- */
window.__apocaCarte = {
  listen(cb) { return onSnapshot(doc(fs, "site/carte"), (s) => cb(s.exists() ? s.data() : {}), () => cb({})); },
  save(patch) { return setDoc(doc(fs, "site/carte"), JSON.parse(JSON.stringify(patch)), { merge: true }); },
  async setJourVideo(file, onProgress) {
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

/* ---------- Mon site (contenu public du site, modifiable par le propriétaire) ---------- */
window.__apocaSiteAdmin = {
  listen(cb) {
    const u = [
      onSnapshot(doc(fs, "site/content"), (s) => cb("content", s.exists() ? s.data() : {}), () => cb("content", {})),
      onSnapshot(doc(fs, "site/heroPhoto"), (s) => cb("heroPhoto", s.exists() ? (s.data().img || "") : ""), () => cb("heroPhoto", "")),
      onSnapshot(doc(fs, "site/heroVideoMeta"), (s) => cb("heroVideoMeta", s.exists() ? s.data() : null), () => cb("heroVideoMeta", null)),
      onSnapshot(doc(fs, "site/aboutPhoto"), (s) => cb("aboutPhoto", s.exists() ? (s.data().img || "") : ""), () => cb("aboutPhoto", "")),
      onSnapshot(collection(fs, "films"), (q) => cb("films", q.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb("films", [])),
      onSnapshot(collection(fs, "avis"), (q) => cb("avis", q.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb("avis", [])),
      onSnapshot(collection(fs, "journal"), (q) => cb("journal", q.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb("journal", [])),
      onSnapshot(collection(fs, "insta"), (q) => cb("insta", q.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb("insta", []))
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
  async setHeroVideo(file, onProgress) {
    const buf = new Uint8Array(await file.arrayBuffer()), CH = 900 * 1024, n = Math.ceil(buf.length / CH), v = Date.now();
    for (let i = 0; i < n; i++) {
      await setDoc(doc(fs, `heroVideo/${i}`), { i, v, b: Bytes.fromUint8Array(buf.subarray(i * CH, Math.min(buf.length, (i + 1) * CH))) });
      onProgress && onProgress((i + 1) / n);
    }
    await setDoc(doc(fs, "site/heroVideoMeta"), { n, type: file.type || "video/mp4", size: buf.length, name: String(file.name || "").slice(0, 80), updated: v });
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
  listenStats(cb) { return onSnapshot(collection(fs, "stats"), (q) => { const m = {}; q.docs.forEach((d) => { m[d.id] = d.data(); }); cb(m); }, () => cb({})); },
  listenResa(cb) { return onSnapshot(collection(fs, "resaPhotos"), (q) => { const m = {}; q.docs.forEach((d) => { if (d.data().img) m[d.id] = d.data().img; }); cb(m); }, () => cb({})); },
  setResa(k, img) { const r = doc(fs, `resaPhotos/${k}`); return img ? setDoc(r, { img, updated: Date.now() }) : deleteDoc(r); }
};
