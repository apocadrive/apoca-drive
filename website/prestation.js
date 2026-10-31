/* Pages prestations : réalisations en direct depuis l'appli, photo en grand, bouton Réserver qui ouvre la bonne prestation */

const P = window.PRESTA || {};
const $ = (s) => document.querySelector(s);
const E = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Réserver : ouvre la fenêtre de réservation de l'accueil directement sur cette prestation */
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest("a[data-book]"); if (!a) return;
  try { if (P.book) sessionStorage.setItem("bkRestore", JSON.stringify({ c: P.book.c, s: P.book.s ?? -1, p: 3 })); } catch (err) {}
});

/* apparition douce au défilement */
const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.add("on"); io.unobserve(x.target); } }), { rootMargin: "0px 0px -8% 0px" }) : null;
document.querySelectorAll(".reveal").forEach((el) => (io ? io.observe(el) : el.classList.add("on")));

/* photo en grand */
const lb = document.createElement("div"); lb.className = "lb"; lb.hidden = true; lb.setAttribute("role", "dialog"); lb.setAttribute("aria-label", "Photo en grand");
lb.innerHTML = `<button type="button" class="x" aria-label="Fermer">×</button><button type="button" class="p" aria-label="Photo précédente">‹</button><img alt=""><button type="button" class="n" aria-label="Photo suivante">›</button>`;
document.body.appendChild(lb);
let PH = [], k = 0;
const show = (i) => { if (!PH.length) return; k = (i + PH.length) % PH.length; lb.querySelector("img").src = PH[k]; lb.hidden = false; };
lb.addEventListener("click", (e) => { if (e.target.closest(".n")) show(k + 1); else if (e.target.closest(".p")) show(k - 1); else if (e.target.closest(".x") || e.target === lb) lb.hidden = true; });
addEventListener("keydown", (e) => { if (lb.hidden) return; if (e.key === "Escape") lb.hidden = true; else if (e.key === "ArrowRight") show(k + 1); else if (e.key === "ArrowLeft") show(k - 1); });

const ytId = (u) => { const m = String(u || "").match(/(?:youtu\.be\/|v=|shorts\/|embed\/|live\/)([\w-]{11})/); return m ? m[1] : (/^[\w-]{11}$/.test(String(u || "").trim()) ? String(u).trim() : ""); };

(async () => {
  if (!P.cats || !P.cats.length) return;
  try {
    /* chargé à part : si la base ne répond pas, le reste de la page fonctionne quand même */
    const [{ initializeApp }, { getFirestore, collection, getDocs, getDoc, doc, query, where }] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"), import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js")]);
    const app = initializeApp({ apiKey: "AIzaSyC9gZ9xNB3vYiYcOE9pIsgqINYTvT768lc", authDomain: "apoca-drive.firebaseapp.com", projectId: "apoca-drive", appId: "1:826000114685:web:4ed7cf006753e352a24f94", messagingSenderId: "826000114685" });
    const fs = getFirestore(app);
    const res = await Promise.all(P.cats.map((c) => getDocs(query(collection(fs, "galerie"), where("cat", "==", c))).catch(() => null)));
    const items = res.flatMap((q) => (q ? q.docs.map((d) => ({ id: d.id, ...d.data() })) : [])).filter((x) => !x.hidden && x.img)
      .sort((a, b) => (b.hero ? 1 : 0) - (a.hero ? 1 : 0) || (a.order ?? 1e9) - (b.order ?? 1e9) || (a.created || 0) - (b.created || 0)).slice(0, 12);
    const G = $("#ggrid");
    if (items.length && G) {
      PH = items.map((x) => x.img);
      G.innerHTML = items.map((x, i) => `<button type="button" data-i="${i}" aria-label="${x.type === "video" ? "Vidéo" : "Photo"} en grand"><img src="${E(x.img)}" alt="" loading="lazy">${x.type === "video" ? `<span class="pl"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>` : ""}</button>`).join("");
      G.addEventListener("click", (e) => { const b = e.target.closest("button[data-i]"); if (!b) return; const x = items[+b.dataset.i];
        if (x.type === "video") { try { sessionStorage.setItem("bkRestore", JSON.stringify({ c: P.book.c, s: P.book.s ?? -1, p: 3 })); } catch (err) {} location.href = "/#reserver"; return; }
        show(PH.indexOf(x.img)); });
      $("#gal").hidden = false;
      /* la plus belle photo devient le fond du haut de page, si la page n'a pas d'image à elle */
      const bg = $(".hero .bg"); if (bg && bg.dataset.auto === "1") { const f = items.find((x) => x.hero && x.type !== "video") || items.find((x) => x.type !== "video") || items[0]; if (f) { bg.style.opacity = 0; bg.onload = () => { bg.style.opacity = 1; }; bg.src = f.img; } }
    }
    if (P.youtube) {
      const inf = await getDoc(doc(fs, "galerieInfo", P.youtube)).catch(() => null);
      const ids = String(((inf && inf.exists() && inf.data()) || {}).youtube || "").split(/[\s,]+/).map(ytId).filter(Boolean).slice(0, 6);
      const Y = $("#ytgrid");
      if (ids.length && Y) {
        Y.innerHTML = ids.map((id) => `<button type="button" class="yt" data-yt="${id}" aria-label="Lire le clip"><img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" loading="lazy"><span class="pl"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span></button>`).join("");
        Y.addEventListener("click", (e) => { const b = e.target.closest("button[data-yt]"); if (!b || b.querySelector("iframe")) return;
          b.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${b.dataset.yt}?autoplay=1&rel=0" title="Clip" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`; });
        $("#ytsec").hidden = false;
      }
    }
  } catch (e) {}
})();
