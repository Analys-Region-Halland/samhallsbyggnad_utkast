// =============================================================================
// EXPORT SVG - Spara graf som SVG-fil med alla stilar inbakade
// =============================================================================

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";


/**
 * Skapar en exporterbar SVG med titel, undertitel och graf
 */
export function createExportSvg(chartSvg, {
  title = null,
  subtitle = null,
  caption = null,
  width = 620,
  height = 375
}) {
  // Beräkna extra höjd för titel/undertitel/caption
  const titleHeight = title ? 28 : 0;
  const subtitleHeight = subtitle ? 20 : 0;
  const captionHeight = caption ? 24 : 0;
  const headerHeight = titleHeight + subtitleHeight + (title || subtitle ? 8 : 0);
  const totalHeight = headerHeight + height + captionHeight;

  const svgNS = "http://www.w3.org/2000/svg";
  const exportSvg = document.createElementNS(svgNS, "svg");
  exportSvg.setAttribute("xmlns", svgNS);
  exportSvg.setAttribute("viewBox", `0 0 ${width} ${totalHeight}`);
  exportSvg.setAttribute("width", width);
  exportSvg.setAttribute("height", totalHeight);

  // Vit bakgrund
  const bg = document.createElementNS(svgNS, "rect");
  bg.setAttribute("width", width);
  bg.setAttribute("height", totalHeight);
  bg.setAttribute("fill", "#ffffff");
  exportSvg.appendChild(bg);

  // Titel
  let yOffset = 0;
  if (title) {
    const titleEl = document.createElementNS(svgNS, "text");
    titleEl.setAttribute("x", "14");
    titleEl.setAttribute("y", "22");
    titleEl.setAttribute("font-size", "18px");
    titleEl.setAttribute("font-weight", "500");
    titleEl.setAttribute("font-family", "'Source Serif 4', Georgia, serif");
    titleEl.setAttribute("fill", "#1f2422");
    titleEl.textContent = title;
    exportSvg.appendChild(titleEl);
    yOffset += titleHeight;
  }

  // Undertitel
  if (subtitle) {
    const subtitleEl = document.createElementNS(svgNS, "text");
    subtitleEl.setAttribute("x", "14");
    subtitleEl.setAttribute("y", String(yOffset + 16));
    subtitleEl.setAttribute("font-size", "12px");
    subtitleEl.setAttribute("font-weight", "400");
    subtitleEl.setAttribute("font-family", "'IBM Plex Sans', -apple-system, sans-serif");
    subtitleEl.setAttribute("fill", "#5b5b5b");
    subtitleEl.textContent = subtitle;
    exportSvg.appendChild(subtitleEl);
    yOffset += subtitleHeight;
  }

  if (title || subtitle) {
    yOffset += 8;
  }

  // Skapa en grupp för chart-innehållet
  const chartGroup = document.createElementNS(svgNS, "g");
  chartGroup.setAttribute("transform", `translate(0, ${yOffset})`);
  exportSvg.appendChild(chartGroup);

  // Klona och processa alla barn från original-SVG:n
  const children = chartSvg.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];

    if (child.nodeType === Node.ELEMENT_NODE) {
      const className = child.getAttribute("class") || "";
      const tagName = child.tagName.toLowerCase();

      // Skippa interaktiva overlay-element
      if (className.includes("overlay") ||
          className.includes("crosshair") ||
          className.includes("highlight")) {
        continue;
      }

      // Skippa rect som är overlay (transparent fill)
      if (tagName === "rect" && child.getAttribute("fill") === "transparent") {
        continue;
      }

      // Klona elementet djupt
      const clone = child.cloneNode(true);

      // Baka in computed styles
      inlineStylesFromOriginal(child, clone);

      chartGroup.appendChild(clone);
    }
  }

  // Caption
  if (caption) {
    const captionEl = document.createElementNS(svgNS, "text");
    captionEl.setAttribute("x", "14");
    captionEl.setAttribute("y", String(totalHeight - 8));
    captionEl.setAttribute("font-size", "10px");
    captionEl.setAttribute("font-weight", "400");
    captionEl.setAttribute("font-family", "'IBM Plex Sans', -apple-system, sans-serif");
    captionEl.setAttribute("fill", "#8a8f8d");
    captionEl.textContent = caption;
    exportSvg.appendChild(captionEl);
  }

  // Serialisera till string
  const serializer = new XMLSerializer();
  let svgString = serializer.serializeToString(exportSvg);

  // Rensa problematiska entities
  svgString = svgString.replace(/&nbsp;/g, " ");
  svgString = svgString.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;");

  // Lägg till XML-deklaration
  svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgString;

  return svgString;
}

/**
 * Kopierar computed styles från original till klon rekursivt
 */
function inlineStylesFromOriginal(original, clone) {
  if (original.nodeType !== Node.ELEMENT_NODE) return;

  const svgStyles = [
    'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
    'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
    'font-family', 'font-size', 'font-weight', 'font-style',
    'text-anchor', 'dominant-baseline', 'opacity', 'visibility'
  ];

  try {
    const computed = window.getComputedStyle(original);

    svgStyles.forEach(style => {
      const value = computed.getPropertyValue(style);
      // Sätt värdet om det finns och inte redan är satt som attribut
      if (value && value !== 'none' && value !== '') {
        const currentAttr = clone.getAttribute(style);
        // Bara sätt om attributet inte redan finns
        if (!currentAttr) {
          clone.setAttribute(style, value);
        }
      }
    });
  } catch (e) {
    // Ignorera fel för element som inte kan ha computed styles
  }

  // Rekursivt för alla barn
  const originalChildren = original.children;
  const cloneChildren = clone.children;

  for (let i = 0; i < originalChildren.length && i < cloneChildren.length; i++) {
    inlineStylesFromOriginal(originalChildren[i], cloneChildren[i]);
  }
}

/**
 * Laddar ner SVG som fil
 */
export function downloadSvg(svgString, filename = "graf") {
  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.svg`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

/**
 * Lägger till verktyg (logotyp, info, ladda ner) i grafens .graf-tools.
 * Utseendet styrs av style.scss (GRAFSYSTEM); här sätts bara struktur.
 */
export function addExportButton(container, chartSvg, options) {
  const { title = "graf", altText = null, info = null, logo = null } = options;

  const filename = (title || "graf")
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  let header = container.select(".graf-header");
  if (header.empty()) {
    header = container.insert("div", ":first-child").attr("class", "graf-header");
  }
  let tools = header.select(".graf-tools");
  if (tools.empty()) tools = header.append("div").attr("class", "graf-tools");
  tools.selectAll("*").remove();

  if (altText) {
    const svgEl = container.select(".graf-svg");
    if (!svgEl.empty()) svgEl.attr("aria-label", altText).attr("role", "img");
  }

  if (logo) {
    tools.append("img").attr("src", logo).attr("alt", "").attr("class", "graf-logo");
  }

  const knappar = tools.append("div").attr("class", "graf-tools-knappar");

  const IKON_INFO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16.5"/><circle cx="12" cy="7.8" r="0.6" fill="currentColor"/></svg>';
  const IKON_NER = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  const IKON_KRYSS = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

  if (info) {
    const infoBtn = knappar.append("button")
      .attr("type", "button")
      .attr("class", "graf-ikonknapp graf-info-btn")
      .attr("aria-label", "Om denna graf")
      .attr("data-tip", "Om denna graf")
      .html(IKON_INFO);

    const infoPanel = container.append("div")
      .attr("class", "graf-info-panel")
      .style("display", "none");
    infoPanel.append("div").html(info);
    infoPanel.append("button")
      .attr("type", "button")
      .attr("class", "graf-ikonknapp graf-info-stang")
      .attr("aria-label", "Stäng")
      .html(IKON_KRYSS)
      .on("click", (event) => { event.stopPropagation(); infoPanel.style("display", "none"); });

    infoBtn.on("click", (event) => {
      event.preventDefault(); event.stopPropagation();
      infoPanel.style("display", infoPanel.style("display") === "block" ? "none" : "block");
    });
  }

  const exportBtn = knappar.append("button")
    .attr("type", "button")
    .attr("class", "graf-ikonknapp graf-export-btn")
    .attr("aria-label", "Ladda ner som SVG")
    .attr("data-tip", "Ladda ner SVG")
    .html(IKON_NER);

  exportBtn.on("click", (event) => {
    event.preventDefault(); event.stopPropagation();
    try {
      const svgString = createExportSvg(chartSvg, options);
      downloadSvg(svgString, filename);
    } catch (err) {
      console.error("Export error:", err);
      alert("Kunde inte exportera grafen. Se konsolen för detaljer.");
    }
  });
}
