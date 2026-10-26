// Apoca Drive · notifications envoyées par le serveur.
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { setGlobalOptions, logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ region: "europe-west1", maxInstances: 2 });
const db = admin.firestore();
const TZ = "Europe/Paris";
const ICON = "https://apoca-drive.web.app/icons/icon-192.png";

const ymd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const hm = (t) => (t || "").replace(":", " h ");

async function sendToUser(uid, title, body, link) {
  const devs = await db.collection(`users/${uid}/devices`).get();
  const tokens = devs.docs.map((d) => d.get("token")).filter(Boolean);
  const log = (o) => db.doc(`users/${uid}/meta/pushStatus`).set({ at: Date.now(), title, devices: tokens.length, ...o }).catch(() => {});
  if (!tokens.length) { await log({ success: 0, errors: ["aucun appareil enregistré"] }); return 0; }
  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    webpush: { notification: { title, body, icon: ICON, badge: ICON }, fcmOptions: { link: link || "https://apoca-drive.web.app/" } }
  });
  // Remove devices whose token is no longer valid.
  const dead = [];
  res.responses.forEach((r, i) => {
    const c = r.error && r.error.code;
    if (c === "messaging/registration-token-not-registered" || c === "messaging/invalid-registration-token") dead.push(devs.docs[i].ref.delete());
  });
  await Promise.all(dead);
  await log({ success: res.successCount, errors: res.responses.filter((r) => r.error).map((r) => `${r.error.code}: ${String(r.error.message).slice(0, 160)}`) });
  return res.successCount;
}

// Chaque matin à 7 h 45 (heure de Paris) : alerte la veille et le jour J.
exports.alertesTournages = onSchedule({ schedule: "45 7 * * *", timeZone: TZ }, async () => {
  const now = new Date();
  const today = ymd(now);
  const tomorrow = ymd(new Date(now.getTime() + 24 * 3600 * 1000));
  const users = await db.collection("users").listDocuments();
  for (const u of users) {
    const snap = await db.collection(`users/${u.id}/shoots`).where("date", "in", [today, tomorrow]).get();
    for (const doc of snap.docs) {
      const s = doc.data();
      if (s.status === "Livré" || s.example) continue;
      const title = s.title || "Tournage";
      let head, body;
      if (s.date === tomorrow) {
        const left = (s.gear || []).filter((g) => !g.packed).length;
        head = `Demain${s.time ? " à " + hm(s.time) : ""} · ${title}`;
        body = `${s.city || ""}${s.city ? ". " : ""}Pensez à charger les batteries, vider les cartes et préparer le sac.${left ? ` Encore ${left} élément${left > 1 ? "s" : ""} à mettre dans le sac.` : ""}`;
      } else {
        head = `Aujourd'hui${s.time ? " à " + hm(s.time) : ""} · ${title}`;
        body = [s.place || s.city, s.contact ? `Contact : ${s.contact}` : ""].filter(Boolean).join(" · ") || "Bon tournage !";
      }
      const n = await sendToUser(u.id, head, body);
      logger.info("alerte", { uid: u.id, shoot: doc.id, sent: n });
    }
  }
});

// Bouton « Envoyer une notification test » dans l'app.
exports.notificationTest = onDocumentCreated("users/{uid}/pushTests/{id}", async (event) => {
  const n = await sendToUser(event.params.uid, "Apoca Drive · test réussi ✅", "Vos alertes de tournage arriveront ici, la veille et le jour J.");
  logger.info("test", { uid: event.params.uid, sent: n });
  if (event.data) await event.data.ref.delete();
});

/* ---------- Site client ---------- */
const OWNER_EMAIL = "apocadrive7@gmail.com";
let ownerUidCache = null;
async function ownerUid() {
  if (ownerUidCache) return ownerUidCache;
  const u = await admin.auth().getUserByEmail(OWNER_EMAIL);
  ownerUidCache = u.uid;
  return ownerUidCache;
}
const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
const frDate = (iso) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return ""; const [y, m, d] = iso.split("-").map(Number); return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d))); };

// Une demande envoyée depuis le site arrive dans l'appli, avec une notification.
exports.nouvelleDemande = onDocumentCreated("bookings/{id}", async (event) => {
  const b = event.data && event.data.data(); if (!b) return;
  const uid = await ownerUid();
  const r = {
    nom: clip(b.nom, 120), email: clip(b.email, 200), tel: clip(b.tel, 40), type: clip(b.type, 40),
    date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : "", dates: String(b.dates || "").split(",").filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).slice(0, 10).join(","), lieu: clip(b.lieu, 160), message: clip(b.message, 3000),
    status: "Nouvelle", created: Date.now(), source: "site"
  };
  await db.doc(`users/${uid}/requests/${event.params.id}`).set(r);
  await event.data.ref.delete();
  const head = `Nouvelle demande · ${r.type || "Projet"}`;
  const nd = r.dates ? r.dates.split(",").length : 0;
  const body = [r.nom, frDate(r.date) + (nd > 1 ? ` (+${nd - 1} jour${nd > 2 ? "s" : ""})` : ""), r.lieu].filter(Boolean).join(" · ");
  const n = await sendToUser(uid, head, body, `https://apoca-drive.web.app/?devis=${event.params.id}`);
  logger.info("demande", { id: event.params.id, sent: n });
});

// Dates prises : recalculées dès qu'un tournage change, publiées pour le calendrier du site (sans aucun détail privé).
exports.disponibilites = onDocumentWritten("users/{uid}/shoots/{id}", async (event) => {
  const uid = await ownerUid();
  if (event.params.uid !== uid) return;
  const today = ymd(new Date());
  const snap = await db.collection(`users/${uid}/shoots`).get();
  const busy = new Set();
  snap.docs.forEach((d) => {
    const s = d.data();
    if (s.example || s.status === "Annulé") return;
    if (s.date && s.date >= today) busy.add(s.date);
    const days = (s.strip && Array.isArray(s.strip.days)) ? s.strip.days : [];
    days.forEach((x) => { if (x && typeof x.date === "string" && x.date >= today) busy.add(x.date); });
  });
  await db.doc("public/availability").set({ busy: [...busy].sort(), updated: Date.now() });
});

// Un client laisse un avis sur le site : notification, l'avis attend la validation dans l'appli.
exports.nouvelAvis = onDocumentCreated("avisClients/{id}", async (event) => {
  const a = event.data && event.data.data(); if (!a) return;
  const uid = await ownerUid();
  const n = Math.max(1, Math.min(5, Number(a.etoiles) || 0));
  const head = `Nouvel avis ${"★".repeat(n)} · ${clip(a.nom, 60)}`;
  const body = `${clip(a.texte, 110)}${String(a.texte || "").length > 110 ? "…" : ""} · À valider dans Mon site`;
  const sent = await sendToUser(uid, head, body, "https://apoca-drive.web.app/");
  logger.info("avis", { id: event.params.id, sent });
});


/* ---------- Devis envoyés au client ---------- */
const escH = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// L'appli dépose un envoi dans users/{uid}/outbox : on l'envoie par e-mail depuis le Gmail du propriétaire, PDF joint.
exports.envoiDevis = onDocumentCreated("users/{uid}/outbox/{id}", async (event) => {
  const o = event.data && event.data.data(); if (!o) return;
  const ref = event.data.ref;
  const fail = (msg) => ref.set({ status: "erreur", error: msg, done: Date.now() }, { merge: true });
  try {
    const cfg = (await db.doc(`users/${event.params.uid}/private/mail`).get()).data() || {};
    const user = String(cfg.gmail || "").trim(), pass = String(cfg.pass || "").replace(/\s+/g, "");
    if (!user || !pass) return fail("non-configure");
    const to = String(o.to || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return fail("adresse-client");
    const nodemailer = require("nodemailer");
    const tr = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
    const from = `"${String(o.fromName || "Apoca Drive").replace(/"/g, "")}" <${user}>`;
    const html = `<div style="background:#F6F2EA;padding:32px 12px;font-family:Georgia,'Times New Roman',serif;color:#1E1B17">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E6DFD3;padding:36px 28px">
<p style="margin:0 0 6px;font:500 11px/1 Helvetica,Arial,sans-serif;letter-spacing:.32em;text-transform:uppercase;color:#A9802F">${escH(o.fromName || "Apoca Drive")}</p>
<h1 style="margin:0 0 22px;font-weight:400;font-size:30px;line-height:1.15">Votre devis <em style="color:#A9802F">${escH(o.num || "")}</em></h1>
<div style="font:400 15px/1.65 Helvetica,Arial,sans-serif;color:#4A453D;white-space:pre-wrap">${escH(o.text || "")}</div>
${o.total ? `<p style="margin:24px 0 0;font:400 13px/1.4 Helvetica,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8A8178">Total</p><p style="margin:4px 0 0;font-size:28px">${escH(o.total)}</p>` : ""}
${o.link ? `<p style="margin:28px 0 0"><a href="${escH(o.link)}" style="display:inline-block;background:#1E1B17;color:#fff;text-decoration:none;padding:15px 26px;font:500 12px/1 Helvetica,Arial,sans-serif;letter-spacing:.22em;text-transform:uppercase">Voir et accepter mon devis</a></p>` : ""}
<p style="margin:26px 0 0;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:#8A8178">Le devis est aussi joint en PDF à cet e-mail.${o.phone ? ` Une question ? ${escH(o.phone)}` : ""}</p>
</div></div>`;
    const attachments = o.pdf ? [{ filename: String(o.pdfName || "Devis.pdf"), content: Buffer.from(String(o.pdf), "base64"), contentType: "application/pdf" }] : [];
    await tr.sendMail({ from, to, replyTo: user, subject: String(o.subject || "Votre devis"), text: `${o.text || ""}${o.link ? `\n\nVoir et accepter le devis : ${o.link}` : ""}`, html, attachments });
    await ref.set({ status: "envoye", done: Date.now(), pdf: null }, { merge: true });
    logger.info("devis envoyé", { id: event.params.id });
  } catch (e) {
    const m = String((e && (e.responseCode === 535 || /Invalid login|Username and Password/i.test(e.message))) ? "identifiants" : (e && e.message) || "erreur").slice(0, 200);
    logger.error("envoi devis", { id: event.params.id, err: String(e && e.message) });
    await fail(m);
  }
});

// Le client touche « J'accepte » sur la page du devis : le devis passe en Accepté et une notification part.
exports.devisAccepte = onDocumentCreated("devisReponses/{token}", async (event) => {
  const r = event.data && event.data.data(); if (!r) return;
  const d = (await db.doc(`devis/${event.params.token}`).get()).data(); if (!d) return;
  const uid = await ownerUid();
  await db.doc(`devis/${event.params.token}`).set({ accepted: Date.now() }, { merge: true });
  if (d.qid) await db.doc(`users/${uid}/quotes/${d.qid}`).set({ status: "Accepté", acceptedAt: Date.now() }, { merge: true });
  const who = (d.client && d.client.name) || "Le client";
  const n = await sendToUser(uid, `Devis accepté ✅ · ${clip(who, 60)}`, `${d.num || ""}${d.object ? " · " + clip(d.object, 80) : ""}`, "https://apoca-drive.web.app/");
  logger.info("devis accepté", { token: event.params.token, sent: n });
});

// Rendez-vous : chaque minute, envoie les rappels choisis (5 min, 1 h, 1 jour… avant).
const RDV_LAB = { 5: "Dans 5 min", 15: "Dans 15 min", 30: "Dans 30 min", 60: "Dans 1 heure", 120: "Dans 2 heures", 1440: "Demain", 2880: "Dans 2 jours", 4320: "Dans 3 jours", 10080: "Dans une semaine" };
exports.rappelsRdv = onSchedule({ schedule: "* * * * *", timeZone: TZ }, async () => {
  const now = Date.now();
  const users = await db.collection("users").listDocuments();
  for (const u of users) {
    const snap = await u.collection("rdv").where("at", ">", now - 60e3).where("at", "<", now + 10080 * 60e3 + 15 * 60e3).get();
    for (const d of snap.docs) {
      const r = d.data(); if (r.done || !Array.isArray(r.rappels)) continue;
      const sent = r.sent || {};
      const due = r.rappels.filter((m) => !sent[m] && r.at - m * 60e3 <= now && r.at - m * 60e3 > now - 10 * 60e3);
      if (!due.length) continue;
      const m = Math.min(...due);
      const heure = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(r.at)).replace(":", " h ");
      const jour = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(r.at));
      const head = `🗓️ ${RDV_LAB[m] || "Bientôt"} · ${clip(r.nom || "Rendez-vous", 60)}`;
      const body = `${m >= 1440 ? jour + " à " : ""}${heure}${r.lieu ? " · " + clip(r.lieu, 80) : ""}`;
      const upd = {}; due.forEach((x) => { upd[x] = true; });
      await d.ref.set({ sent: { ...sent, ...upd } }, { merge: true });
      const n = await sendToUser(u.id, head, body, `https://apoca-drive.web.app/?rdv=${d.id}`);
      logger.info("rappel rdv", { uid: u.id, id: d.id, m, sent: n });
    }
  }
});
