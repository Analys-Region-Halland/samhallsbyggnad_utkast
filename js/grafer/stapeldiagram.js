// =============================================================================
// STAPELDIAGRAM — vertikal och horisontell, enkel, grupperad eller staplad.
//
// Byggd på den gemensamma ramen (js/lib/grafRam.js):
//   • måttets namn (yLabel, för liggande staplar xLabel) står horisontellt
//     uppe till vänster ovanför plotytan
//   • tidsdimension (option `time`) väljs i en rullgardin i nedre raden
//   • väljaren "Markera" ligger i samma nedre rad
//   • avläsningsrad under rubriken visar värden vid hover
// =============================================================================

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "../lib/exportSvg.js";
import { createFilterState, createSelectorPanel } from "../lib/filterUtils.js";
import {
  skapaRam, TYP, FARG, STORLEK, SERIEFARGER,
  stilYAxel, stilXAxel, ritaGrid, xTitel, yTitel, yTitelPos,
  valPill, skapaTooltip, tooltipHtml, matText, axelFmt, autoFmt, ritbredd, arSmal, glesaTicks } from "../lib/grafRam.js";

// Snyggt intervall och max för värdeaxeln
function niceScale(dataMax, targetTicks = 5) {
  if (dataMax <= 0) return { max: 10, interval: 2, ticks: [0, 2, 4, 6, 8, 10] };
  const roughInterval = dataMax / targetTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughInterval)));
  const normalized = roughInterval / magnitude;
  let niceInterval;
  if (normalized <= 1) niceInterval = 1;
  else if (normalized <= 2) niceInterval = 2;
  else if (normalized <= 2.5) niceInterval = 2.5;
  else if (normalized <= 5) niceInterval = 5;
  else niceInterval = 10;
  const interval = niceInterval * magnitude;
  const max = Math.ceil(dataMax / interval) * interval;
  const ticks = [];
  for (let v = 0; v <= max; v += interval) ticks.push(v);
  return { max, interval, ticks };
}

export function stapeldiagram(data, {
  x = "kategori",
  y = "värde",
  color = null,
  time = null,            // Fält för tid (t.ex. "år") - aktiverar årsval för ranking
  width = null,
  height = 500,
  title = null,
  subtitle = null,
  caption = null,
  xLabel = null,
  yLabel = null,
  colors = SERIEFARGER,
  formatY = null,           // null = autoFmt (samma antal decimaler på alla värden)
  horizontal = false,
  grouped = false,
  showGrid = true,
  altText = null,
  info = null,
  logo = null,
  interactive = false,
  filter = null,          // Begränsa valbara items (gruppnamn eller individuella)
  highlight = null,
  filterBy = "x",         // "x" = filtrera kategorier, "color" = filtrera grupper
  groupOrder = null,      // explicit ordning för color-grupper (stapling, färg, legend)
  valueMax = null,        // fast övre gräns för värdeaxeln (t.ex. 100 för staplade andelar)
  showLegend = true       // false = dölj separat legendruta (färgade namn i undertiteln räcker)
} = {}) {
  if (!formatY) formatY = autoFmt(data.map(d => d[y]));

  // Smal skärm: färre ticks, och stående staplar med fler än tre kategorier
  // ritas liggande så att kategorinamnen ryms vågrätt (ordningen behålls)
  const smalBredd = arSmal(width || ritbredd(780));
  const vandTillLiggande = smalBredd && !horizontal && [...new Set(data.map(d => d[x]))].length > 3;
  if (vandTillLiggande) { horizontal = true; [xLabel, yLabel] = [yLabel, xLabel]; }

  const filterByColor = filterBy === "color" && color;

  const filterState = filterByColor
    ? createFilterState(data, { itemField: color, groupField: null, filter, highlight })
    : createFilterState(data, { itemField: x, groupField: color, filter, highlight });

  const categories = [...new Set(data.map(d => d[x]))];
  const groups = color
    ? (groupOrder || [...new Set(data.map(d => d[color]))])
    : ["_all"];

  // ── Tid (ranking-animation) ──
  const allTimes = time ? [...new Set(data.map(d => d[time]))].sort((a, b) => a - b) : [];
  let currentTime = allTimes.length > 0 ? allTimes[allTimes.length - 1] : null;
  const hasTimeAnimation = time && allTimes.length > 1 && !color;
  const getDataForTime = (t) => (!time ? data : data.filter(d => d[time] === t));

  // Skala: staplat läge → största stapelsumma per kategori (och tidpunkt)
  const dataMax = (color && !grouped)
    ? d3.max(d3.rollups(data,
        v => Math.round(d3.sum(v, d => Math.max(0, d[y])) * 1e6) / 1e6,
        d => `${d[x]}|${time ? d[time] : ""}`), d => d[1])
    : d3.max(data, d => d[y]);
  const dataMin = d3.min(data, d => d[y]);
  const valueNice = valueMax != null ? niceScale(valueMax, smalBredd ? 3 : 4) : niceScale(dataMax, smalBredd ? 3 : 5);

  if (dataMin < 0) {
    const negMin = Math.floor(dataMin / valueNice.interval) * valueNice.interval;
    const newTicks = [];
    for (let v = negMin; v <= valueNice.max; v += valueNice.interval) newTicks.push(Math.round(v * 1000) / 1000);
    valueNice.ticks = newTicks;
    valueNice.min = negMin;
  } else {
    valueNice.min = 0;
  }

  // ── Layout ──
  const autoWidth = width || ritbredd(780);
  // Måttets namn: yLabel (stående) resp. xLabel (liggande) står horisontellt ovanför plotytan
  const mattTitel = horizontal ? xLabel : yLabel;
  const marginTop = mattTitel ? 36 : 20;
  // Legenden ligger som chips ovanför plotytan (aldrig i högermarginalen, där
  // långa gruppnamn klipptes), så marginalen behöver bara rymma värdeetiketter.
  const marginRight = horizontal ? 48 : 24;
  // Stående staplar: kategorietiketterna radbryts så att de ryms i stapelns
  // bredd (högst tre rader). Bara om ett enskilt ord ändå inte får plats
  // vinklas etiketterna, som sista utväg.
  const autoWidth0 = width || ritbredd(780);
  const ungefarBand = (autoWidth0 - 90) / Math.max(1, categories.length) * 0.92;
  const radbryt = (txt, maxW) => {
    const ord = String(txt).split(" "), rader = [];
    let rad = "";
    for (const o of ord) {
      const prov = rad ? rad + " " + o : o;
      if (!rad || matText(prov, { size: STORLEK.tickX }) <= maxW) rad = prov;
      else { rader.push(rad); rad = o; }
    }
    if (rad) rader.push(rad);
    return rader;
  };
  const kategoriRader = new Map(horizontal ? [] : categories.map(c => [c, radbryt(c, ungefarBand)]));
  const rotera = !horizontal && categories.some(c =>
    kategoriRader.get(c).length > 3 || kategoriRader.get(c).some(r => matText(r, { size: STORLEK.tickX }) > ungefarBand + 4));
  const maxRader = horizontal || rotera ? 1 : Math.max(1, ...categories.map(c => kategoriRader.get(c).length));
  const marginBottom = horizontal ? 40 : (xLabel ? 58 : 48) + (rotera ? 26 : (maxRader - 1) * 15);

  // Grupperade liggande staplar: varje delstapel behöver ~15 px för att
  // värdeetiketterna (11 px) inte ska krocka
  const grupperadH = horizontal && grouped && color;
  const nGrupper = color ? (groupOrder || [...new Set(data.map(d => d[color]))]).length : 1;
  const pixelsPerCategory = grupperadH ? Math.max(48, nGrupper * 16 + 14) : 48;
  const dynamicHeight = horizontal
    ? Math.min(grupperadH ? 1400 : 600, Math.max(240, marginTop + marginBottom + categories.length * pixelsPerCategory))
    : height;

  let marginLeft = 18;
  if (horizontal) {
    const maxLabelW = Math.max(...categories.map(c => matText(String(c), { size: STORLEK.tickX, weight: 500 })));
    marginLeft = 16 + maxLabelW + 10;
  }

  const maxTickWidth = Math.max(...valueNice.ticks.map(t => String(formatY(t)).length)) * 6.6 + 8;
  const axisLeft = horizontal ? marginLeft : marginLeft + maxTickWidth;
  const plotRight = autoWidth - marginRight;
  const chartHeight = horizontal ? dynamicHeight : height;

  const colorScale = d3.scaleOrdinal().domain(groups).range(colors);

  // Färgkoda gruppnamn i undertiteln (inbäddad legend)
  const colorizeSubtitle = (text) => {
    if (!color || groups[0] === "_all" || !text) return null;
    let html = text;
    const sortedGroups = [...groups].sort((a, b) => String(b).length - String(a).length);
    let anyMatch = false;
    for (const group of sortedGroups) {
      const escaped = String(group).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'gi');
      const c = colorScale(group);
      html = html.replace(regex, (match) => {
        anyMatch = true;
        return `<span style="background:${c};color:#fff;padding:1px 7px;border-radius:999px;font-weight:600;white-space:nowrap;font-size:0.92em">${match}</span>`;
      });
    }
    return anyMatch ? html : null;
  };

  // ── Ram ──
  const ram = skapaRam({ title, subtitle, caption });
  const container = ram.container;
  container.attr("data-base-width", autoWidth);

  // Undertitel: färgade gruppnamn, eller aktuellt år vid årsval
  const yearRangeMatch = (hasTimeAnimation && subtitle)
    ? subtitle.match(/^(.+?)(\d{4})\s*[–\-]\s*(\d{4})(.*)$/) : null;
  const sattUndertitel = () => {
    if (yearRangeMatch) {
      const [, prefix, , , suffix] = yearRangeMatch;
      ram.setSubtitle(`${prefix.replace(/[,\s]+$/, "")}, ${currentTime}${suffix}`);
      return;
    }
    const colored = colorizeSubtitle(subtitle);
    if (colored) ram.subtitleEl.html(colored).style("display", null);
    else ram.setSubtitle(subtitle);
  };
  sattUndertitel();

  const avlasning = ram.avlasning("Peka för värden");
  const svg = ram.svg(autoWidth, chartHeight);

  // ── Highlight-logik ──
  const mutedColor = FARG.dampad;
  const isHighlighted = (cat, groupKey) => filterByColor
    ? filterState.isHighlighted(groupKey || "_all")
    : filterState.isHighlighted(cat);
  const isStacked = color && !grouped;
  const getCategoryColor = (cat, groupKey = "_all") => {
    if (isStacked) return colorScale(groupKey);
    if (!isHighlighted(cat, groupKey)) return mutedColor;
    return colorScale(groupKey);
  };
  const getBarOpacity = (cat, groupKey = "_all") => {
    if (!isStacked) return 1;
    return isHighlighted(cat, groupKey) ? 1 : 0.3;
  };

  let updateBars = null;

  // Väljare i nedre raden
  let selectorCtrl = null;
  if (interactive) {
    selectorCtrl = createSelectorPanel(ram.controlsLeft, {
      filterState,
      allItems: filterByColor ? groups : categories,
      colorScale: (filterByColor || color) ? colorScale : () => colors[0],
      triggerText: "Markera",
      onUpdate: () => { if (updateBars) updateBars(); }
    });
  }

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

  // Avläsning vid hover
  const showValue = (category, values) => {
    const rader = values.map(v => ({
      namn: v.label || mattTitel || "", varde: formatY(v.value), farg: v.color, fokus: values.length > 1 && v.fokus
    }));
    avlasning.visa(tooltipHtml(category, rader));
  };
  const hideValue = () => avlasning.rensa();

  // Måttets namn uppe till vänster
  if (mattTitel) {
    // Långt måttnamn som inte ryms ovanför plotytan börjar i stället vid vänsterkanten
    const ryms = matText(mattTitel, { size: STORLEK.yTitel, weight: 500 }) * 1.15 <= autoWidth - axisLeft - 8;
    const pos = yTitelPos(horizontal ? (ryms ? axisLeft : 18) : marginLeft, marginTop);
    yTitel(svg, { x: pos.x, y: pos.y, text: mattTitel });
  }

  if (horizontal) {
    // =======================================================================
    // HORISONTELLT STAPELDIAGRAM (med valfri ranking-animation)
    // =======================================================================
    let currentData = getDataForTime(currentTime);
    let sortedData = vandTillLiggande ? [...currentData] : [...currentData].sort((a, b) => b[y] - a[y]);
    let sortedCategories = sortedData.map(d => d[x]);
    const allCategories = categories;

    const yScale = d3.scaleBand()
      .domain(sortedCategories)
      .range([marginTop, chartHeight - marginBottom])
      .padding(0.33);

    const xScale = d3.scaleLinear()
      .domain([valueNice.min, valueNice.max])
      .range([axisLeft, plotRight]);

    const hasNegValues = dataMin < 0;

    const zebraGroup = svg.append("g").attr("class", "zebra-group");

    if (hasNegValues) {
      svg.append("line")
        .attr("x1", xScale(0)).attr("x2", xScale(0))
        .attr("y1", marginTop).attr("y2", chartHeight - marginBottom)
        .attr("stroke", FARG.noll).attr("stroke-width", 1);
    }

    // Värdeaxel nederst: bara etiketter
    svg.append("g")
      .attr("transform", `translate(0,${chartHeight - marginBottom})`)
      .call(d3.axisBottom(xScale).tickFormat(axelFmt(formatY)).tickValues(valueNice.ticks).tickSize(0))
      .call(g => g.select(".domain").remove())
      .call(g => g.selectAll(".tick text")
        .attr("fill", FARG.text)
        .attr("font-size", STORLEK.tick)
        .attr("font-family", TYP.ui)
        .style("font-variant-numeric", "tabular-nums"))
      .call(g => glesaTicks(g));

    const barsGroup = svg.append("g").attr("class", "bars-group");

    updateBars = function (animate = false) {
      currentData = getDataForTime(currentTime);

      if (isStacked) {
        // ── Horisontell staplad ──
        sortedCategories = categories;
        yScale.domain(sortedCategories);

        zebraGroup.selectAll("*").remove();
        for (let i = 0; i < sortedCategories.length - 1; i++) {
          const yMid = (yScale(sortedCategories[i]) + yScale.bandwidth() + yScale(sortedCategories[i + 1])) / 2;
          zebraGroup.append("line")
            .attr("x1", axisLeft).attr("x2", plotRight)
            .attr("y1", yMid).attr("y2", yMid)
            .attr("stroke", "#ededed").attr("stroke-width", 1);
        }

        const barHeight = yScale.bandwidth();
        barsGroup.selectAll("*").remove();

        sortedCategories.forEach(cat => {
          const isHl = isHighlighted(cat, "_all");
          barsGroup.append("text")
            .attr("x", axisLeft - 10)
            .attr("y", yScale(cat) + barHeight / 2)
            .attr("dy", "0.35em")
            .attr("text-anchor", "end")
            .attr("font-family", TYP.ui)
            .attr("font-size", STORLEK.tickX)
            .attr("font-weight", isHl ? 500 : 400)
            .attr("fill", isHl ? FARG.ink : FARG.mjuk)
            .text(cat);
        });

        const stackedData = d3.stack()
          .keys(groups)
          .value((cat, key) => {
            const found = data.find(item => item[x] === cat && item[color] === key);
            return found ? found[y] : 0;
          })(sortedCategories);

        stackedData.forEach((layerData) => {
          layerData.forEach((d, i) => {
            const cat = sortedCategories[i];
            const barColor = getCategoryColor(cat, layerData.key);
            const baseOpacity = getBarOpacity(cat, layerData.key);
            barsGroup.append("rect")
              .attr("data-category", cat)
              .attr("data-group", layerData.key)
              .attr("y", yScale(cat))
              .attr("x", Math.min(xScale(d[0]), xScale(d[1])))
              .attr("width", Math.abs(xScale(d[1]) - xScale(d[0])))
              .attr("height", barHeight)
              .attr("fill", barColor)
              .attr("opacity", baseOpacity)
              .attr("rx", 2)
              .style("cursor", "pointer")
              .on("mouseenter", function () {
                d3.select(this).attr("opacity", Math.min(baseOpacity + 0.15, 1));
                const catValues = groups.map(g => {
                  const item = data.find(item => item[x] === cat && item[color] === g);
                  return { label: g, value: item ? item[y] : 0, color: getCategoryColor(cat, g) };
                });
                showValue(cat, catValues);
              })
              .on("mouseleave", function () {
                d3.select(this).attr("opacity", baseOpacity);
                hideValue();
              })
              .on("click", function () {
                smartToggle(cat, categories);
                updateBars(false);
              });
          });
        });

      } else if (grouped && color) {
        // ── Horisontell grupperad: en delstapel per grupp inom varje kategori ──
        sortedCategories = categories;
        yScale.domain(sortedCategories);
        const ySub = d3.scaleBand().domain(groups).range([0, yScale.bandwidth()]).padding(0.12);
        const zeroX = xScale(0);

        zebraGroup.selectAll("*").remove();
        for (let i = 0; i < sortedCategories.length - 1; i++) {
          const yMid = (yScale(sortedCategories[i]) + yScale.bandwidth() + yScale(sortedCategories[i + 1])) / 2;
          zebraGroup.append("line")
            .attr("x1", axisLeft).attr("x2", plotRight)
            .attr("y1", yMid).attr("y2", yMid)
            .attr("stroke", "#ededed").attr("stroke-width", 1);
        }

        barsGroup.selectAll("*").remove();
        sortedCategories.forEach(cat => {
          const anyHl = groups.some(g => isHighlighted(cat, g));
          barsGroup.append("text")
            .attr("x", axisLeft - 10)
            .attr("y", yScale(cat) + yScale.bandwidth() / 2)
            .attr("dy", "0.35em")
            .attr("text-anchor", "end")
            .attr("font-family", TYP.ui)
            .attr("font-size", STORLEK.tickX)
            .attr("font-weight", anyHl ? 500 : 400)
            .attr("fill", anyHl ? FARG.ink : FARG.mjuk)
            .text(cat);

          groups.forEach(g => {
            const item = currentData.find(d => d[x] === cat && d[color] === g);
            if (!item) return;
            const v = item[y];
            const valX = xScale(v);
            const barColor = getCategoryColor(cat, g);
            const isHl = isHighlighted(cat, g);
            const by = yScale(cat) + ySub(g);
            barsGroup.append("rect")
              .attr("class", "bar-rect")
              .attr("data-category", cat)
              .attr("data-group", g)
              .attr("x", Math.min(zeroX, valX))
              .attr("y", by)
              .attr("width", Math.max(0, Math.abs(valX - zeroX)))
              .attr("height", ySub.bandwidth())
              .attr("fill", barColor)
              .attr("rx", 2)
              .style("cursor", "pointer")
              .on("mouseenter", function () {
                d3.select(this).attr("opacity", 0.8);
                const catValues = groups.map(gg => {
                  const it = currentData.find(d => d[x] === cat && d[color] === gg);
                  return { label: gg, value: it ? it[y] : 0, color: getCategoryColor(cat, gg) };
                });
                showValue(cat, catValues);
              })
              .on("mouseleave", function () {
                d3.select(this).attr("opacity", 1);
                hideValue();
              })
              .on("click", function () {
                smartToggle(filterByColor ? g : cat, filterByColor ? groups : categories);
                updateBars(false);
              });
            barsGroup.append("text")
              .attr("x", v < 0 ? valX - 5 : valX + 5)
              .attr("y", by + ySub.bandwidth() / 2)
              .attr("dy", "0.35em")
              .attr("text-anchor", v < 0 ? "end" : "start")
              .attr("font-family", TYP.ui)
              .attr("font-size", 11)
              .attr("fill", isHl ? FARG.text : FARG.dampad)
              .style("font-variant-numeric", "tabular-nums")
              .text(formatY(v));
          });
        });

      } else {
        // ── Horisontell enkel (rankad) ──
        sortedData = vandTillLiggande ? [...currentData] : [...currentData].sort((a, b) => b[y] - a[y]);
        sortedCategories = sortedData.map(d => d[x]);
        yScale.domain(sortedCategories);

        zebraGroup.selectAll("*").remove();
        for (let i = 0; i < sortedCategories.length - 1; i++) {
          const yMid = (yScale(sortedCategories[i]) + yScale.bandwidth() + yScale(sortedCategories[i + 1])) / 2;
          zebraGroup.append("line")
            .attr("x1", axisLeft).attr("x2", plotRight)
            .attr("y1", yMid).attr("y2", yMid)
            .attr("stroke", "#ededed").attr("stroke-width", 1);
        }

        const barHeight = yScale.bandwidth();
        const duration = animate ? 400 : 0;

        const barGroups = barsGroup.selectAll(".bar-group").data(sortedData, d => d[x]);
        barGroups.exit().remove();

        const barGroupsEnter = barGroups.enter()
          .append("g")
          .attr("class", "bar-group")
          .attr("transform", d => `translate(0, ${yScale(d[x])})`);

        barGroupsEnter.append("text")
          .attr("class", "bar-label")
          .attr("x", axisLeft - 10)
          .attr("dy", "0.35em")
          .attr("text-anchor", "end")
          .attr("font-family", TYP.ui);

        barGroupsEnter.append("rect")
          .attr("class", "bar-rect")
          .attr("x", hasNegValues ? xScale(0) : axisLeft)
          .attr("rx", 3)
          .style("cursor", "pointer");

        barGroupsEnter.append("text")
          .attr("class", "bar-value")
          .attr("dy", "0.35em")
          .attr("text-anchor", "start")
          .attr("font-family", TYP.ui)
          .style("font-variant-numeric", "tabular-nums");

        const allBarGroups = barGroupsEnter.merge(barGroups);

        allBarGroups.transition().duration(duration)
          .attr("transform", d => `translate(0, ${yScale(d[x])})`);

        allBarGroups.each(function (d) {
          const g = d3.select(this);
          const groupKey = color ? d[color] : "_all";
          const barColor = getCategoryColor(d[x], groupKey);
          const isHl = isHighlighted(d[x], groupKey);

          g.select(".bar-label")
            .attr("y", barHeight / 2)
            .attr("fill", isHl ? FARG.ink : FARG.mjuk)
            .attr("font-size", STORLEK.tickX)
            .attr("font-weight", isHl ? 500 : 400)
            .text(d[x]);

          g.select(".bar-rect")
            .attr("data-category", d[x])
            .attr("data-group", groupKey)
            .attr("y", 0)
            .attr("height", barHeight)
            .attr("fill", barColor)
            .on("mouseenter", function () {
              d3.select(this).attr("opacity", 0.8);
              showValue(d[x], [{ label: hasTimeAnimation ? String(currentTime) : "", value: d[y], color: barColor }]);
            })
            .on("mouseleave", function () {
              d3.select(this).attr("opacity", 1);
              hideValue();
            })
            .on("click", function () {
              smartToggle(filterByColor ? groupKey : d[x], filterByColor ? groups : categories);
              updateBars(false);
            });

          if (hasNegValues) {
            const zeroX = xScale(0);
            const valX = xScale(d[y]);
            g.select(".bar-rect").transition().duration(duration)
              .attr("x", Math.min(zeroX, valX))
              .attr("width", Math.max(0, Math.abs(valX - zeroX)));
          } else {
            g.select(".bar-rect").transition().duration(duration)
              .attr("width", Math.max(0, xScale(d[y]) - axisLeft));
          }

          g.select(".bar-value")
            .attr("y", barHeight / 2)
            .attr("fill", isHl ? FARG.text : FARG.dampad)
            .attr("font-size", STORLEK.tick)
            .attr("text-anchor", hasNegValues && d[y] < 0 ? "end" : "start")
            .text(formatY(d[y]));

          g.select(".bar-value").transition().duration(duration)
            .attr("x", hasNegValues && d[y] < 0 ? xScale(d[y]) - 6 : xScale(d[y]) + 6);
        });
      }

      if (selectorCtrl) selectorCtrl.update();
    };

    updateBars(false);

    // Panel-hover → markera stapel
    if (selectorCtrl) {
      const panelGrid = selectorCtrl.element.select(".graf-selector-grid");
      const matchAttrH = filterByColor ? "data-group" : "data-category";
      panelGrid.node().addEventListener("mouseover", (event) => {
        const opt = event.target.closest(".graf-selector-option");
        if (!opt) {
          barsGroup.selectAll(".bar-rect").attr("stroke", "none");
          hideValue();
          return;
        }
        const itemName = opt.querySelector(".opt-name")?.textContent;
        if (itemName) {
          barsGroup.selectAll(".bar-rect").each(function () {
            const el = d3.select(this);
            if (el.attr(matchAttrH) === itemName) el.attr("stroke", FARG.ink).attr("stroke-width", 2);
            else el.attr("stroke", "none");
          });
          if (filterByColor) {
            const total = d3.sum(getDataForTime(currentTime).filter(d => d[color] === itemName), d => d[y]);
            showValue(itemName, [{ label: "", value: total, color: colorScale(itemName) }]);
          } else {
            const item = getDataForTime(currentTime).find(d => d[x] === itemName);
            if (item) {
              const gk = color ? item[color] : "_all";
              showValue(itemName, [{ label: hasTimeAnimation ? String(currentTime) : "", value: item[y], color: getCategoryColor(itemName, gk) }]);
            }
          }
        }
      });
      panelGrid.node().addEventListener("mouseout", (event) => {
        const related = event.relatedTarget;
        if (related && panelGrid.node().contains(related)) return;
        barsGroup.selectAll(".bar-rect").attr("stroke", "none");
        hideValue();
      });
    }

    // Tooltip för staplad horisontell
    const tooltip = isStacked ? skapaTooltip(ram.body) : null;

    const crosshair = svg.append("line")
      .attr("class", "crosshair")
      .attr("x1", axisLeft).attr("x2", plotRight)
      .attr("stroke", "#9a9f9d").attr("stroke-width", 1).attr("stroke-dasharray", "3,3")
      .style("opacity", 0).style("pointer-events", "none");

    const highlightPanel = svg.insert("rect", ".bars-group")
      .attr("class", "highlight-panel")
      .attr("fill", "#f3f5f4").attr("stroke", "none").attr("rx", 3)
      .style("opacity", 0).style("pointer-events", "none");

    const highlightRect = svg.append("rect")
      .attr("class", "highlight-rect")
      .attr("fill", "none").attr("stroke", FARG.ink).attr("stroke-width", 1.5).attr("rx", 3)
      .style("opacity", 0).style("pointer-events", "none");

    const svgTillCss = (mx, my) => {
      const s = svg.node().getBoundingClientRect(), b = ram.body.node().getBoundingClientRect();
      return { x: s.left - b.left + mx * (s.width / autoWidth), y: s.top - b.top + my * (s.height / chartHeight) };
    };

    svg.append("rect")
      .attr("class", "overlay")
      .attr("x", axisLeft).attr("y", marginTop)
      .attr("width", plotRight - axisLeft).attr("height", chartHeight - marginTop - marginBottom)
      .attr("fill", "transparent")
      .style("cursor", "default")
      .on("mouseenter", () => crosshair.style("opacity", 1))
      .on("mouseleave", () => {
        crosshair.style("opacity", 0);
        highlightPanel.style("opacity", 0);
        highlightRect.style("opacity", 0);
        if (tooltip) {
          tooltip.dolj();
          barsGroup.selectAll("rect[data-category]").attr("stroke", "none");
        }
        hideValue();
      })
      .on("mousemove", function (event) {
        const [mx, my] = d3.pointer(event);
        crosshair.attr("y1", my).attr("y2", my);

        let closestCat = null, minDist = Infinity;
        for (const cat of sortedCategories) {
          const catY = yScale(cat) + yScale.bandwidth() / 2;
          const dist = Math.abs(my - catY);
          if (dist < minDist) { minDist = dist; closestCat = cat; }
        }

        if (closestCat && minDist < yScale.bandwidth()) {
          const barY = yScale(closestCat);

          if (isStacked && tooltip) {
            highlightPanel
              .attr("x", 18).attr("y", barY - 4)
              .attr("width", autoWidth - 36).attr("height", yScale.bandwidth() + 8)
              .style("opacity", 1);
            highlightRect.style("opacity", 0);

            let hoveredGroup = null;
            barsGroup.selectAll("rect[data-category]").each(function () {
              const el = d3.select(this);
              if (el.attr("data-category") === closestCat) {
                const rx = +el.attr("x"), rw = +el.attr("width");
                if (mx >= rx && mx <= rx + rw) hoveredGroup = el.attr("data-group");
              }
            });
            barsGroup.selectAll("rect[data-category]").each(function () {
              const el = d3.select(this);
              if (el.attr("data-category") === closestCat && el.attr("data-group") === hoveredGroup) el.attr("stroke", "#fff").attr("stroke-width", 2);
              else el.attr("stroke", "none");
            });

            const rader = groups.map(g => {
              const item = data.find(item => item[x] === closestCat && item[color] === g);
              return { namn: g, value: item ? item[y] : 0, farg: getCategoryColor(closestCat, g), fokus: g === hoveredGroup };
            }).filter(r => r.value !== 0).map(r => ({ ...r, varde: formatY(r.value) }));

            const p = svgTillCss(mx, my);
            tooltip.visa(tooltipHtml(closestCat, rader), { x: p.x, y: p.y });
          } else {
            if (tooltip) tooltip.dolj();
            const item = currentData.find(d => d[x] === closestCat);
            if (item) {
              const groupKey = color ? item[color] : "_all";
              if (color) {
                highlightPanel
                  .attr("x", 18).attr("y", barY - 4)
                  .attr("width", autoWidth - 36).attr("height", yScale.bandwidth() + 8)
                  .style("opacity", 1);
                highlightRect.style("opacity", 0);
                if (grouped) {
                  showValue(closestCat, groups.map(g => {
                    const it = currentData.find(d => d[x] === closestCat && d[color] === g);
                    return { label: g, value: it ? it[y] : 0, color: getCategoryColor(closestCat, g) };
                  }));
                  return;
                }
              } else {
                const barWidth = Math.max(0, xScale(item[y]) - axisLeft);
                highlightRect
                  .attr("x", axisLeft - 2).attr("y", barY - 2)
                  .attr("width", barWidth + 4).attr("height", yScale.bandwidth() + 4)
                  .style("opacity", 1);
                highlightPanel.style("opacity", 0);
              }
              showValue(closestCat, [{ label: hasTimeAnimation ? String(currentTime) : "", value: item[y], color: colorScale(groupKey) }]);
            }
          }
        } else {
          highlightPanel.style("opacity", 0);
          highlightRect.style("opacity", 0);
          if (tooltip) {
            tooltip.dolj();
            barsGroup.selectAll("rect[data-category]").attr("stroke", "none");
          }
        }
      })
      .on("click", function (event) {
        const [, my] = d3.pointer(event);
        let closestCat = null, minDist = Infinity;
        for (const cat of sortedCategories) {
          const catY = yScale(cat) + yScale.bandwidth() / 2;
          const dist = Math.abs(my - catY);
          if (dist < minDist) { minDist = dist; closestCat = cat; }
        }
        if (closestCat && minDist < yScale.bandwidth()) {
          if (filterByColor) {
            const item = currentData.find(d => d[x] === closestCat);
            if (item) smartToggle(color ? item[color] : "_all", groups);
          } else {
            smartToggle(closestCat, categories);
          }
          updateBars(false);
        }
      });

  } else {
    // =======================================================================
    // VERTIKALT STAPELDIAGRAM
    // =======================================================================
    const innerWidth = plotRight - axisLeft;

    const xScale = d3.scaleBand()
      .domain(categories)
      .range([axisLeft, plotRight])
      .padding(0.25);

    const xSubScale = grouped && color
      ? d3.scaleBand().domain(groups).range([0, xScale.bandwidth()]).padding(0.08)
      : null;

    const yScale = d3.scaleLinear()
      .domain([0, valueNice.max])
      .range([height - marginBottom, marginTop]);

    // Grid först (bakom staplarna)
    const gridGroup = svg.append("g").attr("class", "grid-lines");
    if (showGrid) {
      const gridTicks = valueNice.ticks.length > 6
        ? valueNice.ticks.filter((_, i) => i % 2 === 0)
        : valueNice.ticks;
      ritaGrid(gridGroup, { ticks: gridTicks, scale: yScale, x1: axisLeft, x2: plotRight, noll: 0 });
    }

    // Kategoriaxel
    const xAxisG = svg.append("g")
      .attr("transform", `translate(0,${height - marginBottom})`)
      .call(d3.axisBottom(xScale).tickSizeOuter(0).tickSize(0));
    stilXAxel(xAxisG);
    xAxisG.selectAll(".tick text")
      .attr("transform", rotera ? "rotate(-35)" : null)
      .attr("text-anchor", rotera ? "end" : "middle")
      .attr("dy", rotera ? "0.5em" : "0.9em");
    if (!rotera) {
      xAxisG.selectAll(".tick text").each(function (c) {
        const rader = kategoriRader.get(c) || [String(c)];
        if (rader.length < 2) return;
        const t = d3.select(this).text(null).attr("dy", null);
        rader.forEach((r, i) => t.append("tspan").attr("x", 0).attr("dy", i ? "1.2em" : "0.9em").text(r));
      });
    }

    if (xLabel) xTitel(svg, { x: axisLeft + innerWidth / 2, y: height - 6, text: xLabel });

    // Värdeaxel: bara etiketter
    const yAxisG = svg.append("g")
      .attr("transform", `translate(${axisLeft},0)`)
      .call(d3.axisLeft(yScale).tickFormat(axelFmt(formatY)).tickValues(valueNice.ticks));
    stilYAxel(yAxisG);

    const barsGroup = svg.append("g").attr("class", "bars-group");

    updateBars = function () {
      barsGroup.selectAll("*").remove();

      if (grouped && color) {
        for (const group of groups) {
          const groupData = data.filter(d => d[color] === group);
          groupData.forEach(d => {
            const barColor = getCategoryColor(d[x], group);
            barsGroup.append("rect")
              .attr("data-category", d[x])
              .attr("data-group", group)
              .attr("x", xScale(d[x]) + xSubScale(group))
              .attr("y", yScale(d[y]))
              .attr("width", xSubScale.bandwidth())
              .attr("height", yScale(0) - yScale(d[y]))
              .attr("fill", barColor)
              .attr("rx", 2)
              .style("cursor", "pointer")
              .on("mouseenter", function () {
                d3.select(this).attr("opacity", 0.8);
                const catValues = groups.map(g => {
                  const item = data.find(item => item[x] === d[x] && item[color] === g);
                  return { label: g, value: item ? item[y] : 0, color: getCategoryColor(d[x], g) };
                });
                showValue(d[x], catValues);
              })
              .on("mouseleave", function () {
                d3.select(this).attr("opacity", 1);
                hideValue();
              })
              .on("click", function () {
                smartToggle(filterByColor ? group : d[x], filterByColor ? groups : categories);
                updateBars();
              });
          });
        }
      } else if (color) {
        const stackedData = d3.stack()
          .keys(groups)
          .value((d, key) => {
            const found = data.find(item => item[x] === d && item[color] === key);
            return found ? found[y] : 0;
          })(categories);

        stackedData.forEach((layerData) => {
          layerData.forEach((d, i) => {
            const cat = categories[i];
            const barColor = getCategoryColor(cat, layerData.key);
            const baseOpacity = getBarOpacity(cat, layerData.key);
            barsGroup.append("rect")
              .attr("data-category", cat)
              .attr("data-group", layerData.key)
              .attr("x", xScale(cat))
              .attr("y", yScale(d[1]))
              .attr("height", yScale(d[0]) - yScale(d[1]))
              .attr("width", xScale.bandwidth())
              .attr("fill", barColor)
              .attr("opacity", baseOpacity)
              .attr("rx", 2)
              .style("cursor", "pointer")
              .on("mouseenter", function () {
                d3.select(this).attr("opacity", Math.min(baseOpacity + 0.15, 1));
                const catValues = groups.map(g => {
                  const item = data.find(item => item[x] === cat && item[color] === g);
                  return { label: g, value: item ? item[y] : 0, color: getCategoryColor(cat, g) };
                });
                showValue(cat, catValues);
              })
              .on("mouseleave", function () {
                d3.select(this).attr("opacity", baseOpacity);
                hideValue();
              })
              .on("click", function () {
                smartToggle(filterByColor ? layerData.key : cat, filterByColor ? groups : categories);
                updateBars();
              });
          });
        });
      } else {
        data.forEach(d => {
          const barColor = getCategoryColor(d[x]);
          barsGroup.append("rect")
            .attr("data-category", d[x])
            .attr("data-group", "_all")
            .attr("x", xScale(d[x]))
            .attr("y", yScale(d[y]))
            .attr("width", xScale.bandwidth())
            .attr("height", yScale(0) - yScale(d[y]))
            .attr("fill", barColor)
            .attr("rx", 2)
            .style("cursor", "pointer")
            .on("mouseenter", function () {
              d3.select(this).attr("opacity", 0.8);
              showValue(d[x], [{ label: yLabel || "Värde", value: d[y], color: barColor }]);
            })
            .on("mouseleave", function () {
              d3.select(this).attr("opacity", 1);
              hideValue();
            })
            .on("click", function () {
              smartToggle(d[x], categories);
              updateBars();
            });
        });
      }

      if (selectorCtrl) selectorCtrl.update();
    };

    updateBars();

    if (selectorCtrl) {
      const panelGrid = selectorCtrl.element.select(".graf-selector-grid");
      const matchAttrV = filterByColor ? "data-group" : "data-category";
      panelGrid.node().addEventListener("mouseover", (event) => {
        const opt = event.target.closest(".graf-selector-option");
        if (!opt) {
          barsGroup.selectAll("rect[data-category]").attr("stroke", "none");
          hideValue();
          return;
        }
        const itemName = opt.querySelector(".opt-name")?.textContent;
        if (itemName) {
          barsGroup.selectAll("rect[data-category]").each(function () {
            const el = d3.select(this);
            if (el.attr(matchAttrV) === itemName) el.attr("stroke", FARG.ink).attr("stroke-width", 2);
            else el.attr("stroke", "none");
          });
          if (filterByColor) {
            const total = d3.sum(data.filter(d => d[color] === itemName), d => d[y]);
            showValue(itemName, [{ label: "", value: total, color: colorScale(itemName) }]);
          } else {
            const item = data.find(d => d[x] === itemName);
            if (item) {
              const gk = color ? item[color] : "_all";
              showValue(itemName, [{ label: "", value: item[y], color: getCategoryColor(itemName, gk) }]);
            }
          }
        }
      });
      panelGrid.node().addEventListener("mouseout", (event) => {
        const related = event.relatedTarget;
        if (related && panelGrid.node().contains(related)) return;
        barsGroup.selectAll("rect[data-category]").attr("stroke", "none");
        hideValue();
      });
    }

    const crosshair = svg.append("line")
      .attr("class", "crosshair")
      .attr("y1", marginTop).attr("y2", height - marginBottom)
      .attr("stroke", "#9a9f9d").attr("stroke-width", 1).attr("stroke-dasharray", "3,3")
      .style("opacity", 0).style("pointer-events", "none");

    const highlightPanel = svg.insert("rect", ":first-child")
      .attr("class", "highlight-panel")
      .attr("fill", "#f3f5f4").attr("stroke", "none").attr("rx", 3)
      .style("opacity", 0).style("pointer-events", "none");

    const highlightRect = svg.append("rect")
      .attr("class", "highlight-rect")
      .attr("fill", "none").attr("stroke", FARG.ink).attr("stroke-width", 1.5).attr("rx", 2)
      .style("opacity", 0).style("pointer-events", "none");

    svg.append("rect")
      .attr("class", "overlay")
      .attr("x", axisLeft).attr("y", marginTop)
      .attr("width", innerWidth).attr("height", height - marginTop - marginBottom)
      .attr("fill", "transparent")
      .style("cursor", "default")
      .on("mouseenter", () => crosshair.style("opacity", 1))
      .on("mouseleave", () => {
        crosshair.style("opacity", 0);
        highlightPanel.style("opacity", 0);
        highlightRect.style("opacity", 0);
        hideValue();
      })
      .on("mousemove", function (event) {
        const [mx] = d3.pointer(event);
        crosshair.attr("x1", mx).attr("x2", mx);

        let closestCat = null, minDist = Infinity;
        for (const cat of categories) {
          const catX = xScale(cat) + xScale.bandwidth() / 2;
          const dist = Math.abs(mx - catX);
          if (dist < minDist) { minDist = dist; closestCat = cat; }
        }

        if (closestCat && minDist < xScale.bandwidth()) {
          const barX = xScale(closestCat);
          if (color) {
            highlightPanel
              .attr("x", barX - 4).attr("y", marginTop)
              .attr("width", xScale.bandwidth() + 8).attr("height", height - marginBottom - marginTop)
              .style("opacity", 1);
            highlightRect.style("opacity", 0);
            const catValues = groups.map(g => {
              const item = data.find(item => item[x] === closestCat && item[color] === g);
              return { label: g, value: item ? item[y] : 0, color: colorScale(g) };
            });
            showValue(closestCat, catValues);
          } else {
            const item = data.find(d => d[x] === closestCat);
            if (item) {
              const barY = yScale(item[y]);
              const barHeight = yScale(0) - yScale(item[y]);
              highlightRect
                .attr("x", barX - 2).attr("y", barY - 2)
                .attr("width", xScale.bandwidth() + 4).attr("height", barHeight + 4)
                .style("opacity", 1);
              highlightPanel.style("opacity", 0);
              showValue(closestCat, [{ label: "", value: item[y], color: colors[0] }]);
            }
          }
        } else {
          highlightPanel.style("opacity", 0);
          highlightRect.style("opacity", 0);
        }
      })
      .on("click", function (event) {
        const [mx, my] = d3.pointer(event);
        if (filterByColor) {
          let clickedGroup = null;
          barsGroup.selectAll("rect[data-group]").each(function () {
            const rect = d3.select(this);
            const bx = +rect.attr("x"), by = +rect.attr("y");
            const bw = +rect.attr("width"), bh = +rect.attr("height");
            if (mx >= bx && mx <= bx + bw && my >= by && my <= by + bh) clickedGroup = rect.attr("data-group");
          });
          if (clickedGroup) { smartToggle(clickedGroup, groups); updateBars(); }
        } else {
          let closestCat = null, minDist = Infinity;
          for (const cat of categories) {
            const catX = xScale(cat) + xScale.bandwidth() / 2;
            const dist = Math.abs(mx - catX);
            if (dist < minDist) { minDist = dist; closestCat = cat; }
          }
          if (closestCat && minDist < xScale.bandwidth()) { smartToggle(closestCat, categories); updateBars(); }
        }
      });
  }

  // ── År (nedre raden, rullgardin) ──
  if (hasTimeAnimation) {
    valPill(ram.controlsLeft, {
      label: "År", options: allTimes.map(String), activeIndex: allTimes.indexOf(currentTime), body: ram.body,
      onSelect: (i) => {
        currentTime = allTimes[i];
        sattUndertitel();
        if (updateBars) updateBars(true);
      }
    });
  }

  // ── Legend: chips ovanför plotytan, vänsterställda, radbryts (ONS/Datawrapper) ──
  if (showLegend && color && groups.length > 1 && groups[0] !== "_all" && !(interactive && filterByColor)) {
    const legend = container.insert("div", ".graf-body").attr("class", "graf-legend-chips");
    groups.forEach(group => {
      const item = legend.append("span").attr("class", "graf-legend-chip");
      item.append("span").attr("class", "graf-legend-prick").style("background", colorScale(group));
      item.append("span").text(group);
    });
  }

  addExportButton(container, svg.node(), {
    title, subtitle, caption, width: autoWidth, height: chartHeight, altText, info, logo
  });

  return container.node();
}
