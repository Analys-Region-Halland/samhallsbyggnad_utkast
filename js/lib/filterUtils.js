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
 * CSS för selector-panelen ligger i style.scss (GRAFSYSTEM). Behålls som no-op
 * för bakåtkompatibilitet.
 */
export function injectSelectorCSS() {}

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

  const selectorTrigger = selector.append("button")
    .attr("type", "button")
    .attr("class", "graf-selector-trigger")
    .attr("aria-haspopup", "true")
    .attr("aria-expanded", "false");
  selectorTrigger.append("span").attr("class", "graf-selector-ikon")
    .html('<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>');
  selectorTrigger.append("span").attr("class", "graf-selector-text")
    .text(String(triggerText).replace(/s*[›>]s*$/, ""));
  const selectorAntal = selectorTrigger.append("span").attr("class", "graf-selector-antal");

  const selectorPanel = selector.append("div")
    .attr("class", "graf-selector-panel");

  const grid = selectorPanel.append("div")
    .attr("class", "graf-selector-grid");

  // Separat rad för dolda items (utanför panelen, alltid synlig)
  const hiddenRow = selector.append("div")
    .attr("class", "graf-selector-hidden-row")
    .style("display", "none");

  // Klick öppnar/stänger. Stängs vid klick utanför eller Escape.
  const stang = () => {
    selector.classed("expanded", false);
    selectorTrigger.attr("aria-expanded", "false");
    document.removeEventListener("pointerdown", utanfor, true);
    document.removeEventListener("keydown", tangent, true);
  };
  const utanfor = (e) => { if (!selector.node().contains(e.target)) stang(); };
  const tangent = (e) => { if (e.key === "Escape") stang(); };
  selectorTrigger.on("click", (event) => {
    event.stopPropagation();
    if (selector.classed("expanded")) { stang(); return; }
    selector.classed("expanded", true);
    selectorTrigger.attr("aria-expanded", "true");
    setTimeout(() => {
      document.addEventListener("pointerdown", utanfor, true);
      document.addEventListener("keydown", tangent, true);
    }, 0);
  });

  function update() {
    grid.selectAll("*").remove();
    const { groupMap } = filterState;
    // Antal markerade i knappen (tomt när alla visas)
    {
      const hl = filterState.getHighlight();
      const selectable = filterState.filterSet || allItems;
      const antal = hl ? hl.filter(i => selectable.includes(i) && !filterState.isHidden(i)).length : 0;
      selectorAntal.text(antal > 0 && antal < selectable.length ? String(antal) : "");
    }

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
