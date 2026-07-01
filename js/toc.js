// Reser läs-toppbaren för en delrapport.
// Anropas en gång per kapitelsida (via en OJS-cell i index.qmd).
// - en slank topbar som visar var läsaren befinner sig: AVSNITT › UNDERRUBRIK
// - en SEGMENTERAD positions-bar längst ner: en ruta per avsnitt som fylls
//   medan man läser, visar titeln vid hover och hoppar dit vid klick
// - fäller ut hela innehållsförteckningen (tvånivå: avsnitt → underrubriker)
//   som en meny, med aktiv rad markerad.

function h(tag, attrs = {}, ...barn) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  for (const b of barn.flat()) {
    if (b == null) continue;
    el.appendChild(typeof b === "string" ? document.createTextNode(b) : b);
  }
  return el;
}

const tva = (n) => String(n).padStart(2, "0");
const klamp = (v) => Math.max(0, Math.min(1, v));

// Ren textetikett ur en rubrik (klona, kapa ev. Quarto-ankarlänkar)
function rubrikText(el, fallback) {
  if (!el) return fallback;
  const klon = el.cloneNode(true);
  klon.querySelectorAll("a").forEach((a) => a.remove());
  return klon.textContent.trim() || fallback;
}

// Flyttar ut figurtitel/undertitel/källa till en rapport-bildtext UNDER rutan
// ("Figur N. …") och numrerar löpande per kapitel (steppern = en figur). Körs
// om via en observer eftersom OJS monterar figurerna asynkront.
function numreraFigurer(root) {
  const sattText = (el, txt) => { if (el && el.textContent !== txt) el.textContent = txt; };
  let obs = null;

  const flush = () => {
    if (obs) obs.disconnect();
    const enheter = [...root.querySelectorAll(".graf-stepper, .graf-container")]
      .filter((el) => el.classList.contains("graf-stepper") || !el.closest(".graf-stepper"));

    enheter.forEach((enhet, i) => {
      // Titel/undertitel/källa stannar INNE i grafen. Här ut bara en
      // rapport-referens under rutan: "Figur N. [titel]".
      const titel = (enhet.querySelector(".graf-title")?.textContent || "").trim();

      let cap = enhet.nextElementSibling;
      if (!cap || !cap.classList.contains("kr-figurtext")) {
        cap = document.createElement("figcaption");
        cap.className = "kr-figurtext";
        ["num", "titel"].forEach((k) =>
          cap.appendChild(Object.assign(document.createElement("span"), { className: "kr-figurtext-" + k }))
        );
        enhet.insertAdjacentElement("afterend", cap);
      }
      const titelP = titel && !/[.!?:]$/.test(titel) ? titel + "." : titel;
      sattText(cap.querySelector(".kr-figurtext-num"), `Figur ${i + 1}.`);
      sattText(cap.querySelector(".kr-figurtext-titel"), titelP);
    });
    if (obs) obs.observe(root, { childList: true, subtree: true });
  };

  flush();
  let vantar = false;
  obs = new MutationObserver(() => {
    if (vantar) return;
    vantar = true;
    requestAnimationFrame(() => { vantar = false; flush(); });
  });
  obs.observe(root, { childList: true, subtree: true });
}

export function byggToc() {
  const rapport = document.querySelector(".kr-rapport");
  if (!rapport || rapport.dataset.toc) return;
  const sektioner = [...rapport.querySelectorAll(".kr-rapport-sektion")];
  if (!sektioner.length) return;
  rapport.dataset.toc = "1";

  const accent = getComputedStyle(rapport).getPropertyValue("--accent").trim();

  // ── Avsnittsdata (id + titel + underrubriker) ──
  const data = sektioner.map((sek, i) => {
    let id = sek.id;
    if (!id) { id = `sektion-${i + 1}`; sek.id = id; }
    const titel = rubrikText(sek.querySelector("h2"), `Avsnitt ${i + 1}`);
    const subs = [...sek.querySelectorAll("h3")].map((h3, j) => {
      let sid = h3.id;
      if (!sid) { sid = `${id}-h3-${j + 1}`; h3.id = sid; }
      return { el: h3, id: sid, titel: rubrikText(h3, `Del ${j + 1}`) };
    });
    return { sek, id, titel, nr: tva(i + 1), subs };
  });

  // Platt rubriklista i dokumentordning för scrollspy: h2, dess h3:or, nästa h2 …
  const flat = [];
  data.forEach((d, si) => {
    flat.push({ el: d.sek.querySelector("h2") || d.sek, si, sub: -1 });
    d.subs.forEach((s, sj) => flat.push({ el: s.el, si, sub: sj }));
  });

  // ── Meny (utfällbar innehållsförteckning, tvånivå, fulla titlar) ──
  const sekLankar = [];
  const subLankar = [];
  const meny = h("div", { class: "kr-rapport-meny" });
  data.forEach((d) => {
    const grupp = h("div", { class: "kr-rapport-meny-grupp" });
    const sekLank = h(
      "a",
      { class: "kr-rapport-meny-lank kr-rapport-meny-lank--sek", href: "#" + d.id },
      h("span", { class: "kr-rapport-meny-num" }, d.nr),
      h("span", {}, d.titel)
    );
    sekLankar.push(sekLank);
    grupp.appendChild(sekLank);

    const subArr = [];
    if (d.subs.length) {
      const sublista = h("div", { class: "kr-rapport-meny-sub" });
      d.subs.forEach((s) => {
        const sl = h("a", { class: "kr-rapport-meny-sublank", href: "#" + s.id }, s.titel);
        subArr.push(sl);
        sublista.appendChild(sl);
      });
      grupp.appendChild(sublista);
    }
    subLankar.push(subArr);
    meny.appendChild(grupp);
  });

  // ── Toppbar (övre raden) ──
  const nuNum = h("span", { class: "kr-rapport-topbar-num" }, data[0].nr);
  const nuTitel = h("span", { class: "kr-rapport-topbar-titel" }, data[0].titel);
  const nuSub = h("span", { class: "kr-rapport-topbar-sub" });
  const toggle = h(
    "button",
    { class: "kr-rapport-topbar-toggle", type: "button", "aria-expanded": "false", "aria-label": "Visa innehåll" },
    nuNum, nuTitel, nuSub,
    h("span", { class: "kr-rapport-topbar-chevron" }, "▾")
  );
  const hoger = h("div", { class: "kr-rapport-topbar-hoger" }, toggle, meny);
  const tillbaka = h("a", { class: "kr-rapport-topbar-tillbaka", href: "../" }, "← Alla kapitel");

  // ── Segmenterad positions-bar (en ruta per avsnitt) ──
  const segFyll = [];
  const segEl = [];
  const segbar = h("div", { class: "kr-rapport-segbar" });
  data.forEach((d) => {
    const fyll = h("span", { class: "kr-rapport-seg-fyll" });
    const tip = h(
      "span", { class: "kr-rapport-seg-tip" },
      h("span", { class: "kr-rapport-seg-tip-num" }, d.nr),
      d.titel
    );
    const seg = h("button", { class: "kr-rapport-seg", type: "button", "aria-label": `Gå till ${d.titel}` }, fyll, tip);
    seg.addEventListener("click", () => {
      const y = d.sek.getBoundingClientRect().top + window.scrollY - 70;
      window.scrollTo({ top: y, behavior: "smooth" });
    });
    segbar.appendChild(seg);
    segEl.push(seg);
    segFyll.push(fyll);
  });

  const bar = h(
    "div",
    { class: "kr-rapport-topbar" },
    h("div", { class: "kr-rapport-topbar-inner" }, tillbaka, hoger),
    segbar
  );
  if (accent) bar.style.setProperty("--accent", accent);
  document.body.appendChild(bar);
  document.body.classList.add("har-topbar"); // ger innehållet plats under baren

  // Öppna/stäng menyn
  let oppen = false;
  const settOppen = (v) => {
    oppen = v;
    bar.classList.toggle("ar-meny", v);
    toggle.setAttribute("aria-expanded", String(v));
  };
  toggle.addEventListener("click", (e) => { e.stopPropagation(); settOppen(!oppen); });
  document.addEventListener("click", () => oppen && settOppen(false));
  meny.addEventListener("click", () => settOppen(false));

  // ── Scrollspy (sista rubriken ovanför tröskeln är aktiv) ──
  const TROSKEL = 120;
  let aktivSi = -1;
  let aktivSub = -2;
  const spy = () => {
    let idx = 0;
    for (let i = 0; i < flat.length; i++) {
      if (flat[i].el.getBoundingClientRect().top - TROSKEL <= 0) idx = i;
    }
    const f = flat[idx];
    if (f.si === aktivSi && f.sub === aktivSub) return;
    aktivSi = f.si;
    aktivSub = f.sub;
    const d = data[aktivSi];
    nuNum.textContent = d.nr;
    nuTitel.textContent = d.titel;
    nuSub.textContent = f.sub >= 0 ? d.subs[f.sub].titel : "";
    sekLankar.forEach((l, si) => l.classList.toggle("ar-aktiv", si === aktivSi));
    subLankar.forEach((arr, si) =>
      arr.forEach((l, sj) => l.classList.toggle("ar-aktiv", si === aktivSi && sj === f.sub))
    );
    segEl.forEach((s, si) => s.classList.toggle("ar-aktiv", si === aktivSi));
  };

  // ── Segment-fyllnad (läsprogress per avsnitt) ──
  // Fyll = hur långt läsraden (TROSKEL) passerat genom avsnittet. Sista avsnittet
  // hinner aldrig scrollas så att läsraden når dess botten, så där skalar vi om
  // intervallet [0, max-möjlig] → [0, 1] så det fylls jämnt 0→100% till sidans slut.
  const fyllSeg = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const y = window.scrollY;
    data.forEach((d, i) => {
      const rect = d.sek.getBoundingClientRect();
      const topDoc = rect.top + y;
      let f;
      if (i === data.length - 1) {
        const intraMax = (max + TROSKEL - topDoc) / rect.height;
        const intraNu = (y + TROSKEL - topDoc) / rect.height;
        f = intraMax > 0 ? klamp(intraNu / intraMax) : klamp(intraNu);
      } else {
        f = klamp((TROSKEL - rect.top) / rect.height);
      }
      segFyll[i].style.width = (f * 100) + "%";
    });
  };

  let ko = false;
  const vidScroll = () => {
    if (ko) return;
    ko = true;
    requestAnimationFrame(() => { ko = false; spy(); fyllSeg(); });
  };
  window.addEventListener("scroll", vidScroll, { passive: true });
  window.addEventListener("resize", vidScroll, { passive: true });
  spy();
  fyllSeg();

  numreraFigurer(rapport);
}
