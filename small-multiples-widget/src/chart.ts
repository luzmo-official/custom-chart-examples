import { formatter } from "@luzmo/analytics-components-kit/utils";
import type {
  ItemData,
  ItemFilter,
  ItemThemeConfig,
  ItemQuery,
  ItemQueryDimension,
  ItemQueryMeasure,
  Slot,
  SlotConfig,
} from "@luzmo/dashboard-contents-types";
import * as d3 from "d3";

interface ChartDataItem {
  facet: string;
  axis: string | Date;
  axisRaw: any;
  valueFormatted: string;
  valueRaw: number;
}

// Define custom event data interface
interface CustomEventData {
  type: string;
  data: {
    facet: string;
    axis: string | Date;
    value: string | number;
    rawValue: number;
  };
}

interface FilterEventData {
  type: string;
  filters: ItemFilter[];
}

// State management for selected bars
interface ChartState {
  selectedAxisValues: Set<string>;
  selectedFacet?: string;
  selectionByFacet?: Map<string, Set<string>>;
  facetSlot?: Slot;
  axisSlot?: Slot;
  measureSlot?: Slot;
  chartType: "line" | "area" | "column" | "bar";
}

// Initialize chart state
const chartState: ChartState = {
  selectedAxisValues: new Set(),
  chartType: "column",
};

interface ThemeContext {
  backgroundColor: string;
  axisTextColor: string;
  axisLineColor: string;
  fontFamily: string;
  basePalette: string[];
  mainColor: string;
  barRounding: number;
  barPadding: number;
  hoverShadow: string;
  selectedShadow: string;
  tooltipBackground: string;
  tooltipColor: string;
  controlBackground: string;
  controlBorder: string;
  controlText: string;
  controlHoverBackground: string;
}

function toRgb(color?: string, fallback = "#ffffff"): d3.RGBColor {
  const parsed = d3.color(color ?? fallback) ?? d3.color(fallback);
  return d3.rgb(parsed?.toString() ?? fallback);
}

function getRelativeLuminance(color: d3.RGBColor): number {
  const normalize = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  };

  return (
    0.2126 * normalize(color.r) +
    0.7152 * normalize(color.g) +
    0.0722 * normalize(color.b)
  );
}

function lightenColor(color: string, amount = 0.2): string {
  const parsed = d3.color(color);
  if (!parsed) {
    return color;
  }
  const interpolator = d3.interpolateRgb(parsed, "#ffffff");
  return interpolator(Math.min(1, Math.max(0, amount)));
}

function darkenColor(color: string, amount = 0.2): string {
  const parsed = d3.color(color);
  if (!parsed) {
    return color;
  }
  const interpolator = d3.interpolateRgb(parsed, "#000000");
  return interpolator(Math.min(1, Math.max(0, amount)));
}

function expandPalette(
  basePalette: string[],
  mainColor: string,
  length: number
): string[] {
  if (length <= basePalette.length) {
    return basePalette.slice(0, length);
  }

  const palette = [...basePalette];
  const modifiers = [0.15, -0.15, 0.3, -0.3, 0.45, -0.45, 0.6, -0.6];
  let index = 0;

  while (palette.length < length) {
    const modifier = modifiers[index % modifiers.length];
    const intensity = Math.min(0.85, Math.abs(modifier));
    const color =
      modifier >= 0
        ? lightenColor(mainColor, intensity)
        : darkenColor(mainColor, intensity);
    palette.push(color);
    index++;
  }

  return palette.slice(0, length);
}

function resolveTheme(theme?: ItemThemeConfig): ThemeContext {
  const backgroundColor = theme?.itemsBackground || "#ffffff";
  const backgroundRgb = toRgb(backgroundColor);
  const luminance = getRelativeLuminance(backgroundRgb);
  const axisTextColor = luminance < 0.45 ? "#f8fafc" : "#1f2937";
  const axisLineReference =
    luminance < 0.45
      ? lightenColor(backgroundColor, 0.25)
      : darkenColor(backgroundColor, 0.15);
  const axisLineColor = d3.color(axisLineReference)?.formatHex() ?? "#d1d5db";

  const t: any = theme || {};
  const paletteFromTheme = (t.colors ?? []).filter(Boolean) as string[];
  const mainColor = t.mainColor || paletteFromTheme[0] || "#6366f1";

  const fontFamily =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

  const barRounding = Math.max(2, Math.min(16, t.itemSpecific?.rounding ?? 8));
  const paddingSetting = t.itemSpecific?.padding;
  const barPadding =
    typeof paddingSetting === "number"
      ? Math.max(0.05, Math.min(0.35, paddingSetting / 100))
      : 0.18;

  const hoverShadowBase = d3.rgb(darkenColor(mainColor, 0.55));
  const selectedShadowBase = d3.rgb(mainColor);
  const hoverShadow = `rgba(${hoverShadowBase.r}, ${hoverShadowBase.g}, ${
    hoverShadowBase.b
  }, ${luminance < 0.45 ? 0.55 : 0.25})`;
  const selectedShadow = `rgba(${selectedShadowBase.r}, ${
    selectedShadowBase.g
  }, ${selectedShadowBase.b}, ${luminance < 0.45 ? 0.55 : 0.35})`;

  const tooltipBaseColor =
    t.tooltip?.background ||
    (luminance < 0.45
      ? lightenColor(backgroundColor, 0.18)
      : darkenColor(backgroundColor, 0.35));
  const tooltipColorRgb = toRgb(tooltipBaseColor);
  const tooltipBackground = `rgba(${tooltipColorRgb.r}, ${tooltipColorRgb.g}, ${tooltipColorRgb.b}, 0.70)`;
  const tooltipColor = luminance < 0.45 ? "#0f172a" : "#f8fafc";

  const controlBase =
    luminance < 0.45
      ? lightenColor(backgroundColor, 0.22)
      : darkenColor(backgroundColor, 0.08);
  const controlBackground = controlBase;
  const controlBorder =
    luminance < 0.45
      ? lightenColor(controlBase, 0.12)
      : darkenColor(controlBase, 0.12);
  const controlHoverBackground =
    luminance < 0.45
      ? lightenColor(controlBase, 0.18)
      : darkenColor(controlBase, 0.18);
  const controlText = axisTextColor;

  return {
    backgroundColor,
    axisTextColor,
    axisLineColor,
    fontFamily,
    basePalette: paletteFromTheme,
    mainColor,
    barRounding,
    barPadding,
    hoverShadow,
    selectedShadow,
    tooltipBackground,
    tooltipColor,
    controlBackground,
    controlBorder,
    controlText,
    controlHoverBackground,
  };
}

/**
 * Helper function to send custom events to the parent window
 * @param eventType Type of event
 * @param data Data to send with the event
 *
 * NOTE: This is a helper method for internal use. You can implement your own event handling
 * directly in the render/resize methods if needed.
 */
function sendCustomEvent(data: any): void {
  const eventData: CustomEventData = {
    type: "customEvent",
    data,
  };

  // Post message to parent window
  window.parent.postMessage(eventData, "*");
}

/**
 * Helper function to send filter events to the parent window
 * @param filters Array of filters or array of filter groups (for OR logic)
 *
 * NOTE: This is a helper method for internal use. You can implement your own filter handling
 * directly in the render/resize methods if needed.
 */
function sendFilterEvent(filters: ItemFilter[] | ItemFilter[][]): void {
  let filterData: ItemFilter[];

  // Handle OR groups: if we have multiple groups, create an OR filter
  if (filters.length > 0 && Array.isArray(filters[0])) {
    const groups = filters as ItemFilter[][];
    if (groups.length === 1) {
      filterData = groups[0];
    } else {
      // Create OR groups using the ItemFilterGroup structure
      filterData = groups.map((group) => ({
        or: group,
      })) as any;
    }
  } else {
    filterData = filters as ItemFilter[];
  }

  console.log("filterData", filterData);

  const eventData: FilterEventData = {
    type: "setFilter",
    filters: filterData,
  };

  // Post message to parent window
  window.parent.postMessage(eventData, "*");
}

// Define parameter types for render and resize functions
interface ChartParams {
  container: HTMLElement;
  data: ItemData["data"];
  slots: Slot[];
  slotConfigurations: SlotConfig[];
  options: Record<string, any> & { theme?: ItemThemeConfig };
  language: string;
  dimensions: { width: number; height: number };
}

/**
 * Calculate the height needed for the legend based on number of items and available width
 * @param groups Array of group names
 * @param totalWidth Total width available for the chart
 * @returns Height needed for the legend
 */
function isDatetimeAxis(axisSlot?: Slot): boolean {
  return (axisSlot?.content?.[0]?.type ?? "") === "datetime";
}

/**
 * Main render function for the column chart
 * @param params Chart rendering parameters
 */
export const render = ({
  container,
  data = [],
  slots = [],
  slotConfigurations = [],
  options = {},
  language = "en",
  dimensions: { width, height } = { width: 0, height: 0 },
}: ChartParams): void => {
  const themeContext = resolveTheme(options.theme);
  (container as any).__themeContext = themeContext;
  (container as any).__lastParams = {
    data,
    slots,
    slotConfigurations,
    options,
    language,
    dimensions: { width, height },
  };

  // Store slots in chart state
  chartState.facetSlot = slots.find((s) => s.name === "category");
  chartState.axisSlot = slots.find((s) => s.name === "time");
  chartState.measureSlot = slots.find((s) => s.name === "measure");

  const defaultType = isDatetimeAxis(chartState.axisSlot) ? "line" : "column";
  chartState.chartType = chartState.chartType || defaultType;

  const measureFormatterFn = chartState.measureSlot?.content?.[0]
    ? formatter(chartState.measureSlot.content[0])
    : (value: number) => new Intl.NumberFormat(language).format(value);

  const hasFacet = !!chartState.facetSlot?.content?.length;
  const hasAxis = !!chartState.axisSlot?.content?.length;
  const hasMeasure = !!chartState.measureSlot?.content?.length;
  const hasSlots = hasFacet && hasAxis && hasMeasure;

  const chartContainer = setupContainer(container, themeContext);
  setupControls(chartContainer, themeContext, defaultType, hasSlots, (type) => {
    chartState.chartType = type;
    chartState.selectedAxisValues.clear();
    chartState.selectedFacet = undefined;
    chartState.selectionByFacet = new Map();
    sendFilterEvent([]);
    const last = (container as any).__lastParams as ChartParams;
    render({ ...last, container });
  });

  let chartData: ChartDataItem[] = [];
  if (!data.length || !hasFacet || !hasAxis || !hasMeasure) {
    const facets = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"];
    const axisValues = isDatetimeAxis(chartState.axisSlot)
      ? Array.from({ length: 12 }, (_, i) => {
          const d = new Date();
          d.setMonth(d.getMonth() - (11 - i));
          return d;
        })
      : ["A", "B", "C", "D", "E", "F", "G", "H"];
    const sample: ChartDataItem[] = [];
    facets.forEach((f) => {
      axisValues.forEach((a, idx) => {
        const base = Math.abs(Math.sin(idx / 2 + Math.random() * 0.3)) * 100;
        const val = Math.round(base + Math.random() * 40);
        sample.push({
          facet: f,
          axis: a,
          axisRaw: a,
          valueFormatted: measureFormatterFn(val),
          valueRaw: val,
        });
      });
    });
    chartData = sample;
  } else {
    chartData = preProcessData(
      data,
      chartState.measureSlot!,
      chartState.facetSlot!,
      chartState.axisSlot!,
      measureFormatterFn
    );
  }

  (container as any).__chartData = chartData;

  renderSmallMultiples({
    chartContainer,
    data: chartData,
    width,
    height,
    theme: themeContext,
    measureFormatter: measureFormatterFn,
    axisIsDatetime: isDatetimeAxis(chartState.axisSlot),
    chartType: chartState.chartType,
    language,
  });
};

/**
 * Resize handler
 * @param params Chart resize parameters
 */
export const resize = ({
  container,
  slots = [],
  slotConfigurations = [],
  options = {},
  language = "en",
  dimensions: { width, height } = { width: 0, height: 0 },
}: ChartParams): void => {
  // Get the existing state
  const chartData = (container as any).__chartData || [];
  const previousThemeContext = (container as any).__themeContext as
    | ThemeContext
    | undefined;
  const themeContext = options.theme
    ? resolveTheme(options.theme)
    : previousThemeContext ?? resolveTheme(undefined);
  (container as any).__themeContext = themeContext;
  const measureFormatterFn = chartState.measureSlot?.content?.[0]
    ? formatter(chartState.measureSlot.content[0])
    : (value: number) => new Intl.NumberFormat(language).format(value);
  const hasFacet = !!chartState.facetSlot?.content?.length;
  const hasAxis = !!chartState.axisSlot?.content?.length;
  const hasMeasure = !!chartState.measureSlot?.content?.length;
  const hasSlots = hasFacet && hasAxis && hasMeasure;
  const chartContainer = setupContainer(container, themeContext);
  setupControls(chartContainer, themeContext, chartState.chartType, hasSlots, (type) => {
    chartState.chartType = type;
    chartState.selectedAxisValues.clear();
    chartState.selectedFacet = undefined;
    chartState.selectionByFacet = new Map();
    sendFilterEvent([]);
    const last = (container as any).__lastParams as ChartParams;
    render({ ...last, container });
  });

  renderSmallMultiples({
    chartContainer,
    data: chartData,
    width,
    height,
    theme: themeContext,
    measureFormatter: measureFormatterFn,
    axisIsDatetime: isDatetimeAxis(chartState.axisSlot),
    chartType: chartState.chartType,
    language,
  });

  // Maintain state for future resizes
  (container as any).__chartData = chartData;
};

/**
 * Build query for data retrieval
 * NOTE: This method is OPTIONAL to implement. If not implemented, Luzmo will automatically build a query based on the slot configurations. For more advanced use cases, you can implement this method to build a custom query (e.g. if you need your query to return row-level data instead of aggregated data, or if you want to implement ordering or pagination in your chart).
 *
 * See the README.md file for more information on how to implement this method and expected query structure.
 *
 * @param params Object containing slots with their contents and slot configurations.
 * @returns Query object for data retrieval
 */
export const buildQuery = ({
  slots = [],
  slotConfigurations = [],
}: {
  slots: Slot[];
  slotConfigurations: SlotConfig[];
}): ItemQuery => {
  const facetSlot = slots.find((s) => s.name === "category");
  const axisSlot = slots.find((s) => s.name === "time");
  const measureSlot = slots.find((s) => s.name === "measure");

  const dimensions: ItemQueryDimension[] = [];
  const measures: ItemQueryMeasure[] = [];

  const facet = facetSlot?.content?.[0];
  const axis = axisSlot?.content?.[0];
  const measure = measureSlot?.content?.[0];

  if (facet) {
    dimensions.push({
      dataset_id: facet.datasetId || facet.set,
      column_id: facet.columnId || facet.column,
      level: facet.level || 1,
    });
  }
  if (axis) {
    dimensions.push({
      dataset_id: axis.datasetId || axis.set,
      column_id: axis.columnId || axis.column,
      level: axis.level || 1,
    });
  }
  if (measure) {
    if (
      measure.aggregationFunc &&
      ["sum", "average", "min", "max", "count"].includes(
        measure.aggregationFunc
      )
    ) {
      measures.push({
        dataset_id: measure.datasetId || measure.set,
        column_id: measure.columnId || measure.column,
        aggregation: { type: measure.aggregationFunc },
      });
    } else {
      measures.push({
        dataset_id: measure.datasetId || measure.set,
        column_id: measure.columnId || measure.column,
      });
    }
  }

  const order: any[] = [];
  if (facet) {
    order.push({
      dataset_id: facet.datasetId || facet.set,
      column_id: facet.columnId || facet.column,
      order: "asc",
    });
  }
  if (axis) {
    order.push({
      dataset_id: axis.datasetId || axis.set,
      column_id: axis.columnId || axis.column,
      order: "asc",
    });
  }

  return {
    dimensions,
    measures,
    order,
    limit: { by: 10000, offset: 0 },
  } as ItemQuery;
};

/**
 * Helper function to render chart with given data and dimensions
 *
 * NOTE: This is a helper method for internal use. You can implement your own chart rendering
 * logic directly in the render/resize methods if needed.
 */
function renderSmallMultiples({
  chartContainer,
  data,
  width,
  height,
  theme,
  measureFormatter,
  axisIsDatetime,
  chartType,
  language,
}: {
  chartContainer: HTMLElement;
  data: ChartDataItem[];
  width: number;
  height: number;
  theme: ThemeContext;
  measureFormatter: (value: number) => string;
  axisIsDatetime: boolean;
  chartType: ChartState["chartType"];
  language: string;
}): void {
  // Set explicit dimensions on chartContainer to constrain it to available space
  chartContainer.style.width = `${width}px`;
  chartContainer.style.height = `${height}px`;
  chartContainer.style.position = "relative";
  chartContainer.style.overflow = "hidden"; // Will be updated below if scrolling is needed

  const padding = { top: 10, right: 24, bottom: 40, left: 24 }; // Reduced top padding to maximize chart space
  const innerW = Math.max(0, width - padding.left - padding.right);
  const innerH = Math.max(0, height - padding.top - padding.bottom);

  const tooltipLayer = d3
    .select(chartContainer)
    .append("div")
    .style("position", "absolute")
    .style("inset", "0 0 0 0")
    .style("pointer-events", "none");

  const facets = Array.from(new Set(data.map((d) => d.facet))).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );
  const minCellW = 200;
  const minCellH = 180;
  const cols = Math.max(
    1,
    Math.min(facets.length, Math.floor(innerW / minCellW))
  );
  const rows = Math.ceil(facets.length / cols);

  // Calculate actual cell dimensions based on minimums
  // Ensure cells don't stretch too tall - reserve extra space at bottom for axis visibility
  // Each cell needs margin.bottom (22px) + space for axis labels (~18px) = ~40px at bottom
  const reservedBottomSpace = 40; // Reserve space at bottom for axes
  const availableHeight = Math.max(0, innerH - reservedBottomSpace);
  const cellW = Math.max(minCellW, innerW / cols);
  const cellH = Math.max(minCellH, availableHeight / Math.max(1, rows));

  // Calculate required dimensions for all cells
  const requiredWidth = cols * cellW + padding.left + padding.right;
  const requiredHeight = rows * cellH + padding.top + padding.bottom;
  
  // Determine if scrolling is needed
  const needsHorizontalScroll = requiredWidth > width;
  const needsVerticalScroll = requiredHeight > height;
  
  // Adjust SVG dimensions if scrolling is needed
  const svgWidth = needsHorizontalScroll ? requiredWidth : width;
  const svgHeight = needsVerticalScroll ? requiredHeight : height;

  // Create SVG with calculated dimensions
  const svg: d3.Selection<SVGSVGElement, unknown, null, undefined> = d3
    .select(chartContainer)
    .append("svg")
    .attr("width", svgWidth)
    .attr("height", svgHeight)
    .attr("class", "sm-svg")
    .style("display", "block")
    .style("width", `${svgWidth}px`)
    .style("height", `${svgHeight}px`)
    .style("min-width", `${svgWidth}px`)
    .style("min-height", `${svgHeight}px`); // Ensure SVG maintains its size even when larger than container

  if (theme.fontFamily) {
    svg.style("font-family", theme.fontFamily);
  }

  // Update container overflow for scrolling if needed
  if (needsHorizontalScroll || needsVerticalScroll) {
    chartContainer.style.overflow = "auto";
    chartContainer.style.overflowX = needsHorizontalScroll ? "auto" : "hidden";
    chartContainer.style.overflowY = needsVerticalScroll ? "auto" : "hidden";
  } else {
    chartContainer.style.overflow = "hidden";
  }

  const color = theme.mainColor || theme.basePalette[0] || "#6366f1";
  const grid = svg
    .append("g")
    .attr("transform", `translate(${padding.left},${padding.top})`);

  const cellInfoByFacet = new Map<
    string,
    {
      row: number;
      col: number;
      margin: { top: number; right: number; bottom: number; left: number };
      w: number;
      h: number;
      xScale: any;
      yScale: d3.ScaleLinear<number, number>;
    }
  >();

  // Utility: compute a normalized axis key for cross-cell matching
  const toAxisKey = (v: string | Date): string =>
    v instanceof Date ? String(v.getTime()) : String(v);

  // Utility: update global bar selection highlight styles
  const updateSelectionStyles = () => {
    const hasSelection =
      chartState.selectionByFacet && chartState.selectionByFacet.size > 0;
    d3.select(chartContainer)
      .selectAll<SVGRectElement, unknown>("rect.bar")
      .classed("bar-selected", function () {
        const key = this.getAttribute("data-axis-key");
        const facet = this.getAttribute("data-facet");
        if (!facet || !key) return false;
        const facetSelection = chartState.selectionByFacet?.get(facet);
        return facetSelection ? facetSelection.has(String(key)) : false;
      })
      .classed("bar-dimmed", function () {
        const key = this.getAttribute("data-axis-key");
        const facet = this.getAttribute("data-facet");
        if (!hasSelection || !facet || !key) return false;
        const facetSelection = chartState.selectionByFacet?.get(facet);
        return facetSelection ? !facetSelection.has(String(key)) : true;
      });
    // Dim non-highlighted points too
    d3.select(chartContainer)
      .selectAll<SVGCircleElement, unknown>("circle.point")
      .classed("bar-dimmed", function () {
        if (!hasSelection) return false;
        const key = (this as any).getAttribute("data-axis-key");
        const facet = (this as any).getAttribute("data-facet");
        if (!facet || !key) return false;
        const facetSelection = chartState.selectionByFacet?.get(facet);
        return facetSelection ? !facetSelection.has(String(key)) : true;
      });
  };

  const ensureFacetTooltip = (facet: string) => {
    let el = tooltipLayer.select<HTMLDivElement>(
      `.tooltip[data-facet="${facet}"]`
    );
    if (!el.empty()) return el;
    return tooltipLayer
      .append("div")
      .attr("class", "tooltip")
      .attr("data-facet", facet)
      .style("opacity", 0)
      .style("position", "absolute")
      .style("background-color", theme.tooltipBackground)
      .style("color", theme.tooltipColor)
      .style("box-shadow", `0 12px 24px ${theme.hoverShadow}`)
      .style("padding", "8px 12px")
      .style("font-size", "11px")
      .style("min-width", "140px");
  };

  const showSyncedTooltip = (
    event: MouseEvent,
    axisValue: string | Date,
    hoveredFacet?: string,
    cursorY?: number
  ) => {
    const key = toAxisKey(axisValue);
    const axisContent = chartState.axisSlot?.content?.[0];
    const facetContent = chartState.facetSlot?.content?.[0];
    const measureContent = chartState.measureSlot?.content?.[0];
    const axisFormatterFn = axisContent
      ? formatter(axisContent, { level: (axisContent as any).level || 9 })
      : (v: any) => String(v);
    const facetFormatterFn = facetContent
      ? formatter(facetContent, { level: (facetContent as any).level || 9 })
      : (v: any) => String(v);

    // Clear all previous hover highlights and value labels before adding new ones
    d3.select(chartContainer)
      .selectAll(".hover-highlight")
      .classed("hover-highlight", false);

    // Remove all old value labels
    tooltipLayer.selectAll(".value-label").remove();

    const matchedSelection = d3
      .select(chartContainer)
      .selectAll(`[data-axis-key="${key}"]`)
      .classed("hover-highlight", true);
    // Emphasize all matching points/bars across facets
    matchedSelection
      .filter<SVGCircleElement>("circle.point")
      .attr("r", 6 as any)
      .attr("stroke", theme.backgroundColor)
      .attr("stroke-width", 2 as any)
      .each(function () {
        (this as any).parentNode?.appendChild(this as any);
      });
    matchedSelection
      .filter<SVGRectElement>("rect.bar")
      .attr("stroke", theme.mainColor)
      .attr("stroke-width", 3 as any)
      .classed("hover-highlight", true)
      .each(function () {
        (this as any).parentNode?.appendChild(this as any);
      });

    // Dim all other bars/points not matching, but preserve selection state
    d3.select(chartContainer)
      .selectAll<SVGRectElement, unknown>("rect.bar")
      .filter(function () {
        const isHighlighted = d3.select(this).classed("hover-highlight");
        const isSelected = d3.select(this).classed("bar-selected");
        return !isHighlighted && !isSelected;
      })
      .classed("bar-hover-dimmed", true);

    // For line/area charts: hide all non-highlighted points
    d3.select(chartContainer)
      .selectAll<SVGCircleElement, unknown>("circle.point")
      .classed("point-hidden", function () {
        return !d3.select(this).classed("hover-highlight");
      })
      .classed("point-visible", function () {
        return d3.select(this).classed("hover-highlight");
      });

    // Dim lines and areas not matching the hovered facet
    d3.select(chartContainer)
      .selectAll<SVGPathElement, unknown>("path.line-path, path.line-area")
      .classed("line-dimmed", function () {
        const facet = this.getAttribute("data-facet");
        return facet !== hoveredFacet;
      });

    // Add darker border to selected bars that are also hovered
    matchedSelection
      .filter<SVGRectElement>("rect.bar")
      .filter(function () {
        return d3.select(this).classed("bar-selected");
      })
      .attr("stroke", darkenColor(theme.mainColor, 0.3))
      .attr("stroke-width", 4 as any);

    // Only show full tooltip for the hovered facet
    // For other facets, show simple value labels on/near the bars
    facets.forEach((f) => {
      const info = cellInfoByFacet.get(f);
      const value = data.find(
        (d) =>
          d.facet === f &&
          (d.axis instanceof Date
            ? String(d.axis.getTime())
            : String(d.axis)) === key
      );
      if (!info || !value) {
        return;
      }

      const isHovered = hoveredFacet === f;

      if (isHovered) {
        // Show full tooltip only for the hovered facet
        const tt = ensureFacetTooltip(f);
        const axisLabel = axisIsDatetime
          ? axisFormatterFn(value.axis as Date)
          : String(value.axis);
        const facetLabel = facetFormatterFn(f);
        const axisLabelTitle =
          chartState.axisSlot?.content?.[0]?.label?.[language] || "Axis";
        const facetLabelTitle =
          chartState.facetSlot?.content?.[0]?.label?.[language] || "Facet";
        const measureLabelTitle =
          chartState.measureSlot?.content?.[0]?.label?.[language] || "Measure";

        tt.interrupt()
          .style("opacity", 1)
          .html(
            `
            <div class="tooltip-title">${facetLabel}</div>
            <div class="tooltip-row"><span>${axisLabelTitle}</span><span>${axisLabel}</span></div>
            <div class="tooltip-row"><span>${measureLabelTitle}</span><span>${value.valueFormatted}</span></div>
          `
          )
          .style("z-index", "1001")
          .style("box-shadow", `0 16px 32px ${theme.hoverShadow}`)
          .style("padding", "8px 12px")
          .style("font-size", "11px")
          .style("min-width", "140px");

        const baseLeft = padding.left + info.col * cellW + info.margin.left;
        const baseTop = padding.top + info.row * cellH + info.margin.top;
        let cx = 0;
        const xs: any = info.xScale;
        if (typeof xs.bandwidth === "function") {
          const kk =
            value.axis instanceof Date
              ? String(value.axis.getTime())
              : String(value.axis);
          const vx = xs(String(kk)) ?? 0;
          cx = vx + xs.bandwidth() / 2;
        } else {
          const vx = xs(
            axisIsDatetime ? (value.axis as Date) : String(value.axis)
          );
          cx = Number.isFinite(vx) ? vx : 0;
        }
        const cy = info.yScale(value.valueRaw);
        const tooltipNode = tt.node() as HTMLDivElement;

        // Use cursor Y position for tooltip placement
        let displayY = typeof cursorY === "number" ? cursorY : cy;

        // Determine horizontal position (always at data point X)
        const isRightHalf = cx > info.w / 2;

        // Add more spacing to ensure tooltip doesn't cover data point
        const horizontalOffset = 16;

        // Provisional position to measure size
        let left =
          baseLeft + cx + (isRightHalf ? -horizontalOffset : horizontalOffset);
        let top = baseTop + displayY;
        tt.style("left", `${left}px`).style("top", `${Math.max(0, top)}px`);
        const { width: ttW, height: ttH } = tooltipNode.getBoundingClientRect();

        // Center tooltip vertically around the display position
        top = baseTop + displayY - ttH / 2;

        // Switch sides if overflowing right
        const layerRect = (
          tooltipLayer.node() as HTMLDivElement
        ).getBoundingClientRect();
        const maxLeft = layerRect.width - ttW - 8;
        const minLeft = 8;

        if (!isRightHalf && left + ttW > maxLeft) {
          // Switch to left side
          left = baseLeft + cx - ttW - horizontalOffset;
        } else if (isRightHalf && left < minLeft) {
          // Switch to right side
          left = baseLeft + cx + horizontalOffset;
        }

        // Final clamp
        left = Math.max(minLeft, Math.min(maxLeft, left));

        // Clamp within layer vertically
        const maxTop = layerRect.height - ttH - 8;
        const minTop = 8;
        top = Math.max(minTop, Math.min(maxTop, top));

        tt.style("left", `${left}px`).style("top", `${top}px`).raise();

        // Emphasize points in hovered facet
        d3.select(chartContainer)
          .selectAll<SVGCircleElement, unknown>(
            `circle.point[data-facet="${hoveredFacet}"][data-axis-key="${key}"]`
          )
          .attr("r", 6 as any)
          .attr("stroke", theme.backgroundColor)
          .attr("stroke-width", 2 as any)
          .each(function () {
            (this as any).parentNode?.appendChild(this as any);
          });

        // Also show value label for hovered facet (above the data point)
        // let valueLabel = tooltipLayer.select<HTMLDivElement>(
        //   `.value-label[data-facet="${f}"][data-axis-key="${key}"]`
        // );

        // if (valueLabel.empty()) {
        //   valueLabel = tooltipLayer
        //     .append("div")
        //     .attr("class", "value-label")
        //     .attr("data-facet", f)
        //     .attr("data-axis-key", key);
        // }

        // // Position the label above the data point
        // const barHeight =
        //   chartType === "column" ? Math.abs(cy - info.yScale(0)) : 0;
        // const isSmallBar = barHeight < 30;

        // let labelY = cy;
        // if (chartType === "column" && !isSmallBar) {
        //   // Show inside the bar
        //   labelY = value.valueRaw >= 0 ? cy + 18 : cy - 8;
        // } else {
        //   // Show above the bar/point - position closer to the top
        //   // For bars: cy is the top, so position label bottom just above it
        //   // For points: cy is center, so position label bottom above point (radius ~3-6px)
        //   if (chartType === "column") {
        //     // Bar chart: cy is top of bar, position label bottom 4px above
        //     labelY = cy + 4;
        //   } else {
        //     // Line/area chart: cy is center of point, position label bottom above point
        //     labelY = cy + 10;
        //   }
        // }

        // valueLabel
        //   .style("opacity", 1)
        //   .style("position", "absolute")
        //   .style("left", `${baseLeft + cx}px`)
        //   .style("top", `${baseTop + labelY}px`)
        //   .style("transform", "translate(-50%, 50%)")
        //   .style("background-color", "rgba(0, 0, 0, 0.75)")
        //   .style("color", "#fff")
        //   .style("padding", "4px 8px")
        //   .style("border-radius", "4px")
        //   .style("font-size", "11px")
        //   .style("font-weight", "600")
        //   .style("white-space", "nowrap")
        //   .style("pointer-events", "none")
        //   .style("z-index", "400")
        //   .text(value.valueFormatted);
      } else {
        // For non-hovered facets, show simple value label
        const baseLeft = padding.left + info.col * cellW + info.margin.left;
        const baseTop = padding.top + info.row * cellH + info.margin.top;
        let cx = 0;
        const xs: any = info.xScale;
        if (typeof xs.bandwidth === "function") {
          const kk =
            value.axis instanceof Date
              ? String(value.axis.getTime())
              : String(value.axis);
          const vx = xs(String(kk)) ?? 0;
          cx = vx + xs.bandwidth() / 2;
        } else {
          const vx = xs(
            axisIsDatetime ? (value.axis as Date) : String(value.axis)
          );
          cx = Number.isFinite(vx) ? vx : 0;
        }
        const cy = info.yScale(value.valueRaw);

        // Create or update value label
        let valueLabel = tooltipLayer.select<HTMLDivElement>(
          `.value-label[data-facet="${f}"][data-axis-key="${key}"]`
        );

        if (valueLabel.empty()) {
          valueLabel = tooltipLayer
            .append("div")
            .attr("class", "value-label")
            .attr("data-facet", f)
            .attr("data-axis-key", key);
        }

        // Position the label
        // For bars, check if the bar is small (less than ~30px height)
        const barHeight =
          chartType === "column" ? Math.abs(cy - info.yScale(0)) : 0;
        const isSmallBar = barHeight < 30;

        // If bar is small or for line/area charts, show above; otherwise show inside
        let labelY = cy;
        if (chartType === "column" && !isSmallBar) {
          // Show inside the bar
          labelY = value.valueRaw >= 0 ? cy + 18 : cy - 8;
        } else {
          // Show above the bar/point - position closer to the top
          // For bars: cy is the top, so position label bottom just above it
          // For points: cy is center, so position label bottom above point (radius ~3-6px)
          if (chartType === "column") {
            // Bar chart: cy is top of bar, position label bottom 4px above
            labelY = cy + 4;
          } else {
            // Line/area chart: cy is center of point, position label bottom above point
            labelY = cy + 10;
          }
        }

        valueLabel
          .style("opacity", 1)
          .style("position", "absolute")
          .style("left", `${baseLeft + cx}px`)
          .style("top", `${baseTop + labelY}px`)
          .style("transform", "translate(-50%, 50%)")
          .style("background-color", "rgba(0, 0, 0, 0.75)")
          .style("color", "#fff")
          .style("padding", "4px 8px")
          .style("border-radius", "4px")
          .style("font-size", "11px")
          .style("font-weight", "600")
          .style("white-space", "nowrap")
          .style("pointer-events", "none")
          .style("z-index", "400")
          .text(value.valueFormatted);
      }
    });
  };

  const hideSyncedTooltip = () => {
    tooltipLayer
      .selectAll(".tooltip")
      .transition()
      .duration(120)
      .style("opacity", 0);
    // Remove value labels
    tooltipLayer.selectAll(".value-label").remove();
    d3.select(chartContainer)
      .selectAll(".hover-highlight")
      .classed("hover-highlight", false);
    // Reset emphasis
    const rootSel = d3.select(chartContainer);
    rootSel
      .selectAll<SVGCircleElement, unknown>(".point")
      .attr("r", 3 as any)
      .attr("stroke", null)
      .attr("stroke-width", null as any)
      .classed("point-hidden", false)
      .classed("point-visible", false);
    rootSel
      .selectAll<SVGRectElement, unknown>("rect.bar")
      .attr("stroke", null)
      .attr("stroke-width", null as any)
      .classed("hover-highlight", false)
      .classed("bar-hover-dimmed", false);
    // Remove line/area dimming
    rootSel
      .selectAll<SVGPathElement, unknown>("path.line-path, path.line-area")
      .classed("line-dimmed", false);
  };

  const xDomainsByFacet = new Map<string, any[]>();
  const yMaxByFacet = new Map<string, number>();
  const yMinByFacet = new Map<string, number>();

  facets.forEach((f) => {
    const series = data.filter((d) => d.facet === f);
    const xDomain = axisIsDatetime
      ? Array.from(new Set(series.map((d) => (d.axis as Date).getTime())))
          .sort((a, b) => a - b)
          .map((ms) => new Date(ms))
      : Array.from(new Set(series.map((d) => String(d.axis))));
    xDomainsByFacet.set(f, xDomain);
    yMaxByFacet.set(f, d3.max(series, (d) => d.valueRaw) || 0);
    yMinByFacet.set(f, d3.min(series, (d) => d.valueRaw) || 0);
  });

  const drawCell = (facet: string, i: number) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const g = grid
      .append("g")
      .attr("transform", `translate(${c * cellW}, ${r * cellH})`);

    const margin = { top: 18, right: 10, bottom: 22, left: 40 };
    const w = cellW - margin.left - margin.right;
    const h = cellH - margin.top - margin.bottom;

    const series = data.filter((d) => d.facet === facet);
    const xDomain = xDomainsByFacet.get(facet) || [];
    const yMax = yMaxByFacet.get(facet) || 0;
    const yMin = yMinByFacet.get(facet) || 0;

    let x = axisIsDatetime
      ? d3
          .scaleUtc()
          .domain(d3.extent(xDomain as Date[]) as [Date, Date])
          .range([0, w])
      : d3
          .scaleBand<string>()
          .domain(xDomain as string[])
          .range([0, w])
          .padding(0.2);
    let xBandTime: d3.ScaleBand<string> | undefined;
    if (chartType === "column" && axisIsDatetime) {
      const dateKeys = (xDomain as Date[]).map((d) => String(d.getTime()));
      xBandTime = d3
        .scaleBand<string>()
        .domain(dateKeys)
        .range([0, w])
        .padding(0.2);
    }

    // Calculate domain bounds with padding
    let domainMin = yMin < 0 ? yMin * 1.15 : 0;
    let domainMax = yMax > 0 ? yMax * 1.15 : 0;

    // Handle edge cases
    if (yMin === 0 && yMax === 0) {
      domainMax = 1;
    } else if (yMin === yMax) {
      if (yMin > 0) {
        domainMin = 0;
        domainMax = yMax * 1.15;
      } else if (yMin < 0) {
        domainMin = yMin * 1.15;
        domainMax = 0;
      }
    }

    const y = d3
      .scaleLinear()
      .domain([domainMin, domainMax])
      .nice()
      .range([h, 0]);

    const cell = g
      .append("g")
      .attr("transform", `translate(${margin.left}, ${margin.top})`);

    // Title - include column label from the column dropped on the facet slot
    const columnLabel =
      chartState.facetSlot?.content?.[0]?.label?.[language] ||
      chartState.facetSlot?.content?.[0]?.label ||
      "Facet";
    const titleText = `${columnLabel}: ${facet}`;
    g.append("text")
      .attr("x", 40)
      .attr("y", 14)
      .style("font-weight", 600)
      .style("font-size", "12px")
      .style("fill", theme.axisTextColor)
      .text(titleText);

    // Axes
    const xAxisG = cell
      .append("g")
      .attr("class", "axis x-axis")
      .attr("transform", `translate(0,${h})`);

    if (chartType === "column" && axisIsDatetime && xBandTime) {
      const axisContent = chartState.axisSlot?.content?.[0];
      const axisFormatterFn = axisContent
        ? formatter(axisContent, { level: (axisContent as any).level || 9 })
        : (v: any) => String(v);

      // For datetime column charts, show axis using the same scale as bars
      const axis = d3
        .axisBottom(xBandTime)
        .tickSizeOuter(0)
        .tickFormat((d: any) => axisFormatterFn(new Date(Number(String(d)))));

      (xAxisG as any).call(axis);

      // Intelligently sample ticks to prevent overlap while maximizing detail
      const dom = xDomain as Date[];
      const allTicks = xAxisG.selectAll<SVGGElement, string>(".tick");
      const tickNodes = allTicks.nodes();

      if (tickNodes.length > 2) {
        const minSpacing = 50; // Minimum pixels between tick labels
        const tickPositions: Array<{
          index: number;
          position: number;
          width: number;
        }> = [];

        tickNodes.forEach((node, i) => {
          const transform = node.getAttribute("transform");
          const match = transform?.match(/translate\(([^,]+),/);
          const xPos = match ? parseFloat(match[1]) : 0;
          const textNode = node.querySelector("text");
          const bbox = textNode?.getBBox();
          tickPositions.push({
            index: i,
            position: xPos,
            width: bbox?.width || 40,
          });
        });

        // Always keep first and last
        const keptIndices = new Set<number>();
        keptIndices.add(0);
        keptIndices.add(tickPositions.length - 1);

        // Greedily add ticks that don't overlap
        let lastKeptPosition = tickPositions[0].position;
        for (let i = 1; i < tickPositions.length - 1; i++) {
          const tick = tickPositions[i];
          if (tick.position - lastKeptPosition >= minSpacing) {
            keptIndices.add(i);
            lastKeptPosition = tick.position;
          }
        }

        // Remove ticks that aren't kept
        allTicks.each(function (_d, i) {
          if (!keptIndices.has(i)) {
            d3.select(this).remove();
          }
        });
      }
    } else if (axisIsDatetime) {
      // For continuous datetime axes (line/area), use dynamic tick count and formatting
      const minSpacing = 55; // Target spacing between ticks
      const maxTicks = Math.max(4, Math.floor(w / minSpacing));
      const timeScale = x as d3.ScaleTime<number, number>;
      const axisContent = chartState.axisSlot?.content?.[0];
      const axisFormatterFn = axisContent
        ? formatter(axisContent, { level: (axisContent as any).level || 9 })
        : undefined;

      const axis = d3.axisBottom(timeScale).ticks(maxTicks).tickSizeOuter(0);

      // Use custom formatter if available
      if (axisFormatterFn) {
        axis.tickFormat((d: any) => axisFormatterFn(d as Date));
      }

      (xAxisG as any).call(axis);

      // Ensure first and last values are shown if not already present
      const domain = timeScale.domain();
      const allTicks = xAxisG.selectAll<SVGGElement, Date>(".tick");
      const tickDates = allTicks.data().map((d) => d.getTime());

      const threshold = (domain[1].getTime() - domain[0].getTime()) * 0.02; // 2% threshold
      const hasFirst = tickDates.some(
        (t) => Math.abs(t - domain[0].getTime()) < threshold
      );
      const hasLast = tickDates.some(
        (t) => Math.abs(t - domain[1].getTime()) < threshold
      );

      // Add first tick if missing and there's space
      if (!hasFirst && w > 120) {
        const firstPos = timeScale(domain[0]);
        // Check if there's enough space (at least 45px from next tick)
        const hasNearbyTick = allTicks.nodes().some((node) => {
          const transform = node.getAttribute("transform");
          const match = transform?.match(/translate\(([^,]+),/);
          const xPos = match ? parseFloat(match[1]) : 0;
          return Math.abs(xPos - firstPos) < 45;
        });

        if (!hasNearbyTick) {
          const firstTick = xAxisG
            .insert("g", ":first-child")
            .attr("class", "tick")
            .attr("opacity", 1)
            .attr("transform", `translate(${firstPos},0)`);
          firstTick
            .append("line")
            .attr("y2", 6)
            .attr("stroke", theme.axisLineColor);
          firstTick
            .append("text")
            .attr("y", 9)
            .attr("dy", "0.71em")
            .style("fill", theme.axisTextColor)
            .style("font-size", "10px")
            .text(
              axisFormatterFn
                ? axisFormatterFn(domain[0])
                : domain[0].toLocaleDateString()
            );
        }
      }

      // Add last tick if missing and there's space
      if (!hasLast && w > 120) {
        const lastPos = timeScale(domain[1]);
        // Check if there's enough space (at least 45px from previous tick)
        const hasNearbyTick = allTicks.nodes().some((node) => {
          const transform = node.getAttribute("transform");
          const match = transform?.match(/translate\(([^,]+),/);
          const xPos = match ? parseFloat(match[1]) : 0;
          return Math.abs(xPos - lastPos) < 45;
        });

        if (!hasNearbyTick) {
          const lastTick = xAxisG
            .append("g")
            .attr("class", "tick")
            .attr("opacity", 1)
            .attr("transform", `translate(${lastPos},0)`);
          lastTick
            .append("line")
            .attr("y2", 6)
            .attr("stroke", theme.axisLineColor);
          lastTick
            .append("text")
            .attr("y", 9)
            .attr("dy", "0.71em")
            .style("fill", theme.axisTextColor)
            .style("font-size", "10px")
            .text(
              axisFormatterFn
                ? axisFormatterFn(domain[1])
                : domain[1].toLocaleDateString()
            );
        }
      }
    } else {
      (xAxisG as any).call(
        d3.axisBottom(x as d3.ScaleBand<string>).tickSizeOuter(0) as any
      );
    }
    xAxisG
      .selectAll("text")
      .style("fill", theme.axisTextColor)
      .style("font-size", "10px");
    xAxisG.selectAll("line").attr("stroke", theme.axisLineColor);
    xAxisG.selectAll("path").attr("stroke", theme.axisLineColor);

    // Handle potential x-axis label overlap for categorical axes
    if (!axisIsDatetime) {
      const dom = xDomain as string[];
      const bw = (x as d3.ScaleBand<string>).bandwidth();

      // Calculate average label length
      const avgLabelLength =
        dom.reduce((sum, label) => sum + String(label).length, 0) / dom.length;
      const maxLabelLength = Math.max(
        ...dom.map((label) => String(label).length)
      );

      // Determine if labels will need rotation
      const willRotate = bw < 50 || (avgLabelLength > 8 && bw < 80);

      // Adjust spacing calculation based on rotation
      const estimatedLabelWidth = willRotate
        ? maxLabelLength * 4 // Rotated labels need less horizontal space
        : maxLabelLength * 6; // Horizontal labels need more space

      const minSpacing = willRotate ? 40 : 50;
      const maxTicks = Math.max(
        3,
        Math.floor(w / Math.max(estimatedLabelWidth, minSpacing))
      );

      if (dom.length > maxTicks) {
        // Always keep first and last, sample the rest
        const allTicks = xAxisG.selectAll<SVGGElement, unknown>("g.tick");
        const totalTicks = allTicks.size();
        const step = Math.ceil((totalTicks - 2) / (maxTicks - 2));

        const keptIndices = new Set<number>();
        keptIndices.add(0); // First
        keptIndices.add(totalTicks - 1); // Last

        // Add evenly spaced ticks
        for (let i = step; i < totalTicks - 1; i += step) {
          keptIndices.add(i);
        }

        allTicks.each(function (_d, i) {
          if (!keptIndices.has(i)) {
            d3.select(this).remove();
          }
        });
      }

      // Rotate labels if bandwidth is small or labels are moderately long
      if (willRotate) {
        // For short labels, use steeper rotation
        const rotation = maxLabelLength <= 10 ? -45 : -35;
        xAxisG
          .selectAll("text")
          .attr("text-anchor", "end")
          .attr("transform", `rotate(${rotation})`)
          .attr("dx", "-0.5em")
          .attr("dy", "0.15em");
      }
    }

    const yAxisG = cell
      .append("g")
      .attr("class", "axis y-axis")
      .call(
        d3
          .axisLeft(y)
          .ticks(3)
          .tickSize(-w)
          .tickFormat((v) => measureFormatter(Number(v)))
      );
    yAxisG
      .selectAll("text")
      .style("fill", theme.axisTextColor)
      .style("font-size", "10px");
    yAxisG
      .selectAll("line")
      .attr("stroke", theme.axisLineColor)
      .attr("stroke-dasharray", "2,4");
    yAxisG.selectAll("path").attr("stroke", theme.axisLineColor);

    // Render series
    if (chartType === "column") {
      const baseFill = color;
      const band = (axisIsDatetime ? xBandTime : (x as d3.ScaleBand<string>))!;
      cellInfoByFacet.set(facet, {
        row: r,
        col: c,
        margin,
        w,
        h,
        xScale: band,
        yScale: y,
      });
      series.forEach((d) => {
        const key = toAxisKey(d.axis);
        const xPos = band(String(key)) ?? 0;
        const barW = band.bandwidth();

        // For negative values, bar extends downward from zero
        // For positive values, bar extends upward from zero
        const zeroY = y(0);
        const valueY = y(d.valueRaw);
        const yPos = d.valueRaw >= 0 ? valueY : zeroY;
        const hBar = Math.abs(valueY - zeroY);

        const rect = cell
          .append("rect")
          .attr("class", "bar")
          .attr("x", xPos)
          .attr("y", yPos)
          .attr("width", barW)
          .attr("height", hBar)
          .attr("fill", baseFill)
          .attr("rx", 4)
          .attr("ry", 4)
          .style("filter", "none")
          .attr("data-axis-key", toAxisKey(d.axis))
          .attr("data-facet", facet)
          .on("mousemove", function (event: MouseEvent) {
            const [mx, my] = d3.pointer(event, cell.node() as any);
            const hoverFill = lightenColor(baseFill, 0.18);
            d3.select(this as SVGRectElement)
              .raise()
              .attr("fill", hoverFill)
              .style("filter", `drop-shadow(0 10px 18px ${theme.hoverShadow})`);
            showSyncedTooltip(event, d.axis, facet, my);
          })
          .on("mouseout", function () {
            d3.select(this as SVGRectElement)
              .attr("fill", baseFill)
              .style("filter", "none");
            hideSyncedTooltip();
          })
          .on("click", function () {
            const key = toAxisKey(d.axis);
            // Initialize selection map
            if (!chartState.selectionByFacet)
              chartState.selectionByFacet = new Map();
            const set =
              chartState.selectionByFacet.get(facet) || new Set<string>();
            if (set.has(key)) set.delete(key);
            else set.add(key);
            if (set.size > 0) chartState.selectionByFacet.set(facet, set);
            else chartState.selectionByFacet.delete(facet);
            // Backwards-compatible set for highlighting current facet values
            chartState.selectedAxisValues = new Set(set);
            chartState.selectedFacet = chartState.selectedAxisValues.size
              ? facet
              : undefined;
            const clearBtn = d3
              .select(chartContainer)
              .select<HTMLButtonElement>(".clear-filter-btn");
            clearBtn.classed(
              "visible",
              chartState.selectionByFacet &&
                chartState.selectionByFacet.size > 0
            );

            const axisContent = chartState.axisSlot?.content?.[0];
            const facetContent = chartState.facetSlot?.content?.[0];
            if (!axisContent) {
              updateSelectionStyles();
              return;
            }
            // Build OR-of-groups filter: (facet = f AND axis IN vals) OR (...) per selected facet
            const orGroups: ItemFilter[][] = [];
            if (
              chartState.selectionByFacet &&
              chartState.selectionByFacet.size
            ) {
              for (const [
                selFacet,
                vals,
              ] of chartState.selectionByFacet.entries()) {
                if (!vals.size) continue;
                const group: ItemFilter[] = [];
                if (facetContent) {
                  group.push({
                    expression: "? = ?",
                    parameters: [
                      {
                        column_id: facetContent.columnId || facetContent.column,
                        dataset_id: facetContent.datasetId || facetContent.set,
                        level: facetContent.level || undefined,
                      },
                      selFacet,
                    ],
                    properties: { origin: "filterFromVizItem", type: "where" },
                  });
                }
                // Convert values back to proper format for filtering
                const filterValues = Array.from(vals).map((v) => {
                  if (axisIsDatetime) {
                    // Convert timestamp string back to Date and format as RFC3339
                    const date = new Date(Number(v));
                    return date.toISOString();
                  }
                  return v;
                });
                group.push({
                  expression: filterValues.length > 1 ? "? in ?" : "? = ?",
                  parameters: [
                    {
                      column_id: axisContent.columnId || axisContent.column,
                      dataset_id: axisContent.datasetId || axisContent.set,
                      level: axisContent.level || undefined,
                    },
                    filterValues.length > 1 ? filterValues : filterValues[0],
                  ],
                  properties: { origin: "filterFromVizItem", type: "where" },
                });
                orGroups.push(group);
              }
            }
            // Send as OR groups
            if (orGroups.length > 1) {
              sendFilterEvent(orGroups);
            } else if (orGroups.length === 1) {
              sendFilterEvent(orGroups[0]);
            } else {
              sendFilterEvent([]);
            }
            sendCustomEvent({
              facet,
              axis: d.axis,
              value: d.valueFormatted,
              rawValue: d.valueRaw,
            });
            updateSelectionStyles();
          });

        // Animate from zero line
        const animStartY = y(0);
        rect
          .attr("height", 0)
          .attr("y", animStartY)
          .transition()
          .duration(300)
          .attr("y", yPos)
          .attr("height", hBar);
      });
      // Ensure styles reflect any existing selection after rendering bars
      updateSelectionStyles();
    } else {
      const baseStroke = color;
      if (axisIsDatetime) {
        const lineGen = d3
          .line<ChartDataItem>()
          .x((d) => (x as d3.ScaleTime<number, number>)(d.axis as Date))
          .y((d) => y(d.valueRaw))
          .defined((d) => Number.isFinite(d.valueRaw));
        const sorted = [...series].sort(
          (a, b) => (a.axis as Date).getTime() - (b.axis as Date).getTime()
        );
        cellInfoByFacet.set(facet, {
          row: r,
          col: c,
          margin,
          w,
          h,
          xScale: x,
          yScale: y,
        });
        if (chartType === "area") {
          // Create gradient for area fill
          const gradientId = `area-gradient-${facet.replace(
            /[^a-zA-Z0-9]/g,
            "-"
          )}-${Math.random().toString(36).substr(2, 9)}`;
          const defs = svg.append("defs");
          const gradient = defs
            .append("linearGradient")
            .attr("id", gradientId)
            .attr("x1", "0%")
            .attr("y1", "0%")
            .attr("x2", "0%")
            .attr("y2", "100%");

          // Create a gradient from semi-transparent color at top to fully transparent at bottom
          const colorRgb = d3.rgb(baseStroke);
          gradient
            .append("stop")
            .attr("offset", "0%")
            .attr("stop-color", baseStroke)
            .attr("stop-opacity", 0.6);
          gradient
            .append("stop")
            .attr("offset", "50%")
            .attr("stop-color", baseStroke)
            .attr("stop-opacity", 0.3);
          gradient
            .append("stop")
            .attr("offset", "100%")
            .attr("stop-color", baseStroke)
            .attr("stop-opacity", 0.05);

          const areaGen = d3
            .area<ChartDataItem>()
            .x((d) => (x as d3.ScaleTime<number, number>)(d.axis as Date))
            .y0(y(0))
            .y1((d) => y(d.valueRaw))
            .defined((d) => Number.isFinite(d.valueRaw));
          cell
            .append("path")
            .attr("class", "line-area")
            .attr("data-facet", facet)
            .attr("fill", `url(#${gradientId})`)
            .attr("d", areaGen(sorted));
        }
        cell
          .append("path")
          .attr("class", "line-path")
          .attr("data-facet", facet)
          .attr("fill", "none")
          .attr("stroke", baseStroke)
          .attr("stroke-width", 2)
          .attr("d", lineGen(sorted))
          .style("filter", `drop-shadow(0 6px 12px ${theme.hoverShadow})`);

        // Add brush first
        const brush = d3
          .brushX()
          .extent([
            [0, 0],
            [w, h],
          ])
          .on("start", function () {
            // Hide tooltip during brush
            hideSyncedTooltip();
          })
          .on("end", ({ selection }) => {
            if (!selection) return;
            const [x0, x1] = selection as [number, number];
            const start = (x as d3.ScaleTime<number, number>).invert(x0);
            const end = (x as d3.ScaleTime<number, number>).invert(x1);
            const axisContent = chartState.axisSlot?.content?.[0];
            const facetContent = chartState.facetSlot?.content?.[0];
            if (!axisContent) return;
            const filters: ItemFilter[] = [];
            filters.push({
              expression: "? between ?",
              parameters: [
                {
                  column_id: axisContent.columnId || axisContent.column,
                  dataset_id: axisContent.datasetId || axisContent.set,
                  level: axisContent.level || undefined,
                },
                [start.toISOString(), end.toISOString()],
              ],
              properties: { origin: "filterFromVizItem", type: "where" },
            });
            if (facetContent) {
              filters.push({
                expression: "? = ?",
                parameters: [
                  {
                    column_id: facetContent.columnId || facetContent.column,
                    dataset_id: facetContent.datasetId || facetContent.set,
                    level: facetContent.level || undefined,
                  },
                  facet,
                ],
                properties: { origin: "filterFromVizItem", type: "where" },
              });
            }
            const clearBtn = d3
              .select(chartContainer)
              .select<HTMLButtonElement>(".clear-filter-btn");
            clearBtn.classed("visible", true);
            sendFilterEvent(filters);
          });
        const brushG = cell.append("g").attr("class", "brush").call(brush);

        // Add hover overlay on top of brush so hover works
        cell
          .append("rect")
          .attr("class", "hover-overlay-datetime")
          .attr("x", 0)
          .attr("y", 0)
          .attr("width", w)
          .attr("height", h)
          .attr("fill", "transparent")
          .style("pointer-events", "all")
          .on("mousemove", (event: MouseEvent) => {
            const [mx, my] = d3.pointer(event, cell.node() as any);
            const domain = xDomain as Date[];
            if (!domain.length) return;
            const targetDate = (x as d3.ScaleTime<number, number>).invert(mx);
            let lo = 0,
              hi = domain.length - 1;
            const t = targetDate.getTime();
            while (lo < hi) {
              const mid = Math.floor((lo + hi) / 2);
              if (domain[mid].getTime() < t) lo = mid + 1;
              else hi = mid;
            }
            let idx = lo;
            if (idx > 0) {
              const prev = domain[idx - 1].getTime();
              const curr = domain[idx].getTime();
              if (Math.abs(prev - t) < Math.abs(curr - t)) idx = idx - 1;
            }
            const axisValue =
              domain[Math.max(0, Math.min(domain.length - 1, idx))];
            // Pass cursor Y position directly for tooltip positioning
            showSyncedTooltip(event, axisValue, facet, my);
          })
          .on("mouseleave", () => hideSyncedTooltip());

        cell
          .selectAll("circle.point")
          .data(sorted)
          .enter()
          .append("circle")
          .attr("class", "point")
          .attr("cx", (d) =>
            (x as d3.ScaleTime<number, number>)(d.axis as Date)
          )
          .attr("cy", (d) => y(d.valueRaw))
          .attr("r", 3)
          .attr("fill", baseStroke)
          .attr("data-axis-key", (d) => toAxisKey(d.axis))
          .attr("data-facet", facet)
          .style("pointer-events", "none");
      } else {
        const dom = xDomain as string[];
        const xp = d3.scalePoint().domain(dom).range([0, w]);
        cellInfoByFacet.set(facet, {
          row: r,
          col: c,
          margin,
          w,
          h,
          xScale: xp,
          yScale: y,
        });
        const sorted = [...series];
        if (chartType === "area") {
          // Create gradient for area fill
          const gradientId = `area-gradient-${facet.replace(
            /[^a-zA-Z0-9]/g,
            "-"
          )}-${Math.random().toString(36).substr(2, 9)}`;
          const defs = svg.append("defs");
          const gradient = defs
            .append("linearGradient")
            .attr("id", gradientId)
            .attr("x1", "0%")
            .attr("y1", "0%")
            .attr("x2", "0%")
            .attr("y2", "100%");

          // Create a gradient from semi-transparent color at top to fully transparent at bottom
          const colorRgb = d3.rgb(baseStroke);
          gradient
            .append("stop")
            .attr("offset", "0%")
            .attr("stop-color", baseStroke)
            .attr("stop-opacity", 0.6);
          gradient
            .append("stop")
            .attr("offset", "50%")
            .attr("stop-color", baseStroke)
            .attr("stop-opacity", 0.3);
          gradient
            .append("stop")
            .attr("offset", "100%")
            .attr("stop-color", baseStroke)
            .attr("stop-opacity", 0.05);

          const areaGen = d3
            .area<ChartDataItem>()
            .x((d) => xp(String(d.axis)) || 0)
            .y0(y(0))
            .y1((d) => y(d.valueRaw));
          cell
            .append("path")
            .attr("class", "line-area")
            .attr("data-facet", facet)
            .attr("fill", `url(#${gradientId})`)
            .attr("d", areaGen(sorted));
        }
        const lineGen = d3
          .line<ChartDataItem>()
          .x((d) => xp(String(d.axis)) || 0)
          .y((d) => y(d.valueRaw));
        cell
          .append("path")
          .attr("class", "line-path")
          .attr("data-facet", facet)
          .attr("fill", "none")
          .attr("stroke", baseStroke)
          .attr("stroke-width", 2)
          .attr("d", lineGen(sorted))
          .style("filter", `drop-shadow(0 6px 12px ${theme.hoverShadow})`);

        cell
          .selectAll("circle.point")
          .data(sorted)
          .enter()
          .append("circle")
          .attr("class", "point")
          .attr("cx", (d) => xp(String(d.axis)) || 0)
          .attr("cy", (d) => y(d.valueRaw))
          .attr("r", 3)
          .attr("fill", baseStroke)
          .attr("data-axis-key", (d) => toAxisKey(d.axis))
          .attr("data-facet", facet)
          .style("pointer-events", "none");

        // Transparent overlay for nearest-point hover in categorical
        cell
          .append("rect")
          .attr("class", "hover-overlay")
          .attr("x", 0)
          .attr("y", 0)
          .attr("width", w)
          .attr("height", h)
          .attr("fill", "transparent")
          .style("pointer-events", "all")
          .on("mousemove", (event: MouseEvent) => {
            const [mx, my] = d3.pointer(event, cell.node() as any);
            const domVals = dom as string[];
            if (!domVals.length) return;
            let nearest = domVals[0];
            let best = Infinity;
            domVals.forEach((dv) => {
              const px = xp(dv) || 0;
              const dist = Math.abs(px - mx);
              if (dist < best) {
                best = dist;
                nearest = dv;
              }
            });
            showSyncedTooltip(event, nearest, facet, my);
          })
          .on("mouseleave", () => hideSyncedTooltip());
      }
    }
  };

  facets.forEach((f, i) => drawCell(f, i));
}

/**
 * Helper function to set up chart container
 * @param container Container element
 *
 * NOTE: This is a helper method for internal use. You can implement your own container setup
 * directly in the render/resize methods if needed.
 */
function setupContainer(
  container: HTMLElement,
  theme: ThemeContext
): HTMLElement {
  container.innerHTML = "";
  container.style.background = theme.backgroundColor;

  const chartContainer = document.createElement("div");
  chartContainer.className = "bar-chart-container";
  chartContainer.style.background = theme.backgroundColor;
  chartContainer.style.setProperty("--chart-background", theme.backgroundColor);
  chartContainer.style.setProperty("--axis-text-color", theme.axisTextColor);
  chartContainer.style.setProperty("--axis-line-color", theme.axisLineColor);
  chartContainer.style.setProperty("--main-color", theme.mainColor);
  chartContainer.style.setProperty("--control-bg", theme.controlBackground);
  chartContainer.style.setProperty("--control-border", theme.controlBorder);
  chartContainer.style.setProperty("--control-text", theme.controlText);
  chartContainer.style.setProperty(
    "--control-hover-bg",
    theme.controlHoverBackground
  );
  chartContainer.style.setProperty("--hover-shadow", theme.hoverShadow);
  chartContainer.style.setProperty("--selected-shadow", theme.selectedShadow);
  chartContainer.style.setProperty("--tooltip-bg", theme.tooltipBackground);
  chartContainer.style.setProperty("--tooltip-color", theme.tooltipColor);
  chartContainer.style.setProperty("--bar-radius", `${theme.barRounding}px`);
  chartContainer.style.setProperty("--chart-font-family", theme.fontFamily);

  if (theme.fontFamily) {
    chartContainer.style.fontFamily = theme.fontFamily;
  }

  // Create a sticky header wrapper for controls
  const stickyHeader = document.createElement("div");
  stickyHeader.className = "sticky-header";
  chartContainer.appendChild(stickyHeader);

  const controls = document.createElement("div");
  controls.className = "controls-bar";
  stickyHeader.appendChild(controls);

  const clearFilterBtn = document.createElement("button");
  clearFilterBtn.className = "clear-filter-btn";
  clearFilterBtn.textContent = "Clear Filters";
  clearFilterBtn.onclick = () => {
    chartState.selectedAxisValues.clear();
    chartState.selectedFacet = undefined;
    chartState.selectionByFacet = new Map();
    clearFilterBtn.classList.remove("visible");
    sendFilterEvent([]);
    const last = (container as any).__lastParams as ChartParams | undefined;
    if (last) {
      render({ ...last, container });
    }
  };
  stickyHeader.appendChild(clearFilterBtn);

  container.appendChild(chartContainer);

  return chartContainer;
}

function setupControls(
  chartContainer: HTMLElement,
  theme: ThemeContext,
  defaultType: ChartState["chartType"],
  hasSlots: boolean,
  onChange: (type: ChartState["chartType"]) => void
): void {
  const stickyHeader = chartContainer.querySelector(".sticky-header") as HTMLDivElement;
  if (!stickyHeader) return;
  
  // Hide the entire sticky header if no slots are configured
  if (!hasSlots) {
    stickyHeader.style.display = "none";
    return;
  }
  
  stickyHeader.style.display = "";
  const bar = chartContainer.querySelector(".controls-bar") as HTMLDivElement;
  if (!bar) return;
  bar.innerHTML = "";

  const select = document.createElement("select");
  select.className = "chart-type-select";
  const options: Array<{ label: string; value: ChartState["chartType"] }> = [
    { label: "Column", value: "column" },
    { label: "Line", value: "line" },
    { label: "Area", value: "area" },
  ];
  options.forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    select.appendChild(o);
  });
  select.value = chartState.chartType || defaultType;
  select.onchange = () => onChange(select.value as ChartState["chartType"]);
  bar.appendChild(select);
}

/**
 * Helper function to preprocess data for visualization
 * @param data Raw data array
 * @param measureSlot Measure slot configuration
 * @param categorySlot Category slot configuration
 * @param groupSlot Group slot configuration
 * @returns Processed data array
 *
 * NOTE: This is a helper method for internal use. You can implement your own data processing
 * directly in the render method if needed.
 */
function preProcessData(
  data: ItemData["data"],
  measureSlot: Slot,
  facetSlot: Slot,
  axisSlot: Slot,
  measureFormatter: (value: number) => string
): ChartDataItem[] {
  const facetFormatter = facetSlot?.content[0]
    ? formatter(facetSlot.content[0], {
        level: facetSlot.content[0].level || 9,
      })
    : (val: any) => String(val);
  const axisFormatter = axisSlot?.content[0]
    ? formatter(axisSlot.content[0], { level: axisSlot.content[0].level || 9 })
    : (val: any) => String(val);

  // Row structure expected: [facet, axis, measure]
  return (data ?? []).map((row) => {
    const facetRaw = row[0]?.name?.en || row[0] || "Unknown";
    const axisRaw = row[1]?.name?.en || row[1] || "";
    const isAxisDate = axisSlot.content[0].type === "datetime";
    const axisValue = isAxisDate ? new Date(axisRaw) : axisRaw;
    const valueRaw = Number(row[2]) || 0;
    return {
      facet: String(
        facetFormatter(
          facetSlot.content[0].type === "datetime"
            ? new Date(facetRaw)
            : facetRaw
        )
      ),
      axis: isAxisDate ? (axisValue as Date) : String(axisFormatter(axisRaw)),
      axisRaw: axisRaw,
      valueFormatted: measureFormatter(valueRaw),
      valueRaw,
    };
  });
}
