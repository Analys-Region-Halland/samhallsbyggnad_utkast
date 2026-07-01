// =============================================================================
// FILTER UTILS - Delad utility-modul for filter/highlight/selector-logik
// =============================================================================

/**
 * Bygger filterState med groupMap, filterSet och highlight-hantering.
 *
 * @param {Array} data - Hela datasetet
 * @param {Object} opts
 * @param {string} opts.itemField - Fält för individuella items (t.ex. "kommun", "namn")
 * @param {string|null} opts.groupField - Fält för gruppering (t.ex. "län", "color")
 * @param {Array|null} opts.filter - Begränsa valbara items (gruppnamn eller individuella)
 * @param {Array|null} opts.highlight - Förvalda highlightade items
 * @returns {Object} filterState
 */
export function createFilterState(data, { itemField, groupField = null, filter = null, highlight = null } = {}) {
  // Bygg gruppkarta från HELA datan
  const groupMap = new Map();
  if (groupField) {
    for (const d of data) {
      const groupName = d[groupField];
      const itemName = d[itemField];
      if (!groupMap.has(groupName)) groupMap.set(groupName, []);
      const members = groupMap.get(groupName);
      if (!members.includes(itemName)) members.push(itemName);
    }
  }

  // Resolva filter - bestam vilka items som ar valbara
  let filterSet = null;
  if (filter) {
    const resolved = [];
    for (const f of filter) {
      if (groupMap.has(f)) resolved.push(...groupMap.get(f));
      else resolved.push(f);
    }
    if (resolved.length > 0) {
      filterSet = resolved;
      // Bygg om groupMap for panelen (bara filtrerade items)
      groupMap.clear();
      if (groupField) {
        for (const d of data) {
          if (!filterSet.includes(d[itemField])) continue;
          const groupName = d[groupField];
          const itemName = d[itemField];
          if (!groupMap.has(groupName)) groupMap.set(groupName, []);
          const members = groupMap.get(groupName);
          if (!members.includes(itemName)) members.push(itemName);
        }
      }
    }
  }

  // Resolva highlight: expandera gruppnamn till individuella items
  let currentHighlight = null;
  if (highlight) {
    const resolved = [];
    for (const h of highlight) {
      if (groupMap.has(h)) resolved.push(...groupMap.get(h));
      else resolved.push(h);
    }
    currentHighlight = resolved.length > 0 ? resolved : null;
  } else if (filterSet) {
    // Om filter satt men inte highlight -> alla filtrerade markerade
    currentHighlight = [...filterSet];
  }

  // Dolda items (helt borttagna från grafen)
  const hiddenSet = new Set();

  return {
    groupMap,
    filterSet,

    isHighlighted(item) {
      if (hiddenSet.has(item)) return false;
      if (filterSet && !filterSet.includes(item)) return false;
      if (!currentHighlight || currentHighlight.length === 0) return true;
      return currentHighlight.includes(item);
    },

    isHidden(item) {
      return hiddenSet.has(item);
    },

    hide(item) {
      hiddenSet.add(item);
    },

    unhide(item) {
      hiddenSet.delete(item);
    },

    getHidden() {
      return [...hiddenSet];
    },

    toggle(item) {
      if (!currentHighlight) {
        currentHighlight = [item];
      } else if (currentHighlight.includes(item)) {
        currentHighlight = currentHighlight.filter(i => i !== item);
        if (currentHighlight.length === 0) currentHighlight = null;
      } else {
        currentHighlight = [...currentHighlight, item];
      }
    },

    toggleGroup(groupName) {
      const members = groupMap.get(groupName);
      if (!members) return;
      const allSelected = members.every(m => currentHighlight && currentHighlight.includes(m));
      if (allSelected) {
        currentHighlight = currentHighlight.filter(c => !members.includes(c));
        if (currentHighlight.length === 0) currentHighlight = null;
      } else {
        if (!currentHighlight) {
          currentHighlight = [...members];
        } else {
          const toAdd = members.filter(m => !currentHighlight.includes(m));
          currentHighlight = [...currentHighlight, ...toAdd];
        }
      }
    },

    getHighlight() {
      return currentHighlight;
    }
  };
}

/**
 * Injicerar CSS for selector-paneler (en gang).
 */
export function injectSelectorCSS() {
  if (document.getElementById("graf-selector-styles")) return;
  const styles = document.createElement("style");
  styles.id = "graf-selector-styles";
  styles.textContent = `
    .graf-selector {
      position: relative;        /* ankare för overlay-panelen */
      margin-top: 5px;
      font-family: 'Inter', system-ui, sans-serif;
      user-select: none;
    }
    .graf-selector-trigger {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11.5px;
      font-weight: 600;
      letter-spacing: 0.01em;
      color: var(--accent, #00664D);
      cursor: pointer;
      padding: 3px 10px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent, #00664D) 9%, #fff);
      border: 1px solid color-mix(in srgb, var(--accent, #00664D) 26%, transparent);
      transition: background 0.15s, border-color 0.15s;
    }
    .graf-selector-trigger:hover {
      background: color-mix(in srgb, var(--accent, #00664D) 15%, #fff);
      border-color: color-mix(in srgb, var(--accent, #00664D) 46%, transparent);
    }
    .graf-selector-panel {
      display: none;
      position: absolute;        /* OVERLAY — ligger utanpå grafen, knuffar inget */
      top: calc(100% + 7px);
      left: 0;
      z-index: 30;
      padding: 11px 13px;
      background: #fff;
      border: 1px solid color-mix(in srgb, var(--accent, #00664D) 18%, #d6d6d6);
      border-radius: 13px;
      box-shadow: 0 18px 44px -18px rgba(20, 31, 25, 0.34), 0 2px 8px rgba(20, 31, 25, 0.07);
      width: max-content;
      max-width: min(480px, 86vw);
    }
    .graf-selector.expanded .graf-selector-panel {
      display: block;
    }
    /* Flex-wrap av chips — kan ALDRIG överlappa (till skillnad mot kolumner/grid
       med nowrap-namn), och ingen scroll. Varje chip tar sin naturliga bredd. */
    .graf-selector-grid {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: 7px;
    }
    .graf-selector-group-header {
      flex-basis: 100%;
      width: 100%;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-top: 9px;
      margin-bottom: 4px;
      padding-bottom: 3px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      transition: opacity 0.12s;
    }
    .graf-selector-group-header:first-child {
      margin-top: 0;
    }
    .graf-selector-group-header:hover {
      opacity: 0.6;
    }
    .graf-selector-group-header .group-indicator {
      font-size: 8px;
    }
    .graf-selector-option {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px 4px 8px;
      border-radius: 999px;
      font-size: 12px;
      line-height: 1.1;
      cursor: pointer;
      background: rgba(20, 31, 25, 0.045);
      border: 1px solid transparent;
      white-space: nowrap;
      transition: background 0.14s, border-color 0.14s;
    }
    .graf-selector-option:hover {
      background: color-mix(in srgb, var(--accent, #00664D) 13%, #fff);
    }
    .graf-selector-option.selected {
      background: color-mix(in srgb, var(--accent, #00664D) 14%, #fff);
      border-color: color-mix(in srgb, var(--accent, #00664D) 42%, transparent);
    }
    .graf-selector-option .opt-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      border: 1.5px solid currentColor;
      background: transparent;
      box-sizing: border-box;
      flex-shrink: 0;
    }
    .graf-selector-option.selected .opt-dot {
      background: currentColor;
    }
    .graf-selector-option .opt-name {
      color: #44524D;
      white-space: nowrap;
    }
    .graf-selector-option.selected .opt-name {
      font-weight: 600;
      color: #141F19;
    }
    .graf-selector-option.hidden .opt-dot {
      background: transparent !important;
      border-color: #ccc !important;
      border-style: dashed;
    }
    .graf-selector-option.hidden .opt-name {
      text-decoration: line-through;
      color: #aaa !important;
      font-weight: 400 !important;
    }
    .graf-selector-option.hidden .opt-restore {
      font-size: 9px;
      color: #aaa;
      margin-left: 2px;
    }
    .graf-selector-option .opt-remove {
      margin-left: 3px;
      font-size: 12px;
      color: #c4c4c4;
      cursor: pointer;
      flex-shrink: 0;
      line-height: 1;
      opacity: 0;
      transition: opacity 0.15s, color 0.15s;
    }
    .graf-selector-option:hover .opt-remove {
      opacity: 1;
    }
    .graf-selector-option .opt-remove:hover {
      color: #d33;
    }
    .graf-selector-columns {
      column-gap: 20px;
    }
    .graf-selector-columns .graf-selector-option {
      break-inside: avoid;
    }
    .graf-selector-hidden-row {
      margin-top: 3px;
      font-family: 'IBM Plex Sans', sans-serif;
      font-size: 10px;
      color: #999;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 2px 8px;
    }
    .graf-selector-hidden-row .hidden-label {
      color: #bbb;
      font-size: 9px;
      letter-spacing: 0.02em;
    }
    .graf-selector-hidden-row .hidden-item {
      cursor: pointer;
      color: #999;
      text-decoration: line-through;
      transition: color 0.1s;
    }
    .graf-selector-hidden-row .hidden-item:hover {
      color: #333;
      text-decoration: none;
    }
  `;
  document.head.appendChild(styles);
}

/**
 * Skapar en selector-panel (trigger + expand-panel med grid).
 *
 * @param {d3.Selection} header - D3-selection att appenda selektorn till
 * @param {Object} opts
 * @param {Object} opts.filterState - returnvarde fran createFilterState
 * @param {Array} opts.allItems - Alla valbara items (for flat lista)
 * @param {Function} opts.colorScale - Fargfunktion (item eller grupp -> farg)
 * @param {string} opts.triggerText - Text pa trigger-knappen
 * @param {Function} opts.onUpdate - Callback nar highlight andras
 * @param {Function} [opts.onItemHover] - Callback vid hover pa item (item, event)
 * @param {Function} [opts.onItemLeave] - Callback vid leave fran item
 * @param {number|null} [opts.columns] - Antal kolumner for flat lista (top-to-bottom flow)
 * @returns {Object} { update(), element }
 */
export function createSelectorPanel(header, {
  filterState,
  allItems,
  colorScale,
  triggerText = "Markera \u203a",
  onUpdate,
  onItemHover = null,
  onItemLeave = null,
  columns = null
} = {}) {
  injectSelectorCSS();

  const selector = header.append("div")
    .attr("class", "graf-selector");

  const selectorTrigger = selector.append("span")
    .attr("class", "graf-selector-trigger")
    .text(triggerText);

  const selectorPanel = selector.append("div")
    .attr("class", "graf-selector-panel");

  const grid = selectorPanel.append("div")
    .attr("class", "graf-selector-grid");

  // Separat rad för dolda items (utanför panelen, alltid synlig)
  const hiddenRow = selector.append("div")
    .attr("class", "graf-selector-hidden-row")
    .style("display", "none");

  // Hover for expand/collapse. Panelen är en overlay med en liten lucka mellan
  // trigger och panel — mouseenter på hela selektorn (panelen ingår) avbryter
  // stängningen, så man kan föra muspekaren ner i panelen utan att den stängs.
  let hoverTimeout = null;
  selectorTrigger.on("mouseenter", () => {
    clearTimeout(hoverTimeout);
    selector.classed("expanded", true);
  });
  selector.on("mouseenter", () => {
    clearTimeout(hoverTimeout);
  });
  selector.on("mouseleave", () => {
    clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => {
      selector.classed("expanded", false);
    }, 200);
  });

  function update() {
    grid.selectAll("*").remove();
    const { groupMap } = filterState;

    if (groupMap && groupMap.size > 0) {
      for (const [groupName, members] of groupMap) {
        const groupMembers = members.filter(m => allItems.includes(m));
        if (groupMembers.length === 0) continue;

        const allInGroup = groupMembers.every(m => filterState.isHighlighted(m));
        const noneInGroup = groupMembers.every(m => !filterState.isHighlighted(m));
        const hl = filterState.getHighlight();
        const indicator = (!hl) ? "\u25CF" : allInGroup ? "\u25CF" : noneInGroup ? "\u25CB" : "\u25D0";

        const headerDiv = grid.append("div")
          .attr("class", "graf-selector-group-header")
          .style("color", colorScale(groupName))
          .style("border-bottom", `1px solid ${colorScale(groupName)}`)
          .on("click", (event) => {
            event.stopPropagation();
            filterState.toggleGroup(groupName);
            onUpdate();
          });

        headerDiv.append("span")
          .attr("class", "group-indicator")
          .text(indicator);

        headerDiv.append("span")
          .text(groupName);

        const subGrid = grid.append("div")
          .style("flex-basis", "100%")
          .style("width", "100%")
          .style("display", "flex")
          .style("flex-wrap", "wrap")
          .style("gap", "7px");

        groupMembers.forEach(item => {
          const hidden = filterState.isHidden(item);
          const selected = !hidden && filterState.isHighlighted(item);
          const catColor = colorScale(groupName);

          const opt = subGrid.append("span")
            .attr("class", `graf-selector-option ${selected ? "selected" : ""} ${hidden ? "hidden" : ""}`)
            .style("color", catColor)
            .on("click", (event) => {
              event.stopPropagation();
              if (hidden) {
                filterState.unhide(item);
              } else {
                const hl = filterState.getHighlight();
                const selectable = filterState.filterSet || allItems;
                const allOn = !hl || selectable.every(i => hl.includes(i));
                if (allOn) {
                  if (hl) hl.forEach(c => { if (c !== item) filterState.toggle(c); });
                  if (!filterState.isHighlighted(item) || !filterState.getHighlight()) filterState.toggle(item);
                } else {
                  filterState.toggle(item);
                }
              }
              onUpdate();
            });

          if (onItemHover && !hidden) {
            opt.on("mouseenter", (event) => onItemHover(item, event));
          }
          if (onItemLeave && !hidden) {
            opt.on("mouseleave", (event) => onItemLeave(item, event));
          }

          opt.append("span")
            .attr("class", "opt-dot")
            .style("border-color", catColor);

          opt.append("span")
            .attr("class", "opt-name")
            .text(item);

          if (hidden) {
            opt.append("span")
              .attr("class", "opt-restore")
              .text("↩");
          } else {
            opt.append("span")
              .attr("class", "opt-remove")
              .text("×")
              .on("click", (event) => {
                event.stopPropagation();
                filterState.hide(item);
                onUpdate();
              });
          }
        });
      }
    } else {
      // Flat lista (inga grupper)
      // Använd kolumnlayout om columns är satt
      const target = grid;  // flex-wrap-chips sköter layouten — inga överspillande kolumner

      allItems.forEach(item => {
        const hidden = filterState.isHidden(item);
        const selected = !hidden && filterState.isHighlighted(item);
        const catColor = colorScale(item);

        const opt = target.append("span")
          .attr("class", `graf-selector-option ${selected ? "selected" : ""} ${hidden ? "hidden" : ""}`)
          .style("color", catColor)
          .on("click", (event) => {
            event.stopPropagation();
            if (hidden) {
              // Klick på dold → visa igen
              filterState.unhide(item);
            } else {
              filterState.toggle(item);
            }
            onUpdate();
          });

        if (onItemHover && !hidden) {
          opt.on("mouseenter", (event) => onItemHover(item, event));
        }
        if (onItemLeave && !hidden) {
          opt.on("mouseleave", (event) => onItemLeave(item, event));
        }

        opt.append("span")
          .attr("class", "opt-dot")
          .style("border-color", catColor);

        opt.append("span")
          .attr("class", "opt-name")
          .text(item);

        if (hidden) {
          // Restore-indikator för dolda items
          opt.append("span")
            .attr("class", "opt-restore")
            .text("↩");
        } else {
          // X-knapp för att dölja (synlig vid hover)
          opt.append("span")
            .attr("class", "opt-remove")
            .text("×")
            .on("click", (event) => {
              event.stopPropagation();
              filterState.hide(item);
              onUpdate();
            });
        }
      });
    }

    // Bygg dolda-rad (utanför panelen, alltid synlig)
    hiddenRow.selectAll("*").remove();
    const allHidden = filterState.getHidden();
    if (allHidden.length > 0) {
      hiddenRow.style("display", null);
      hiddenRow.append("span")
        .attr("class", "hidden-label")
        .text("Dolda:");
      for (const item of allHidden) {
        hiddenRow.append("span")
          .attr("class", "hidden-item")
          .text(item + " ↩")
          .on("click", (event) => {
            event.stopPropagation();
            filterState.unhide(item);
            onUpdate();
          });
      }
    } else {
      hiddenRow.style("display", "none");
    }
  }

  return { update, element: selector };
}
