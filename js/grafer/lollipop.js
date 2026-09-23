// =============================================================================
// LOLLIPOP — rangordnade enskilda värden (horisontell eller vertikal).
// Byggd på den gemensamma ramen (js/lib/grafRam.js): måttnamnet ligger
// horisontellt uppe till vänster ovanför plotytan, väljaren i nedre raden,
// avläsning under rubriken.
// =============================================================================

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "../lib/exportSvg.js";
import { createFilterState, createSelectorPanel } from "../lib/filterUtils.js";
import {
  skapaRam, TYP, FARG, STORLEK, SERIEFARGER,
  stilYAxel, stilXAxel, ritaGrid, xTitel, yTitel, yTitelPos, matText
} from "../lib/grafRam.js";

// Snyggt intervall och max för värdeaxeln
function niceScale(dataMax, targetTicks = 5) {
  if (dataMax <= 0) return { max: 10, interval: 2, ticks: [0, 2, 4, 6, 8, 10] };
  const roughInterval = dataMax / targetTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughInterval)));
  const normalized = roughInterval / magnitude;
  const niceInterval = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  const interval = niceInterval * magnitude;
  const max = Math.ceil(dataMax / interval) * interval;
  const ticks = [];
  for (let v = 0; v <= max + interval * 0.01; v += interval) ticks.push(Math.round(v * 1000) / 1000);
  return { max, interval, ticks };
}

export function lollipop(data, {
  x = "kategori",
  y = "värde",
  color = null,
  width = null,
  height = 500,
  title = null,
  subtitle = null,
  caption = null,
  xLabel = null,
  yLabel = null,
  colors = SERIEFARGER,
  formatY = d => d.toLocaleString("sv-SE"),
  horizontal = false,
  pointRadius = 6,
  lineWidth = 2,
  showGrid = true,
  altText = null,
  info = null,
  logo = null,
  interactive = false,
  filter = null,          // Begränsa valbara items (gruppnamn eller individuella)
  highlight = null,
  vline = null,           // { value, label? } — vertikal referenslinje (horisontell lollipop)
  valueMax = null         // fast övre gräns för värdeaxeln (t.ex. 6 för en skala 1–6)
} = {}) {

  const filterState = createFilterState(data, { itemField: x, groupField: color, filter, highlight });

  const categories = [...new Set(data.map(d => d[x]))];
  const groups = color ? [...new Set(data.map(d => d[color]))] : ["_all"];

  const dataMax = d3.max(data, d => d[y]);
  const valueNice = niceScale(valueMax != null ? Math.max(valueMax, dataMax) : dataMax, 5);

  // ── Layout ──
  // Måttnamn (horisontellt uppe till vänster): yLabel för vertikal, xLabel för horisontell
  const mattNamn = horizontal ? xLabel : yLabel;
  const autoWidth = width || 780;
  const marginTop = (mattNamn || vline?.label) ? 36 : 20;
  const marginRight = (color && !interactive) ? 105 : 40;
  const marginBottom = horizontal ? 34 : (xLabel ? 62 : 52);

  const pixelsPerCategory = 44;
  const chartHeight = horizontal
    ? Math.min(600, Math.max(240, marginTop + marginBottom + categories.length * pixelsPerCategory))
    : height;

  let marginLeft = 18;
  if (horizontal) {
    const maxLabelW = Math.max(...categories.map(c => matText(String(c), { size: 13, weight: 500 })));
    marginLeft = 16 + maxLabelW + 12;
  }
  const maxTickWidth = Math.max(...valueNice.ticks.map(t => matText(formatY(t), { size: STORLEK.tick }))) + 10;
  const axisLeft = horizontal ? marginLeft : marginLeft + maxTickWidth;
  const plotRight = autoWidth - marginRight;

  const colorScale = d3.scaleOrdinal().domain(groups).range(colors);

  // ── Ram ──
  const ram = skapaRam({ title, subtitle, caption });
  const container = ram.container;
  const avlasning = ram.avlasning("Peka för värden");
  const svg = ram.svg(autoWidth, chartHeight);

  const mutedColor = FARG.dampad;
  const isHighlighted = (cat) => filterState.isHighlighted(cat);
  const getCategoryColor = (cat, groupKey = "_all") => isHighlighted(cat) ? colorScale(groupKey) : mutedColor;

  // Smart toggle: samma logik som selector-panelen
  const smartToggle = (item, allItems) => {
    const hl = filterState.getHighlight();
    const selectable = filterState.filterSet || allItems;
    const allOn = !hl || selectable.every(i => hl.includes(i));
    if (allOn) {
      if (hl) hl.forEach(c => { if (c !== item) filterState.toggle(c); });
      if (!filterState.isHighlighted(item) || !filterState.getHighlight()) filterState.toggle(item);
    } else {
      filterState.toggle(item);
    }
  };

  let updateLollipops = null;

  // Väljare i nedre raden
  let selectorCtrl = null;
  if (interactive) {
    selectorCtrl = createSelectorPanel(ram.controlsLeft, {
      filterState,
      allItems: categories,
      colorScale: color ? colorScale : () => colors[0],
      triggerText: "Markera",
      onUpdate: () => updateLollipops()
    });
  }

  // Avläsning
  const showValue = (category, value, groupKey) => {
    const groupLabel = groupKey !== "_all" ? `<span style="color:${FARG.mjuk};margin-right:4px">${groupKey}</span>` : "";
    avlasning.visa(
      `<span style="display:inline-flex;align-items:center;gap:8px">` +
      `<b>${category}</b><span style="color:#d5d8d7">│</span>` +
      `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:7px;height:7px;border-radius:50%;background:${colorScale(groupKey)}"></span>${groupLabel}<b>${formatY(value)}</b></span></span>`
    );
  };
  const hideValue = () => avlasning.rensa();

  // Måttnamn uppe till vänster
  if (mattNamn) {
    // Liggande: måttnamnet står ovanför staplarnas start (samma som stapeldiagram)
    const pos = yTitelPos(horizontal ? axisLeft : marginLeft, marginTop);
    yTitel(svg, { x: pos.x, y: pos.y, text: mattNamn });
  }

  const lollipopsGroup = svg.append("g").attr("class", "lollipops-group");
  let xScale, yScale, sortedData, sortedCategories;

  if (horizontal) {
    // =======================================================================
    // HORISONTELL — sorterad efter värde, hårlinjer mellan raderna
    // =======================================================================
    sortedData = [...data].sort((a, b) => b[y] - a[y]);
    sortedCategories = sortedData.map(d => d[x]);

    yScale = d3.scaleBand().domain(sortedCategories).range([marginTop, chartHeight - marginBottom]).padding(0.33);
    xScale = d3.scaleLinear().domain([0, valueNice.max]).range([axisLeft, plotRight]);

    const radGroup = svg.append("g").attr("class", "rad-linjer");
    for (let i = 0; i < sortedCategories.length - 1; i++) {
      const yMid = (yScale(sortedCategories[i]) + yScale.bandwidth() + yScale(sortedCategories[i + 1])) / 2;
      radGroup.append("line")
        .attr("x1", axisLeft).attr("x2", plotRight).attr("y1", yMid).attr("y2", yMid)
        .attr("stroke", "#eeefee").attr("stroke-width", 1);
    }

    // Värdeaxel nederst: bara etiketter
    const xAxisG = svg.append("g").attr("class", "x-axis")
      .attr("transform", `translate(0,${chartHeight - marginBottom})`)
      .call(d3.axisBottom(xScale).tickFormat(formatY).tickValues(valueNice.ticks).tickSize(0));
    stilXAxel(xAxisG);
    xAxisG.select(".domain").remove();
    xAxisG.selectAll(".tick text").attr("fill", FARG.text).attr("font-size", STORLEK.tick);

    // Vertikal referenslinje (vline) — bakom lollipops
    if (vline) {
      const vx = xScale(vline.value);
      svg.append("line")
        .attr("x1", vx).attr("x2", vx).attr("y1", marginTop - 4).attr("y2", chartHeight - marginBottom)
        .attr("stroke", FARG.noll).attr("stroke-width", 1).attr("stroke-dasharray", "6,4");
      if (vline.label) {
        svg.append("text")
          .attr("x", vx).attr("y", marginTop - 10).attr("text-anchor", "middle")
          .attr("font-size", 11).attr("font-weight", 500).attr("fill", FARG.text)
          .attr("font-family", TYP.ui).text(vline.label);
      }
    }

    updateLollipops = function () {
      lollipopsGroup.selectAll("*").remove();
      sortedData.forEach(d => {
        const groupKey = color ? d[color] : "_all";
        const yPos = yScale(d[x]) + yScale.bandwidth() / 2;
        const barColor = getCategoryColor(d[x], groupKey);
        const isHl = isHighlighted(d[x]);

        lollipopsGroup.append("text")
          .attr("x", axisLeft - 12).attr("y", yPos).attr("dy", "0.35em")
          .attr("text-anchor", "end")
          .attr("fill", isHl ? FARG.ink : FARG.mjuk)
          .attr("font-size", 13).attr("font-weight", isHl ? 500 : 400)
          .attr("font-family", TYP.ui)
          .text(String(d[x]));

        lollipopsGroup.append("line")
          .attr("x1", axisLeft).attr("x2", xScale(d[y])).attr("y1", yPos).attr("y2", yPos)
          .attr("stroke", barColor).attr("stroke-width", lineWidth + 1).attr("stroke-linecap", "round");

        lollipopsGroup.append("circle")
          .attr("data-category", d[x])
          .attr("cx", xScale(d[y])).attr("cy", yPos)
          .attr("r", pointRadius + 1)
          .attr("fill", barColor).attr("stroke", "#fff").attr("stroke-width", 2.5)
          .style("cursor", "pointer")
          .on("mouseenter", function () { d3.select(this).attr("r", pointRadius + 3); showValue(d[x], d[y], groupKey); })
          .on("mouseleave", function () { d3.select(this).attr("r", pointRadius + 1); hideValue(); })
          .on("click", () => { smartToggle(d[x], categories); updateLollipops(); });

        lollipopsGroup.append("text")
          .attr("x", xScale(d[y]) + pointRadius + 7).attr("y", yPos).attr("dy", "0.35em")
          .attr("fill", isHl ? FARG.text : "#b3b8b6")
          .attr("font-size", STORLEK.etikett).attr("font-weight", isHl ? 500 : 400)
          .attr("font-family", TYP.ui)
          .style("font-variant-numeric", "tabular-nums")
          .text(formatY(d[y]));
      });
      if (selectorCtrl) selectorCtrl.update();
    };
  } else {
    // =======================================================================
    // VERTIKAL
    // =======================================================================
    xScale = d3.scaleBand().domain(categories).range([axisLeft, plotRight]).padding(0.4);
    yScale = d3.scaleLinear().domain([0, valueNice.max]).range([height - marginBottom, marginTop]);

    if (showGrid) {
      const gridTicks = valueNice.ticks.length > 6 ? valueNice.ticks.filter((_, i) => i % 2 === 0) : valueNice.ticks;
      ritaGrid(svg.append("g").attr("class", "grid-lines"), { ticks: gridTicks, scale: yScale, x1: axisLeft, x2: plotRight, noll: 0 });
    }

    const manga = categories.length > 6;
    const xAxisG = svg.append("g").attr("class", "x-axis")
      .attr("transform", `translate(0,${height - marginBottom})`)
      .call(d3.axisBottom(xScale).tickSizeOuter(0).tickSize(0));
    stilXAxel(xAxisG);
    xAxisG.selectAll(".tick text")
      .attr("transform", manga ? "rotate(-35)" : null)
      .attr("text-anchor", manga ? "end" : "middle")
      .attr("dy", manga ? "0.5em" : "0.9em");

    if (xLabel) xTitel(svg, { x: axisLeft + (plotRight - axisLeft) / 2, y: height - 8, text: xLabel });

    const yAxisG = svg.append("g").attr("class", "y-axis")
      .attr("transform", `translate(${axisLeft},0)`)
      .call(d3.axisLeft(yScale).tickFormat(formatY).tickValues(valueNice.ticks));
    stilYAxel(yAxisG);

    updateLollipops = function () {
      lollipopsGroup.selectAll("*").remove();
      data.forEach(d => {
        const groupKey = color ? d[color] : "_all";
        const barColor = getCategoryColor(d[x], groupKey);
        const cx = xScale(d[x]) + xScale.bandwidth() / 2;
        lollipopsGroup.append("line")
          .attr("x1", cx).attr("x2", cx).attr("y1", yScale(0)).attr("y2", yScale(d[y]))
          .attr("stroke", barColor).attr("stroke-width", lineWidth);
        lollipopsGroup.append("circle")
          .attr("data-category", d[x])
          .attr("cx", cx).attr("cy", yScale(d[y])).attr("r", pointRadius)
          .attr("fill", barColor).attr("stroke", "#fff").attr("stroke-width", 2)
          .style("cursor", "pointer")
          .on("mouseenter", function () { d3.select(this).attr("r", pointRadius + 2); showValue(d[x], d[y], groupKey); })
          .on("mouseleave", function () { d3.select(this).attr("r", pointRadius); hideValue(); })
          .on("click", () => { smartToggle(d[x], categories); updateLollipops(); });
      });
      if (selectorCtrl) selectorCtrl.update();
    };
  }

  updateLollipops();

  // Panel-hover → markera punkt i grafen
  if (selectorCtrl) {
    const basR = horizontal ? pointRadius + 1 : pointRadius;
    const basStroke = horizontal ? 2.5 : 2;
    const aterstall = () => lollipopsGroup.selectAll("circle[data-category]").attr("r", basR).attr("stroke", "#fff").attr("stroke-width", basStroke);
    const panelGrid = selectorCtrl.element.select(".graf-selector-grid");
    panelGrid.node().addEventListener("mouseover", (event) => {
      const opt = event.target.closest(".graf-selector-option");
      if (!opt) { aterstall(); hideValue(); return; }
      const catName = opt.querySelector(".opt-name")?.textContent;
      if (!catName) return;
      lollipopsGroup.selectAll("circle[data-category]").each(function () {
        const el = d3.select(this);
        if (el.attr("data-category") === catName) el.attr("r", basR + 3).attr("stroke", FARG.ink).attr("stroke-width", 2);
        else el.attr("r", basR).attr("stroke", "#fff").attr("stroke-width", basStroke);
      });
      const item = data.find(d => d[x] === catName);
      if (item) showValue(catName, item[y], color ? item[color] : "_all");
    });
    panelGrid.node().addEventListener("mouseout", (event) => {
      const related = event.relatedTarget;
      if (related && panelGrid.node().contains(related)) return;
      aterstall(); hideValue();
    });
  }

  // =========================================================================
  // CROSSHAIR — snappar till närmaste kategori, klick markerar
  // =========================================================================
  const crosshair = svg.append("line")
    .attr("class", "crosshair")
    .attr("stroke", "#9a9f9d").attr("stroke-width", 1).attr("stroke-dasharray", "3,3")
    .style("opacity", 0).style("pointer-events", "none");
  if (horizontal) crosshair.attr("x1", axisLeft).attr("x2", plotRight);
  else crosshair.attr("y1", marginTop).attr("y2", height - marginBottom);

  const highlightRing = svg.append("circle")
    .attr("class", "highlight-ring")
    .attr("r", pointRadius + (horizontal ? 4 : 3))
    .attr("fill", "none").attr("stroke", FARG.ink).attr("stroke-width", 2)
    .style("opacity", 0).style("pointer-events", "none");

  const cats = horizontal ? sortedCategories : categories;
  const band = horizontal ? yScale : xScale;
  const narmast = (pos) => {
    let closest = null, minDist = Infinity;
    for (const cat of cats) {
      const c = band(cat) + band.bandwidth() / 2;
      const dist = Math.abs(pos - c);
      if (dist < minDist) { minDist = dist; closest = cat; }
    }
    return minDist < band.bandwidth() ? closest : null;
  };

  svg.append("rect")
    .attr("class", "overlay")
    .attr("x", axisLeft).attr("y", marginTop)
    .attr("width", plotRight - axisLeft).attr("height", chartHeight - marginTop - marginBottom)
    .attr("fill", "transparent")
    .style("cursor", "default")
    .on("mouseenter", () => crosshair.style("opacity", 1))
    .on("mouseleave", () => { crosshair.style("opacity", 0); highlightRing.style("opacity", 0); hideValue(); })
    .on("mousemove", function (event) {
      const [mx, my] = d3.pointer(event);
      if (horizontal) crosshair.attr("y1", my).attr("y2", my); else crosshair.attr("x1", mx).attr("x2", mx);
      const cat = narmast(horizontal ? my : mx);
      if (!cat) { highlightRing.style("opacity", 0); return; }
      const item = data.find(d => d[x] === cat);
      if (!item) return;
      const groupKey = color ? item[color] : "_all";
      const px = horizontal ? xScale(item[y]) : xScale(cat) + xScale.bandwidth() / 2;
      const py = horizontal ? yScale(cat) + yScale.bandwidth() / 2 : yScale(item[y]);
      highlightRing.attr("cx", px).attr("cy", py).attr("stroke", colorScale(groupKey)).style("opacity", 1);
      showValue(cat, item[y], groupKey);
    })
    .on("click", function (event) {
      const [mx, my] = d3.pointer(event);
      const cat = narmast(horizontal ? my : mx);
      if (cat) { smartToggle(cat, categories); updateLollipops(); }
    });

  // Legend om color finns och ingen väljare
  if (color && groups.length > 1 && groups[0] !== "_all" && !interactive) {
    const legend = svg.append("g").attr("transform", `translate(${plotRight + 15}, ${marginTop + 15})`);
    groups.forEach((group, i) => {
      const g = legend.append("g").attr("transform", `translate(0, ${i * 22})`);
      g.append("circle").attr("r", 5).attr("fill", colorScale(group));
      g.append("text").attr("x", 12).attr("dy", "0.35em")
        .attr("font-size", STORLEK.etikett).attr("font-family", TYP.ui).attr("font-weight", 600)
        .attr("fill", colorScale(group)).text(group);
    });
  }

  addExportButton(container, svg.node(), { title, subtitle, caption, width: autoWidth, height: chartHeight, altText, info, logo });

  return container.node();
}
