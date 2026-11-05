/* Apoca Drive · ouvertures en douceur
   Toutes les fenêtres (avis, journal, photos en grand, lecteur, contact) s'ouvrent et se ferment
   en fondu avec un léger mouvement, les questions (FAQ) se déplient doucement,
   les photos de la visionneuse se remplacent en fondu, et chaque page apparaît en douceur. */
(function () {
  var calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var EASE = "cubic-bezier(.22,1,.36,1)", IN = 520, OUT = 300;

  /* ---------- styles ---------- */
  var css = "" +
    "@keyframes douxFond{from{opacity:0}to{opacity:1}}" +
    "@keyframes douxBoite{from{opacity:0;transform:translateY(18px) scale(.975)}to{opacity:1;transform:none}}" +
    "@keyframes douxPop{from{opacity:0;transform:translateY(10px) scale(.94)}to{opacity:1;transform:none}}" +
    "@keyframes douxPage{from{opacity:0}to{opacity:1}}" +
    "[data-doux]:not([hidden]){animation:douxFond " + IN + "ms " + EASE + " both}" +
    "[data-doux]:not([hidden])>*{animation:douxBoite " + (IN + 120) + "ms " + EASE + " 60ms both}" +
    "[data-doux=pop]:not([hidden]){animation:douxPop " + IN + "ms " + EASE + " both;transform-origin:20% 100%}" +
    "[data-doux=pop]:not([hidden])>*{animation:none}" +
    "[data-doux].doux-out{animation:none!important;transition:opacity " + OUT + "ms ease,transform " + OUT + "ms ease;opacity:0!important;pointer-events:none}" +
    "[data-doux].doux-out>*{animation:none!important;transition:opacity " + OUT + "ms ease,transform " + OUT + "ms ease;opacity:0;transform:translateY(10px) scale(.985)}" +
    "[data-doux=pop].doux-out{transform:translateY(8px) scale(.96)}" +
    ".lb img,.pv video,.pv iframe{transition:opacity .45s ease}" +
    ".lb img.doux-swap{opacity:0}" +
    "details.doux-d>:not(summary){overflow:hidden}" +
    "html.doux-page body{animation:douxPage .6s ease both}" +
    "@media (prefers-reduced-motion:reduce){[data-doux],[data-doux]>*,html.doux-page body{animation:none!important;transition:none!important}}";
  var st = document.createElement("style"); st.id = "doux-css"; st.textContent = css;
  (document.head || document.documentElement).appendChild(st);
  if (!calm && !/(^|\/)(index\.html)?$/.test(location.pathname)) document.documentElement.classList.add("doux-page");

  /* ---------- fenêtres : fermeture en fondu, quel que soit le code qui les ferme ---------- */
  var SEL = ".rv, .jr, .lb, .pv, .cpop, .gv-pop, [role=dialog]:not(.bk):not(.ytp):not(.drw)";
  var desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "hidden");
  function soften(el) {
    if (!el || el.__doux || !el.matches || !el.matches(SEL)) return;
    el.__doux = true;
    el.setAttribute("data-doux", el.classList.contains("cpop") ? "pop" : "1");
    var timer = null;
    Object.defineProperty(el, "hidden", {
      configurable: true,
      get: function () { return timer ? true : desc.get.call(el); },
      set: function (v) {
        v = !!v;
        if (!v) { if (timer) { clearTimeout(timer); timer = null; el.classList.remove("doux-out"); } desc.set.call(el, false); return; }
        if (desc.get.call(el) || timer) { if (!timer) desc.set.call(el, true); return; }
        if (calm || !el.isConnected) { desc.set.call(el, true); return; }
        el.classList.add("doux-out");
        timer = setTimeout(function () { timer = null; el.classList.remove("doux-out"); desc.set.call(el, true); }, OUT);
      }
    });
  }
  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    soften(root);
    if (root.querySelectorAll) root.querySelectorAll(SEL).forEach(soften);
  }
  scan(document.documentElement);
  new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(scan); }); })
    .observe(document.documentElement, { childList: true, subtree: true });

  /* ---------- visionneuse : la photo suivante arrive en fondu ---------- */
  document.addEventListener("load", function (e) {
    var im = e.target;
    if (im.tagName === "IMG" && im.closest && im.closest(".lb")) { requestAnimationFrame(function () { im.classList.remove("doux-swap"); }); }
  }, true);
  var srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  if (srcDesc && !calm) {
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      configurable: true, get: srcDesc.get,
      set: function (v) {
        if (this.closest && this.closest(".lb") && this.getAttribute("src") && this.getAttribute("src") !== v && !this.closest(".lb").hidden) {
          var im = this; im.classList.add("doux-swap");
          setTimeout(function () { srcDesc.set.call(im, v); }, 180); return;
        }
        srcDesc.set.call(this, v);
      }
    });
  }

  /* ---------- questions (FAQ) : dépliage doux ---------- */
  function smoothDetails(d) {
    if (d.__doux) return; d.__doux = true; d.classList.add("doux-d");
    var sum = d.querySelector("summary"); if (!sum) return;
    sum.addEventListener("click", function (e) {
      if (calm) return;
      e.preventDefault();
      if (d.__anim) d.__anim.cancel();
      var start = d.offsetHeight;
      if (!d.open) {
        d.open = true;
        var end = d.offsetHeight;
        d.__anim = d.animate([{ height: start + "px" }, { height: end + "px" }], { duration: 480, easing: "cubic-bezier(.22,1,.36,1)" });
        [].forEach.call(d.children, function (c) { if (c !== sum) c.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 480, delay: 60, easing: "ease", fill: "backwards" }); });
      } else {
        var endc = sum.offsetHeight + (parseFloat(getComputedStyle(d).borderTopWidth) || 0) + (parseFloat(getComputedStyle(d).borderBottomWidth) || 0);
        d.__anim = d.animate([{ height: start + "px" }, { height: endc + "px" }], { duration: 360, easing: "cubic-bezier(.4,0,.2,1)" });
        d.__anim.onfinish = function () { d.open = false; };
      }
      d.style.overflow = "hidden";
      d.__anim.addEventListener("finish", function () { d.style.overflow = ""; d.__anim = null; });
      d.__anim.addEventListener("cancel", function () { d.style.overflow = ""; });
    });
  }
  function scanD(root) { if (root && root.querySelectorAll) { if (root.tagName === "DETAILS") smoothDetails(root); root.querySelectorAll("details").forEach(smoothDetails); } }
  scanD(document);
  new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) scanD(n); }); }); })
    .observe(document.documentElement, { childList: true, subtree: true });
})();
