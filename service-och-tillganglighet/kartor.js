// =============================================================================
// Kapitel 05:s tillgänglighetskartor (räckvidd, arbetsmarknad, vardag, service)
//
// Konfigurationen bor här i stället för i qmd-cellerna, så att samma kartor kan
// öppnas både i kapitlet och fristående i kartgalleriet (kartgalleri/karta.html).
// Varje funktion är asynkron: den hämtar kommunernas utbredning och returnerar
// sedan figuren från js/kartor/tillganglighetskarta.js.
//
//   bas: sökväg till kapitlets mapp ("" i kapitlet, "../service-och-tillganglighet/"
//        från kartgalleriet). Datafilerna hämtas relativt den.
// =============================================================================
import { tillganglighetskarta, fmtSv } from "../js/kartor/tillganglighetskarta.js";

export const fsNamn = { WALK: "Gång", BICYCLE: "Cykel", TRANSIT: "Kollektivtrafik", TRANSIT50: "Kollektivtrafik, typisk avgång", TRANSITB: "Kollektivtrafik med cykel", CAR: "Bil" };
const kommunOrdning = ["Kungsbacka", "Varberg", "Falkenberg", "Halmstad", "Laholm", "Hylte"];
const HELA_BBOX = [11.75, 56.33, 13.75, 57.62];

const cache = new Map();
const hamta = (url) => {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => r.json()));
  return cache.get(url);
};

// Kommunernas utbredning för kartornas zoom (ur kommunlagret)
async function kommunBbox(bas) {
  const fc = await hamta(bas + "data/05-kom-rackvidd.geojson");
  const bbox = (g) => {
    let v = Infinity, s = Infinity, o = -Infinity, n = -Infinity;
    const gå = (c) => (typeof c[0] === "number"
      ? (v = Math.min(v, c[0]), o = Math.max(o, c[0]), s = Math.min(s, c[1]), n = Math.max(n, c[1]))
      : c.forEach(gå));
    gå(g.coordinates);
    return [v, s, o, n];
  };
  return fc.features
    .map((f) => ({ namn: f.properties.namn, kn: f.properties.kn, bbox: bbox(f.geometry) }))
    .sort((a, b) => kommunOrdning.indexOf(a.namn) - kommunOrdning.indexOf(b.namn));
}

// ── Räckvidd: invånare och arbetsplatser inom 15–60 min ──────────────────────
const rvSkala = (() => {
  const farger = ["#F3F0E8", "#E2F6FF", "#C3E7FA", "#A2D9F8", "#62C3F5", "#2DB8F6", "#1C8FD0", "#1E63A8", "#004990", "#1B2A5C"];
  const k = (v) => (v >= 1e6 ? `${fmtSv(v / 1e6)} milj.` : fmtSv(v));
  const et = (b) => b.map((v, i) => (i === 0 ? `Under ${k(b[0])}` : `${k(b[i - 1])}–${k(v)}`)).concat([`${k(b[b.length - 1])} eller fler`]);
  const brytPop = [100, 1000, 5000, 20000, 50000, 100000, 250000, 500000, 1000000];
  const brytArb = [50, 500, 2500, 10000, 25000, 50000, 125000, 250000, 500000];
  return { farger, pop: { bryt: brytPop, etiketter: et(brytPop) }, arbete: { bryt: brytArb, etiketter: et(brytArb) } };
})();
const rvFs = (s) => (s.fs !== "TRANSIT" ? s.fs : ({ snabb: "TRANSIT", typisk: "TRANSIT50", cykel: "TRANSITB" })[s.avg]);
const rvNyckel = (s) => `${s.matt}_${rvFs(s)}_${s.tid}`;

export async function rackviddKarta({ bas = "", start = {}, rubrik = {} } = {}) {
  return tillganglighetskarta({
    rutor: bas + "data/05-rutor-rackvidd.json",
    omraden: { DeSO: bas + "data/05-deso-rackvidd.geojson", RegSO: bas + "data/05-regso-rackvidd.geojson", Kommun: bas + "data/05-kom-rackvidd.geojson" },
    dims: [
      { id: "matt", label: "Mått", options: [{ v: "pop", t: "Invånare" }, { v: "arbete", t: "Arbetsplatser" }] },
      { id: "fs", label: "Färdsätt", rad: true, options: [{ v: "WALK", t: "Gång" }, { v: "BICYCLE", t: "Cykel" }, { v: "TRANSIT", t: "Kollektivt" }, { v: "CAR", t: "Bil" }] },
      { id: "avg", label: "Avgång och anslutning", visa: (s) => s.fs === "TRANSIT",
        options: [{ v: "snabb", t: "Snabbaste avgång, gång" }, { v: "typisk", t: "Typisk avgång, gång" }, { v: "cykel", t: "Snabbaste, cykel eller gång" }] },
      { id: "tid", label: "Restid", rad: true, options: [15, 30, 45, 60].map((t) => ({ v: String(t), t: `${t} min` })) }
    ],
    start: { matt: "pop", fs: "CAR", avg: "snabb", tid: "30", ...start },
    nyckel: rvNyckel,
    skala: (s) => {
      const S = rvSkala[s.matt];
      const vad = s.matt === "pop" ? "Invånare" : "Arbetsplatser";
      return { bryt: S.bryt, farger: rvSkala.farger, etiketter: S.etiketter,
        rubrik: `${vad} inom ${s.tid} minuter`,
        kort: `${vad.toLowerCase()} inom ${s.tid} min, ${fsNamn[rvFs(s)].toLowerCase()}`,
        under: `${fsNamn[rvFs(s)]}. Antal som nås från rutan, grannlänen inräknade.`,
        not: "Områdesnivåerna visar medelvärdet för invånarna i området.",
        infoNot: "Andelen av invånarna som bor i rutor i varje klass." };
    },
    kommuner: await kommunBbox(bas),
    helaBbox: HELA_BBOX,
    popup: (p, s, niva, namn) => {
      const vad = s.matt === "pop" ? "invånare" : "arbetsplatser";
      const rad = (fs) => `<tr${fs === rvFs(s) ? " class='akt'" : ""}><td>${fsNamn[fs]}</td>` +
        [15, 30, 45, 60].map((t) => `<td>${fmtSv(p[`${s.matt}_${fs}_${t}`])}</td>`).join("") + "</tr>";
      return `<div class="tk-pop"><div class="tk-pop-h">${namn}</div>` +
        `<div class="tk-pop-s">${fmtSv(p.pop)} invånare${niva === "Ruta" ? " i rutan" : ""} · antal ${vad} som nås</div>` +
        `<table><tr><th>Färdsätt</th><th>15</th><th>30</th><th>45</th><th>60 min</th></tr>` +
        ["WALK", "BICYCLE", "TRANSIT", "TRANSIT50", "TRANSITB", "CAR"].map(rad).join("") + `</table>` +
        `<div class="tk-pop-f">Kollektivtrafik: snabbaste avgång 07–09 med gång till hållplatsen, om inget annat anges.${niva === "Ruta" ? "" : " Medelvärde för områdets invånare."}</div></div>`;
    },
    title: rubrik.title || "Hur många når man inom en viss restid?",
    subtitle: rubrik.subtitle || "Antal invånare eller arbetsplatser som nås från varje bebodd 250-metersruta i Halland, grannlänen inräknade. Välj mått, färdsätt, restid och nivå i kartans panel; klicka på en ruta för alla färdsätt.",
    caption: "Källa: egen beräkning med r5r (R5) på OpenStreetMap och GTFS Sverige 2 (Samtrafiken, tidtabell tisdag 13 oktober 2026). Befolkning: SCB 2025, fördelad på bostadshus (kapitel 06). Arbetsplatser: SCB, BAS 2024, fördelade inom kommunen. Bakgrundskarta: CARTO och OpenStreetMap.",
    hojd: 680
  });
}

export const arbeteKarta = ({ bas = "" } = {}) => rackviddKarta({
  bas,
  start: { matt: "arbete", fs: "TRANSIT", avg: "snabb", tid: "45" },
  rubrik: { title: "Hur stor arbetsmarknad når man?",
    subtitle: "Antal arbetsplatser som nås från varje bebodd 250-metersruta i Halland, grannlänen inräknade. Kartan börjar i kollektivtrafik inom 45 minuter; välj mått, färdsätt, restid och nivå i kartans panel." }
});

// ── Service och vardag ───────────────────────────────────────────────────────
export const svTyper = [
  { v: "dagligvaror", t: "Livsmedel" }, { v: "forskola", t: "Förskola" },
  { v: "grundskola_f6", t: "Grundskola F–6" }, { v: "grundskola_79", t: "Grundskola 7–9" },
  { v: "gymnasium", t: "Gymnasium" }, { v: "vardcentral", t: "Vårdcentral" },
  { v: "akutsjukhus", t: "Akutsjukhus" }, { v: "apotek", t: "Apotek" },
  { v: "bibliotek", t: "Bibliotek" }, { v: "hallplats", t: "Hållplats" }
];
const svNamn = Object.fromEntries(svTyper.map((d) => [d.v, d.t]));
const svFs = (s) => (s.fs !== "TRANSIT" ? s.fs : (s.avg === "typisk" ? "TRANSIT50" : "TRANSIT"));
const svSkala = {
  bryt: [5, 10, 15, 20, 30, 45],
  farger: ["#00664D", "#00AB60", "#7FCFA0", "#C1E8C4", "#E9E2C8", "#A2D9F8", "#2D7DC2"],
  et: ["Under 5 min", "5–10 min", "10–15 min", "15–20 min", "20–30 min", "30–45 min", "45–60 min"]
};
const serviceData = (bas) => ({
  rutor: bas + "data/05-rutor-service.json",
  omraden: { DeSO: bas + "data/05-deso-service.geojson", RegSO: bas + "data/05-regso-service.geojson", Kommun: bas + "data/05-kom-service.geojson" }
});

export async function serviceKarta({ bas = "", start = {} } = {}) {
  return tillganglighetskarta({
    ...serviceData(bas),
    dims: [
      { id: "typ", label: "Service", rad: true, options: svTyper },
      { id: "fs", label: "Färdsätt", rad: true, options: [{ v: "WALK", t: "Gång" }, { v: "BICYCLE", t: "Cykel" }, { v: "TRANSIT", t: "Kollektivt" }, { v: "CAR", t: "Bil" }] },
      { id: "avg", label: "Avgång", visa: (s) => s.fs === "TRANSIT", rad: true,
        options: [{ v: "snabb", t: "Snabbaste" }, { v: "typisk", t: "Typisk" }] }
    ],
    start: { typ: "vardcentral", fs: "WALK", avg: "snabb", ...start },
    nyckel: (s) => `${s.typ}_${svFs(s)}`,
    skala: (s) => ({ bryt: svSkala.bryt, farger: svSkala.farger, etiketter: svSkala.et,
      rubrik: `Restid till närmaste: ${svNamn[s.typ].toLowerCase()}`,
      kort: `${svNamn[s.typ].toLowerCase()}, ${fsNamn[svFs(s)].toLowerCase()}`,
      under: `${fsNamn[svFs(s)]}. Minuter till närmaste målpunkt, även i grannlänen.`,
      enhet: " min", ingen: "Inte inom 60 min", ingenFarg: "#D3D6D5",
      not: "Områdesnivåerna visar medelrestiden för de invånare som når målpunkten inom 60 minuter.",
      infoRubrik: "Andel av invånarna", infoNot: "Andelen av invånarna som bor i rutor i varje klass." }),
    kommuner: await kommunBbox(bas),
    helaBbox: HELA_BBOX,
    popup: (p, s, niva, namn) => {
      const fsl = ["WALK", "BICYCLE", "TRANSIT", "TRANSIT50", "CAR"];
      const cell = (v) => (v == null ? "–" : `${fmtSv(v)} min`);
      const rad = (t) => `<tr${t.v === s.typ ? " class='akt'" : ""}><td>${t.t}</td>` + fsl.map((f) => `<td>${cell(p[`${t.v}_${f}`])}</td>`).join("") + "</tr>";
      return `<div class="tk-pop"><div class="tk-pop-h">${namn}</div><div class="tk-pop-s">${fmtSv(p.pop)} invånare · restid till närmaste</div>` +
        `<table><tr><th>Service</th><th>Gång</th><th>Cykel</th><th>Koll.</th><th>Koll. typ.</th><th>Bil</th></tr>${svTyper.map(rad).join("")}</table>` +
        `<div class="tk-pop-f">Koll. = snabbaste avgång 07–09, koll. typ. = typisk avgång.${niva === "Ruta" ? "" : " Medel för områdets invånare."}</div></div>`;
    },
    title: "Hur långt är det till närmaste service?",
    subtitle: "Restid från varje bebodd 250-metersruta till närmaste målpunkt av vald typ. Välj service, färdsätt och nivå i kartans panel; klicka på en ruta för alla typer och färdsätt.",
    caption: "Källa: egen beräkning med r5r på OpenStreetMap och GTFS Sverige 2 (tidtabell 13 oktober 2026). Målpunkter: Tillväxtverket (Pipos) och OpenStreetMap (dagligvaror), Skolverket (skolor), 1177 (vårdcentraler, akutsjukhus), Läkemedelsverket (apotek), KB (bibliotek), OpenStreetMap (förskolor), Samtrafiken (hållplatser). Bakgrundskarta: CARTO och OpenStreetMap.",
    hojd: 700
  });
}

export async function vardagKarta({ bas = "" } = {}) {
  return tillganglighetskarta({
    ...serviceData(bas),
    dims: [{ id: "fs", label: "Färdsätt", rad: true, options: [{ v: "WALK", t: "Gång" }, { v: "BICYCLE", t: "Cykel" }] }],
    start: { fs: "WALK" },
    nyckel: (s) => `v15_${s.fs}`,
    skala: (s) => ({ bryt: [1, 2, 3, 4, 5, 6], farger: ["#F3F0E8", "#E3F4E2", "#C1E8C4", "#7FCFA0", "#00AB60", "#00885A", "#00664D"],
      etiketter: ["Ingen", "1 av 6", "2 av 6", "3 av 6", "4 av 6", "5 av 6", "Alla 6"], dec: 1,
      rubrik: "Vardagsfunktioner inom 15 minuter", kort: `funktioner inom 15 min, ${s.fs === "WALK" ? "gång" : "cykel"}`,
      under: `${s.fs === "WALK" ? "Till fots, 5 km/h" : "Med cykel, 16 km/h"}. Livsmedelsbutik, grundskola F–6, vårdcentral, apotek, bibliotek och hållplats.`,
      not: "Områdesnivåerna visar genomsnittet för områdets invånare.", infoRubrik: "Andel av invånarna" }),
    kommuner: await kommunBbox(bas),
    helaBbox: HELA_BBOX,
    popup: (p, s, niva, namn) => {
      const typer = ["dagligvaror", "grundskola_f6", "vardcentral", "apotek", "bibliotek", "hallplats"];
      const rad = (t) => { const v = p[`${t}_${s.fs}`]; const ok = v != null && v <= 15;
        return `<tr><td>${svNamn[t]}</td><td>${v == null ? "över 60 min" : fmtSv(v) + " min"}</td><td>${ok ? "✓" : ""}</td></tr>`; };
      return `<div class="tk-pop"><div class="tk-pop-h">${namn}</div><div class="tk-pop-s">${fmtSv(p.pop)} invånare · ${fmtSv(p[`v15_${s.fs}`], niva === "Ruta" ? 0 : 1)} av 6 inom 15 min ${s.fs === "WALK" ? "till fots" : "med cykel"}</div>` +
        `<table>${typer.map(rad).join("")}</table></div>`;
    },
    title: "Vardagen inom en kvart",
    subtitle: "Antal av sex vardagsfunktioner som nås inom 15 minuter från varje bebodd 250-metersruta. Välj gång eller cykel och nivå i kartans panel.",
    caption: "Källa: egen beräkning med r5r på OpenStreetMap. Målpunkter som i figuren om närmaste service. Förskolan ingår inte eftersom den öppna källan bara täcker omkring hälften av förskolorna. Bakgrundskarta: CARTO och OpenStreetMap.",
    hojd: 660
  });
}

// Registret som kartgalleriet (kartgalleri/karta.html?id=…) använder
export const KARTOR = {
  "tillganglighet-rackvidd": rackviddKarta,
  "tillganglighet-arbete": arbeteKarta,
  "tillganglighet-vardag": vardagKarta,
  "tillganglighet-service": serviceKarta
};
