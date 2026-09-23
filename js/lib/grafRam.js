// =============================================================================
// GRAFRAM — gemensam ram, typografi och reglage för alla grafmoduler.
//
// Alla moduler bygger sin figur i samma skal så att rapporten får ETT
// grafspråk (Our World in Data / kommundata-stil):
//
//   .graf-container
//     .graf-header      titel (Source Serif 4), undertitel, verktyg uppe till höger
//     .graf-avlasning   (valfri) en rad för hover-avläsning
//     .graf-body        svg + tooltip + rullgardinsmenyer
//     .graf-footer      .graf-controls (väljare: region, år …) + källrad
//
// Reglage som alla moduler delar:
//   yTitel()     horisontell y-titel ovanför y-axeln; blir en rullgardin när
//                grafen har flera mått (enhet väljs genom att klicka på titeln)
//   valPill()    liten knapp med rullgardin i nedre raden (t.ex. region)
//   skapaTooltip() enhetlig tooltip
//
// All CSS ligger i style.scss (sektionen GRAFSYSTEM). Ingen modul injicerar
// egna <style>-block längre.
// =============================================================================

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

// ── Typografi och färger (speglar style.scss) ──
export const TYP = {
  ui:    "'IBM Plex Sans', system-ui, -apple-system, sans-serif",
  titel: "'Source Serif 4', Georgia, serif"
};

export const FARG = {
  ink:    "#1f2422",   // starkaste text i grafen (titel, x-axel)
  text:   "#5b5b5b",   // axeletiketter, y-titel
  mjuk:   "#8a8f8d",   // undertext, källa
  dampad: "#c9cccb",   // nedtonade serier
  grid:   "#d9d9d9",   // streckade gridlinjer
  noll:   "#a8a8a8",   // nollinje / referens
  axel:   "#c4c8c6",   // x-axelns baslinje
  gron:   "#00664D",
  bla:    "#004990"
};

// Storlekar i SVG-pixlar (viewBox-enheter)
export const STORLEK = {
  tick: 12,        // y-axelns etiketter
  tickX: 12.5,     // x-axelns etiketter
  etikett: 12,     // direktetiketter vid linjeslut
  yTitel: 12,      // horisontell y-titel
  axelTitel: 12    // x-axeltitel
};

// Standardpalett för serier: Region Hallands grön och blå först
export const SERIEFARGER = ["#00664D", "#004990", "#FF7E00", "#433C9D", "#2DB8F6", "#A51300", "#895B42"];

// Kapitlets accentfärg (från --accent på .kr-rapport). Faller tillbaka på grön.
export function accentFarg(el) {
  try {
    const node = el && el.node ? el.node() : el;
    const v = getComputedStyle(node || document.body).getPropertyValue("--accent").trim();
    return v || FARG.gron;
  } catch (e) { return FARG.gron; }
}

// ── Textmätning (elementen är inte monterade när modulen ritar) ──
const _ctx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
export function matText(text, { size = 12, weight = 400, family = TYP.ui } = {}) {
  if (!_ctx) return String(text).length * size * 0.55;
  _ctx.font = `${weight} ${size}px ${family}`;
  return _ctx.measureText(String(text)).width;
}

export const fmtTal = (v, dec = 0) =>
  v == null || Number.isNaN(+v) ? "" :
  (+v).toLocaleString("sv-SE", { minimumFractionDigits: dec, maximumFractionDigits: dec });

// ── Ikoner (Feather-lika, 1.8 px linje) ──
export const IKON = {
  play:  '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M6 4l14 8-14 8z"/></svg>',
  paus:  '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/></svg>',
  ner:   '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  info:  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16.5"/><circle cx="12" cy="7.8" r="0.6" fill="currentColor"/></svg>',
  plus:  '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  pil:   '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
  kryss: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
  aterstall: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10"/></svg>'
};

// =============================================================================
// RAMEN
// =============================================================================
export function skapaRam({ title = null, subtitle = null, caption = null } = {}) {
  const container = d3.create("div").attr("class", "graf-container");
  const header = container.append("div").attr("class", "graf-header");
  const titleEl = header.append("div").attr("class", "graf-title").text(title || "")
    .style("display", title ? null : "none");
  const subtitleEl = header.append("div").attr("class", "graf-subtitle").text(subtitle || "")
    .style("display", subtitle ? null : "none");
  const tools = header.append("div").attr("class", "graf-tools");

  const body = container.append("div").attr("class", "graf-body");
  const svgWrap = body.append("div").attr("class", "graf-svg-container");

  const footer = container.append("div").attr("class", "graf-footer");
  const controls = footer.append("div").attr("class", "graf-controls");
  const controlsLeft = controls.append("div").attr("class", "graf-controls-left");
  const controlsRight = controls.append("div").attr("class", "graf-controls-right");
  const captionEl = footer.append("div").attr("class", "graf-caption").text(caption || "")
    .style("display", caption ? null : "none");

  let avlasningEl = null;

  return {
    container, header, tools, body, svgWrap, footer, controls, controlsLeft, controlsRight,
    titleEl, subtitleEl, captionEl,
    node: () => container.node(),
    setTitle(t) { titleEl.text(t || "").style("display", t ? null : "none"); },
    setSubtitle(t) { subtitleEl.text(t || "").style("display", t ? null : "none"); },
    setCaption(t) { captionEl.text(t || "").style("display", t ? null : "none"); },
    // Avläsningsrad under rubriken (används av staplar, lollipop, kartor …)
    avlasning(hint = "Peka för värden") {
      if (!avlasningEl) {
        avlasningEl = container.insert("div", ".graf-body")
          .attr("class", "graf-avlasning")
          .attr("data-hint", hint);
      }
      return {
        el: avlasningEl,
        visa(html) { avlasningEl.html(html); },
        rensa() { avlasningEl.html(""); }
      };
    },
    // Lägg en SVG i kroppen med rätt klass och viewBox
    svg(width, height) {
      return svgWrap.append("svg")
        .attr("class", "graf-svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet");
    }
  };
}

// =============================================================================
// AXLAR OCH GRID — samma utseende i alla moduler
// =============================================================================

// Y-axel: bara etiketter, ingen linje, inga tick-streck
export function stilYAxel(g, { dx = -8 } = {}) {
  g.select(".domain").remove();
  g.selectAll(".tick line").remove();
  g.selectAll(".tick text")
    .attr("x", dx)
    .attr("text-anchor", "end")
    .attr("fill", FARG.text)
    .attr("font-size", STORLEK.tick)
    .attr("font-family", TYP.ui)
    .style("font-variant-numeric", "tabular-nums");
  return g;
}

// X-axel: tunn baslinje, korta tick-streck, mörkare etiketter
export function stilXAxel(g, { anchor = "middle" } = {}) {
  g.select(".domain").attr("stroke", FARG.axel).attr("stroke-width", 1);
  g.selectAll(".tick line").attr("stroke", FARG.axel).attr("y2", 5);
  g.selectAll(".tick text")
    .attr("fill", FARG.ink)
    .attr("font-size", STORLEK.tickX)
    .attr("font-family", TYP.ui)
    .attr("text-anchor", anchor)
    .style("font-variant-numeric", "tabular-nums");
  return g;
}

// Horisontella gridlinjer: streckade, nollinjen (eller ett referensvärde) heldragen
export function ritaGrid(g, { ticks, scale, x1, x2, noll = 0, horisontell = true } = {}) {
  g.selectAll("*").remove();
  ticks.forEach(t => {
    const p = scale(t);
    const arNoll = noll != null && Math.abs(t - noll) < 1e-9;
    const l = g.append("line")
      .attr("stroke", arNoll ? FARG.noll : FARG.grid)
      .attr("stroke-width", arNoll ? 1 : 0.8)
      .attr("stroke-dasharray", arNoll ? null : "4,4");
    if (horisontell) l.attr("x1", x1).attr("x2", x2).attr("y1", p).attr("y2", p);
    else l.attr("y1", x1).attr("y2", x2).attr("x1", p).attr("x2", p);
  });
  return g;
}

// Axeltitel för x (centrerad under axeln)
export function xTitel(svg, { x, y, text }) {
  return svg.append("text")
    .attr("class", "graf-xtitel")
    .attr("x", x).attr("y", y)
    .attr("text-anchor", "middle")
    .attr("font-family", TYP.ui)
    .attr("font-size", STORLEK.axelTitel)
    .attr("font-weight", 500)
    .attr("fill", FARG.text)
    .text(text || "");
}

// =============================================================================
// Y-TITEL — horisontell ovanför y-axeln. Med options blir den en rullgardin.
//
//   const yt = yTitel(svg, { x, y, text: "% per år",
//                            options: ["Årlig förändring (%)", "Antal", …],
//                            activeIndex: 0, body: ram.body,
//                            onSelect: (i) => switchMeasure(i) });
//   yt.set("Index", 3)      // uppdatera titel + aktivt val
// =============================================================================
export function yTitel(svg, { x, y, text = "", options = null, activeIndex = 0, onSelect = null, body = null } = {}) {
  const valbar = Array.isArray(options) && options.length > 1 && body;
  const g = svg.append("g")
    .attr("class", "graf-ytitel" + (valbar ? " graf-ytitel--valbar" : ""))
    .attr("transform", `translate(${x},${y})`);

  const label = g.append("text")
    .attr("x", 0).attr("y", 0)
    .attr("text-anchor", "start")
    .attr("font-family", TYP.ui)
    .attr("font-size", STORLEK.yTitel)
    .attr("font-weight", 500)
    .attr("fill", FARG.text)
    .text(text || "");

  let chevron = null, under = null, hit = null, meny = null, aktiv = activeIndex;

  function layout() {
    if (!valbar) return;
    const w = matText(label.text(), { size: STORLEK.yTitel, weight: 500 });
    chevron.attr("transform", `translate(${w + 5},${-4.5})`);
    under.attr("x1", 0).attr("x2", w);
    hit.attr("x", -4).attr("width", w + 22);
  }

  if (valbar) {
    under = g.append("line")
      .attr("class", "graf-ytitel-under")
      .attr("y1", 3.5).attr("y2", 3.5);
    chevron = g.append("path")
      .attr("class", "graf-ytitel-pil")
      .attr("d", "M0,0 L4,4 L8,0")
      .attr("fill", "none").attr("stroke-width", 1.6)
      .attr("stroke-linecap", "round").attr("stroke-linejoin", "round");
    hit = g.append("rect")
      .attr("y", -13).attr("height", 20)
      .attr("fill", "transparent")
      .style("cursor", "pointer")
      .attr("role", "button")
      .attr("aria-label", "Välj mått");
    layout();

    hit.on("click", (event) => {
      event.stopPropagation();
      if (meny) { meny.stang(); meny = null; return; }
      meny = oppnaMeny(body, hit.node(), {
        options, activeIndex: aktiv,
        onSelect: (i) => { aktiv = i; if (onSelect) onSelect(i); },
        onClose: () => { meny = null; }
      });
    });
  }

  return {
    g,
    set(t, i) {
      if (t != null) label.text(t);
      if (i != null) aktiv = i;
      layout();
    },
    flytta(nx, ny) { g.attr("transform", `translate(${nx},${ny})`); }
  };
}

// =============================================================================
// RULLGARDINSMENY — HTML-overlay i .graf-body, förankrad vid ett element
// (SVG- eller HTML-element). Stängs vid klick utanför, Escape eller val.
// =============================================================================
export function oppnaMeny(body, anchorNode, { options, activeIndex = 0, onSelect, onClose = null, rubrik = null, riktning = "ner" } = {}) {
  body.selectAll(".graf-meny").remove();
  const bodyRect = body.node().getBoundingClientRect();
  const r = anchorNode.getBoundingClientRect();

  const meny = body.append("div")
    .attr("class", "graf-meny")
    .attr("role", "listbox")
    .style("left", `${Math.max(0, r.left - bodyRect.left)}px`);
  if (riktning === "upp") meny.style("bottom", `${bodyRect.bottom - r.top + 4}px`);
  else meny.style("top", `${r.bottom - bodyRect.top + 4}px`);

  if (rubrik) meny.append("div").attr("class", "graf-meny-rubrik").text(rubrik);

  const stang = () => {
    meny.remove();
    document.removeEventListener("pointerdown", utanfor, true);
    document.removeEventListener("keydown", tangent, true);
    if (onClose) onClose();
  };
  const utanfor = (e) => { if (!meny.node().contains(e.target)) stang(); };
  const tangent = (e) => { if (e.key === "Escape") stang(); };

  options.forEach((opt, i) => {
    const txt = typeof opt === "string" ? opt : (opt.label ?? String(opt));
    const rad = meny.append("div")
      .attr("class", "graf-meny-val" + (i === activeIndex ? " aktiv" : ""))
      .attr("role", "option")
      .attr("aria-selected", i === activeIndex ? "true" : "false")
      .on("click", (event) => { event.stopPropagation(); stang(); if (onSelect) onSelect(i); });
    rad.append("span").attr("class", "graf-meny-bock").html(i === activeIndex ? "✓" : "");
    rad.append("span").attr("class", "graf-meny-text").text(txt);
    if (typeof opt === "object" && opt.description) {
      rad.append("span").attr("class", "graf-meny-beskrivning").text(opt.description);
    }
  });

  // Håll menyn inom kroppen horisontellt
  requestAnimationFrame(() => {
    const m = meny.node(); if (!m) return;
    const mw = m.offsetWidth, bw = body.node().clientWidth;
    const left = parseFloat(meny.style("left"));
    if (left + mw > bw - 4) meny.style("left", `${Math.max(0, bw - mw - 4)}px`);
  });

  setTimeout(() => {
    document.addEventListener("pointerdown", utanfor, true);
    document.addEventListener("keydown", tangent, true);
  }, 0);

  return { el: meny, stang };
}

// =============================================================================
// VALPILL — knapp i nedre raden med rullgardin. Ex: region i stackedArea.
//   valPill(ram.controlsLeft, { label: "Region", options: ["Halland", …],
//                              activeIndex: 0, body: ram.body, onSelect })
// =============================================================================
export function valPill(parent, { label = null, options, activeIndex = 0, onSelect, body, ikon = null } = {}) {
  let aktiv = activeIndex;
  const btn = parent.append("button")
    .attr("type", "button")
    .attr("class", "graf-knapp graf-knapp--val");
  if (ikon) btn.append("span").attr("class", "graf-knapp-ikon").html(ikon);
  if (label) btn.append("span").attr("class", "graf-knapp-etikett").text(label + ":");
  const varde = btn.append("span").attr("class", "graf-knapp-varde")
    .text(typeof options[aktiv] === "string" ? options[aktiv] : options[aktiv].label);
  btn.append("span").attr("class", "graf-knapp-pil").html(IKON.pil);

  let meny = null;
  btn.on("click", (event) => {
    event.stopPropagation();
    if (meny) { meny.stang(); meny = null; return; }
    btn.classed("oppen", true);
    meny = oppnaMeny(body, btn.node(), {
      options, activeIndex: aktiv, riktning: "upp",
      onSelect: (i) => {
        aktiv = i;
        varde.text(typeof options[i] === "string" ? options[i] : options[i].label);
        if (onSelect) onSelect(i);
      },
      onClose: () => { meny = null; btn.classed("oppen", false); }
    });
  });
  return { el: btn, set(i) { aktiv = i; varde.text(typeof options[i] === "string" ? options[i] : options[i].label); } };
}

// Enkel växlare (två till fyra lägen, segmenterad): Andel | Antal
export function segment(parent, { options, activeIndex = 0, onSelect } = {}) {
  const wrap = parent.append("div").attr("class", "graf-segment").attr("role", "tablist");
  const knappar = options.map((o, i) =>
    wrap.append("button").attr("type", "button")
      .attr("class", "graf-segment-val" + (i === activeIndex ? " aktiv" : ""))
      .attr("role", "tab")
      .text(typeof o === "string" ? o : o.label)
      .on("click", () => { satt(i); if (onSelect) onSelect(i); })
  );
  function satt(i) { knappar.forEach((k, j) => k.classed("aktiv", j === i)); }
  return { el: wrap, set: satt };
}

// =============================================================================
// TOOLTIP — en per graf, ligger i .graf-body
//   const tt = skapaTooltip(ram.body);
//   tt.visa(html, { x, y })   // x,y i CSS-pixlar relativt svg-container
//   tt.dolj()
// =============================================================================
export function skapaTooltip(body) {
  const el = body.append("div").attr("class", "graf-tooltip").style("display", "none");
  return {
    el,
    visa(html, { x, y, sida = "auto", offset = 14 } = {}) {
      el.html(html).style("display", "block");
      const b = body.node().getBoundingClientRect();
      const w = el.node().offsetWidth, h = el.node().offsetHeight;
      let left = x + offset;
      if (sida === "vanster" || (sida === "auto" && left + w > b.width - 6)) left = x - w - offset;
      if (left < 4) left = 4;
      let top = y - h / 2;
      top = Math.max(4, Math.min(b.height - h - 4, top));
      el.style("left", `${left}px`).style("top", `${top}px`);
    },
    dolj() { el.style("display", "none"); }
  };
}

// Bygger standard-tooltiphtml: rubrik (t.ex. år) + rader [{namn, varde, farg, fokus}]
export function tooltipHtml(rubrik, rader, { extra = null } = {}) {
  const rows = rader.map(r => `
    <div class="graf-tooltip-rad${r.fokus ? " fokus" : ""}${r.dampad ? " dampad" : ""}">
      <span class="graf-tooltip-prick" style="background:${r.farg || "#888"}"></span>
      <span class="graf-tooltip-namn">${r.namn}</span>
      <span class="graf-tooltip-varde">${r.varde}</span>
    </div>`).join("");
  return `${rubrik ? `<div class="graf-tooltip-rubrik">${rubrik}</div>` : ""}
    <div class="graf-tooltip-lista">${rows}</div>${extra ? `<div class="graf-tooltip-extra">${extra}</div>` : ""}`;
}

// Y-titelns standardposition: flush med y-etiketternas vänsterkant, ovanför axeln
export function yTitelPos(marginLeft, marginTop) {
  return { x: marginLeft, y: marginTop - 12 };
}
