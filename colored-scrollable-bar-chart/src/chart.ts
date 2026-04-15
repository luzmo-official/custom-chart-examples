import { formatter } from '@luzmo/analytics-components-kit/utils';
import type { ItemData, ItemFilter, Slot, SlotConfig, ThemeConfig } from '@luzmo/dashboard-contents-types';
import * as d3 from 'd3';

/** Fixed row height so bars stay readable; extra rows scroll vertically. */
const BAR_ROW_HEIGHT = 40;
const BAND_PADDING = 0.12;
/** Sticky footer: measure axis + optional title (does not scroll with bars). */
const MEASURE_AXIS_FOOTER_WITH_TITLE = 46;
const MEASURE_AXIS_FOOTER_NO_TITLE = 32;

interface ChartDataItem {
  /** Stable row key for band scale (handles duplicate category labels). */
  rowKey: string;
  category: string;
  value: string | number;
  rawValue: number;
  columnId?: string;
  datasetId?: string;
}

interface FilterEventData {
  type: string;
  filters: ItemFilter[];
}

interface ChartState {
  selectedBars: Set<string>;
  categorySlot?: Slot;
  measureSlot?: Slot;
}

const chartState: ChartState = {
  selectedBars: new Set()
};

interface ThemeContext {
  backgroundColor: string;
  axisTextColor: string;
  axisLineColor: string;
  fontFamily: string;
  mainColor: string;
  barRounding: number;
  hoverShadow: string;
  selectedShadow: string;
  tooltipBackground: string;
  tooltipColor: string;
  tooltipFontSize: number;
  isDark: boolean;
}

function toRgb(color?: string, fallback = '#ffffff'): d3.RGBColor {
  const parsed = d3.color(color ?? fallback) ?? d3.color(fallback);
  return d3.rgb(parsed?.toString() ?? fallback);
}

function getRelativeLuminance(color: d3.RGBColor): number {
  const normalize = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * normalize(color.r) + 0.7152 * normalize(color.g) + 0.0722 * normalize(color.b);
}

function getTextColorByBackground(background: string): string {
  const rgb = toRgb(background);
  return getRelativeLuminance(rgb) < 0.45 ? '#f8fafc' : '#111827';
}

function lightenColor(color: string, amount = 0.2): string {
  const parsed = d3.color(color);
  if (!parsed) {
    return color;
  }
  const interpolator = d3.interpolateRgb(parsed, '#ffffff');
  return interpolator(Math.min(1, Math.max(0, amount)));
}

function darkenColor(color: string, amount = 0.2): string {
  const parsed = d3.color(color);
  if (!parsed) {
    return color;
  }
  const interpolator = d3.interpolateRgb(parsed, '#000000');
  return interpolator(Math.min(1, Math.max(0, amount)));
}

function resolveTheme(theme?: ThemeConfig): ThemeContext {
  const backgroundColor = theme?.itemsBackground || '#ffffff';
  const backgroundRgb = toRgb(backgroundColor);
  const luminance = getRelativeLuminance(backgroundRgb);
  const isDark = luminance < 0.45;
  const axisTextColor = isDark ? '#f8fafc' : '#1f2937';
  const axisLineReference =
    luminance < 0.45 ? lightenColor(backgroundColor, 0.25) : darkenColor(backgroundColor, 0.15);
  const axisLineColor = d3.color(axisLineReference)?.formatHex() ?? '#d1d5db';

  const paletteFromTheme = (theme?.colors ?? []).filter(Boolean) as string[];
  const mainColor = theme?.mainColor || paletteFromTheme[0] || '#6366f1';

  const fontFamily =
    theme?.font?.fontFamily ||
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

  const barRounding = Math.max(2, Math.min(16, theme?.itemSpecific?.rounding ?? 8));

  const hoverShadowRgb = d3.rgb(d3.color(darkenColor(mainColor, 0.55)) ?? d3.rgb(15, 23, 42));
  const selectedShadowRgb = d3.rgb(d3.color(mainColor) ?? d3.rgb(99, 102, 241));
  const hoverShadow = `rgba(${hoverShadowRgb.r}, ${hoverShadowRgb.g}, ${hoverShadowRgb.b}, ${isDark ? 0.55 : 0.25})`;
  const selectedShadow = `rgba(${selectedShadowRgb.r}, ${selectedShadowRgb.g}, ${selectedShadowRgb.b}, ${
    isDark ? 0.55 : 0.35
  })`;

  const tooltipBaseColor =
    theme?.tooltip?.background ||
    (isDark ? lightenColor(backgroundColor, 0.18) : darkenColor(backgroundColor, 0.35));
  const tooltipOpacity = theme?.tooltip?.opacity ?? 0.92;
  const tooltipColorRgb = toRgb(tooltipBaseColor);
  const tooltipBackground = `rgba(${tooltipColorRgb.r}, ${tooltipColorRgb.g}, ${tooltipColorRgb.b}, ${tooltipOpacity})`;
  const tooltipColor = getTextColorByBackground(tooltipBaseColor);
  const tooltipFontSize = theme?.tooltip?.fontSize ?? 13;

  return {
    backgroundColor,
    axisTextColor,
    axisLineColor,
    fontFamily,
    mainColor,
    barRounding,
    hoverShadow,
    selectedShadow,
    tooltipBackground,
    tooltipColor,
    tooltipFontSize,
    isDark
  };
}

/** Traffic-light style fill from numeric measure (thresholds on 0–100 style scale). */
function barColorForMeasure(v: number): string {
  if (v < 25) {
    return '#dc2626';
  }
  if (v <= 50) {
    return '#ea580c';
  }
  if (v <= 75) {
    return '#ca8a04';
  }
  return '#16a34a';
}

function sendCustomEvent(data: unknown): void {
  window.parent.postMessage({ type: 'customEvent', data }, '*');
}

function sendFilterEvent(filters: ItemFilter[]): void {
  window.parent.postMessage(
    {
      type: 'setFilter',
      filters
    } as FilterEventData,
    '*'
  );
}

interface ChartParams {
  container: HTMLElement;
  data: ItemData['data'];
  slots: Slot[];
  slotConfigurations: SlotConfig[];
  options: Record<string, unknown> & { theme?: ThemeConfig };
  language: string;
  dimensions: { width: number; height: number };
}

function syncSlotsFromParams(slots: Slot[]): void {
  if (!slots?.length) {
    return;
  }
  chartState.categorySlot = slots.find((s) => s.name === 'category');
  chartState.measureSlot = slots.find((s) => s.name === 'measure');
}

/** Highest measure first; tie-break by category label. */
function sortChartDataByMeasureDescending(items: ChartDataItem[]): ChartDataItem[] {
  return [...items].sort((a, b) => {
    if (b.rawValue !== a.rawValue) {
      return b.rawValue - a.rawValue;
    }
    return a.category.localeCompare(b.category);
  });
}

/**
 * Ensures the plot stack has a bounded height (flex + min-height) so only the bar strip
 * scrolls while the measure axis footer stays visible.
 */
function layoutChartHost(
  root: HTMLElement,
  chartContainer: HTMLElement,
  plotStack: HTMLElement,
  scroll: HTMLElement,
  axisStrip: HTMLElement,
  width: number,
  height: number
): void {
  root.style.boxSizing = 'border-box';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.overflow = 'hidden';

  if (height > 0) {
    root.style.height = `${height}px`;
    root.style.minHeight = `${height}px`;
    root.style.maxHeight = `${height}px`;
  } else {
    root.style.height = '100%';
    root.style.minHeight = '0';
    root.style.maxHeight = 'none';
  }

  if (width > 0) {
    root.style.width = `${width}px`;
    root.style.minWidth = `${width}px`;
    root.style.maxWidth = `${width}px`;
  } else {
    root.style.width = '100%';
  }

  chartContainer.style.flex = '1';
  chartContainer.style.minHeight = '0';
  chartContainer.style.display = 'flex';
  chartContainer.style.flexDirection = 'column';
  chartContainer.style.overflow = 'hidden';

  plotStack.style.flex = '1';
  plotStack.style.minHeight = '0';
  plotStack.style.display = 'flex';
  plotStack.style.flexDirection = 'column';
  plotStack.style.overflow = 'hidden';
  plotStack.style.boxSizing = 'border-box';

  scroll.style.flex = '1';
  scroll.style.minHeight = '0';
  scroll.style.overflowY = 'auto';
  scroll.style.overflowX = 'hidden';
  scroll.style.boxSizing = 'border-box';

  axisStrip.style.flexShrink = '0';
  axisStrip.style.boxSizing = 'border-box';
}

function slotLabel(slot: Slot | undefined, language: string, fallback: string): string {
  const label = slot?.label as string | Record<string, string> | undefined;
  if (!label) {
    return fallback;
  }
  if (typeof label === 'string') {
    return label;
  }
  return label[language] ?? label.en ?? Object.values(label)[0] ?? fallback;
}

/** Bottom axis title: omit generic "Measure" and strip the word from combined labels. */
function measureAxisTitleText(slot: Slot | undefined, language: string): string {
  const raw = slotLabel(slot, language, '');
  if (!raw) {
    return '';
  }
  return raw
    .replace(/\bMeasure\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*:\s*|\s*:\s*$/g, '')
    .trim();
}

function preProcessData(
  data: ItemData['data'],
  measureSlot: Slot,
  categorySlot: Slot,
  measureFormatter: (value: number) => string
): ChartDataItem[] {
  const categoryFormatter = categorySlot?.content[0]
    ? formatter(categorySlot.content[0], {
        level: categorySlot.content[0].level || 9
      })
    : (val: unknown) => String(val);

  return (data ?? []).map((row, index) => {
    const dimCell = row[0] as { name?: string | Record<string, string> } | string | number | undefined;
    let categoryValue: string | number | Date | unknown = 'Unknown';
    if (dimCell != null && typeof dimCell === 'object' && 'name' in dimCell) {
      const nm = dimCell.name;
      if (typeof nm === 'string') {
        categoryValue = nm;
      } else if (nm && typeof nm === 'object' && 'en' in nm) {
        categoryValue = (nm as { en?: string }).en ?? Object.values(nm)[0];
      } else if (nm && typeof nm === 'object') {
        categoryValue = Object.values(nm as Record<string, string>)[0];
      }
    } else if (dimCell != null) {
      categoryValue = dimCell;
    }

    const categoryInput =
      categorySlot.content[0].type === 'datetime'
        ? new Date(String(categoryValue))
        : (categoryValue as string | number | Date);
    const category = categoryFormatter(categoryInput);

    const measureCell = row[1] as
      | number
      | string
      | { value?: number | string; columnId?: string; datasetId?: string }
      | undefined
      | null;
    let rawValue = 0;
    let columnId: string | undefined;
    let datasetId: string | undefined;
    if (typeof measureCell === 'number') {
      rawValue = measureCell;
    } else if (typeof measureCell === 'string') {
      rawValue = Number(measureCell) || 0;
    } else if (measureCell && typeof measureCell === 'object') {
      columnId = measureCell.columnId;
      datasetId = measureCell.datasetId;
      rawValue = Number(measureCell.value ?? measureCell) || 0;
    }

    const formattedValue = measureFormatter(rawValue);

    return {
      rowKey: `r${index}`,
      category: String(category),
      value: formattedValue,
      rawValue,
      columnId,
      datasetId
    };
  });
}

function setupContainer(container: HTMLElement, theme: ThemeContext): HTMLElement {
  container.innerHTML = '';
  container.style.background = theme.backgroundColor;
  container.style.height = '100%';
  container.style.boxSizing = 'border-box';

  const chartContainer = document.createElement('div');
  chartContainer.className = 'bar-chart-container';
  chartContainer.style.background = theme.backgroundColor;
  chartContainer.style.setProperty('--chart-background', theme.backgroundColor);
  chartContainer.style.setProperty('--axis-text-color', theme.axisTextColor);
  chartContainer.style.setProperty('--axis-line-color', theme.axisLineColor);
  chartContainer.style.setProperty('--hover-shadow', theme.hoverShadow);
  chartContainer.style.setProperty('--bar-radius', `${theme.barRounding}px`);
  chartContainer.style.setProperty('--chart-font-family', theme.fontFamily);
  chartContainer.style.setProperty('--clear-filter-bg', theme.isDark ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.6)');
  chartContainer.style.setProperty('--clear-filter-color', theme.isDark ? '#333' : '#eee');
  chartContainer.style.setProperty(
    '--clear-filter-hover-bg',
    theme.isDark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.9)'
  );
  chartContainer.style.setProperty('--clear-filter-hover-color', theme.isDark ? '#333' : '#fff');

  if (theme.fontFamily) {
    chartContainer.style.fontFamily = theme.fontFamily;
  }

  container.appendChild(chartContainer);

  const clearFilterBtn = document.createElement('div');
  clearFilterBtn.className = 'clear-filter-btn';
  clearFilterBtn.textContent = 'Clear filter';
  clearFilterBtn.style.fontSize = `${11 + (11 * (theme.tooltipFontSize / 13 - 1)) / 2}px`;
  clearFilterBtn.onclick = () => {
    chartState.selectedBars.clear();
    d3.selectAll<SVGRectElement, unknown>('.bar-h')
      .classed('bar-selected', false)
      .each(function () {
        const selection = d3.select(this as SVGRectElement);
        const baseFill = selection.attr('data-base-fill');
        if (baseFill) {
          selection.attr('fill', baseFill);
        }
        selection.attr('stroke', 'none').attr('stroke-width', 0).style('filter', 'none');
      });
    clearFilterBtn.classList.remove('visible');
    sendFilterEvent([]);
  };
  chartContainer.appendChild(clearFilterBtn);

  return chartContainer;
}

function estimateLeftMargin(categories: string[], fontSize: number): number {
  const approxChar = fontSize * 0.58;
  const longest = categories.reduce((m, c) => Math.max(m, c.length), 0);
  return Math.min(280, Math.max(72, longest * approxChar + 24));
}

function renderChart(
  scrollHost: HTMLElement,
  axisHost: HTMLElement,
  chartData: ChartDataItem[],
  outerWidth: number,
  theme: ThemeContext,
  measureFormatter: (value: number) => string,
  language: string
): void {
  scrollHost.innerHTML = '';
  axisHost.innerHTML = '';

  const margin = { top: 16, right: 16, left: 8 };
  const categories = chartData.map((d) => d.category);
  const rowKeys = chartData.map((d) => d.rowKey);
  const leftGutter = estimateLeftMargin(categories, 12) + margin.left;
  const plotWidth = Math.max(120, outerWidth - leftGutter - margin.right);

  const innerPlotHeight = Math.max(BAR_ROW_HEIGHT, chartData.length * BAR_ROW_HEIGHT);
  const plotSvgHeight = margin.top + innerPlotHeight;

  const maxValue = d3.max(chartData, (d) => d.rawValue) || 0;
  const xMax = maxValue <= 0 ? 1 : maxValue * 1.08;
  const xScale = d3.scaleLinear().domain([0, xMax]).range([0, plotWidth]).nice();

  const svg = d3
    .select(scrollHost)
    .append('svg')
    .attr('width', outerWidth)
    .attr('height', plotSvgHeight)
    .attr('class', 'bar-chart-svg bar-chart-svg--plot');

  if (theme.fontFamily) {
    svg.style('font-family', theme.fontFamily);
  }

  const chart = svg.append('g').attr('transform', `translate(${leftGutter},${margin.top})`);

  const yScale = d3.scaleBand<string>().domain(rowKeys).range([0, innerPlotHeight]).padding(BAND_PADDING);

  const axisTitleStr = measureAxisTitleText(chartState.measureSlot, language);
  const axisFooterHeight = axisTitleStr ? MEASURE_AXIS_FOOTER_WITH_TITLE : MEASURE_AXIS_FOOTER_NO_TITLE;

  const axisSvg = d3
    .select(axisHost)
    .append('svg')
    .attr('width', outerWidth)
    .attr('height', axisFooterHeight)
    .attr('class', 'bar-chart-svg bar-chart-svg--axis');

  if (theme.fontFamily) {
    axisSvg.style('font-family', theme.fontFamily);
  }

  const axisChart = axisSvg.append('g').attr('transform', `translate(${leftGutter},0)`);

  const xAxis = axisChart
    .append('g')
    .attr('class', 'axis x-axis')
    .attr('transform', 'translate(0,0)')
    .call(
      d3
        .axisBottom(xScale)
        .ticks(Math.min(8, Math.max(3, Math.floor(plotWidth / 90))))
        .tickFormat((v) => measureFormatter(Number(v)))
        .tickSizeOuter(0)
    );

  xAxis.selectAll<SVGTextElement, number>('text').style('fill', theme.axisTextColor);
  if (theme.fontFamily) {
    xAxis.selectAll<SVGTextElement, number>('text').style('font-family', theme.fontFamily);
  }
  xAxis.selectAll<SVGLineElement, unknown>('line').attr('stroke', theme.axisLineColor);
  xAxis.selectAll<SVGPathElement, unknown>('path').attr('stroke', theme.axisLineColor);

  const yAxis = chart.append('g').attr('class', 'axis y-axis');

  yAxis
    .selectAll<SVGTextElement, ChartDataItem>('text.category-label')
    .data(chartData)
    .join('text')
    .attr('class', 'category-label')
    .attr('x', -10)
    .attr('y', (d) => (yScale(d.rowKey) ?? 0) + yScale.bandwidth() / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', 'end')
    .style('fill', theme.axisTextColor)
    .style('font-size', '12px')
    .style('font-weight', '500')
    .text((d) => d.category);

  if (theme.fontFamily) {
    yAxis.selectAll<SVGTextElement, ChartDataItem>('text').style('font-family', theme.fontFamily);
  }

  const barRadius = Math.min(theme.barRounding, yScale.bandwidth() / 2);

  const baseFontSize = 13;
  const chartContainerEl = (scrollHost.closest('.bar-chart-container') ?? scrollHost.parentElement) as HTMLElement;
  const tooltip = d3
    .select(chartContainerEl)
    .append('div')
    .attr('class', 'tooltip')
    .style('opacity', 0)
    .style('background', theme.tooltipBackground)
    .style('color', theme.tooltipColor)
    .style('font-size', theme.tooltipFontSize + 'px')
    .style('line-height', theme.tooltipFontSize * 1.4 + 'px')
    .style('max-width', `${250 * (theme.tooltipFontSize / baseFontSize)}px`)
    .style('overflow-wrap', 'break-word');

  const categoryLabel = slotLabel(chartState.categorySlot, language, 'Category');
  const measureLabel = slotLabel(chartState.measureSlot, language, 'Measure');

  const tooltipPadding = 8;
  const tooltipOffset = 12;

  const positionTooltip = (event: MouseEvent, chartContainer: HTMLElement): void => {
    const [pointerX, pointerY] = d3.pointer(event, chartContainer);
    const tooltipNode = tooltip.node();
    if (!tooltipNode) {
      return;
    }
    const tooltipWidth = tooltipNode.offsetWidth || 200;
    const tooltipHeight = tooltipNode.offsetHeight || 80;
    const maxLeft = Math.max(tooltipPadding, chartContainer.clientWidth - tooltipWidth - tooltipPadding);
    const maxTop = Math.max(tooltipPadding, chartContainer.clientHeight - tooltipHeight - tooltipPadding);
    let x = pointerX + tooltipOffset;
    let y = pointerY + tooltipOffset;
    if (x > maxLeft) {
      x = pointerX - tooltipWidth - tooltipOffset;
    }
    if (y > maxTop) {
      y = pointerY - tooltipHeight - tooltipOffset;
    }
    x = Math.max(tooltipPadding, Math.min(x, maxLeft));
    y = Math.max(tooltipPadding, Math.min(y, maxTop));
    tooltip.style('left', `${x}px`).style('top', `${y}px`);
  };

  chartData.forEach((datum) => {
    const barId = datum.rowKey;
    const baseFill = barColorForMeasure(datum.rawValue);
    const y = yScale(datum.rowKey) ?? 0;
    const bw = yScale.bandwidth();
    const w = Math.max(0, xScale(datum.rawValue));

    const bar = chart
      .append('rect')
      .attr('class', 'bar-h')
      .attr('data-bar-id', barId)
      .attr('data-base-fill', baseFill)
      .attr('x', 0)
      .attr('y', y)
      .attr('width', w)
      .attr('height', bw)
      .attr('fill', baseFill)
      .attr('rx', barRadius)
      .attr('ry', barRadius);

    bar
      .on('mouseover', function (event: MouseEvent) {
        const selection = d3.select(this as SVGRectElement);
        const startingFill = selection.attr('data-base-fill') || baseFill;
        const hoverFill = lightenColor(startingFill, 0.15);
        selection
          .raise()
          .attr('fill', hoverFill)
          .style('filter', `drop-shadow(4px 0 14px ${theme.hoverShadow})`);
        tooltip
          .interrupt()
          .style('opacity', 1)
          .html(`<b>${categoryLabel}:</b> ${datum.category}<br><b>${measureLabel}:</b> ${datum.value}`)
          .style('left', '0px')
          .style('top', '0px');
        positionTooltip(event, chartContainerEl);
      })
      .on('mousemove', function (event: MouseEvent) {
        positionTooltip(event, chartContainerEl);
      })
      .on('mouseout', function () {
        const selection = d3.select(this as SVGRectElement);
        const startingFill = selection.attr('data-base-fill') || baseFill;
        const barKey = selection.attr('data-bar-id');
        const isSelected = barKey ? chartState.selectedBars.has(barKey) : false;
        if (isSelected) {
          selection
            .attr('fill', lightenColor(startingFill, 0.22))
            .style('filter', `drop-shadow(4px 0 18px ${theme.selectedShadow})`);
        } else {
          selection.attr('fill', startingFill).style('filter', 'none');
        }
        tooltip.transition().duration(120).style('opacity', 0);
      })
      .on('click', function (event: MouseEvent) {
        event.stopPropagation();
        const selection = d3.select(this as SVGRectElement);
        const base = selection.attr('data-base-fill') || baseFill;

        if (chartState.selectedBars.has(barId)) {
          chartState.selectedBars.delete(barId);
        } else {
          chartState.selectedBars.add(barId);
        }

        const isSelectedNow = chartState.selectedBars.has(barId);
        if (isSelectedNow) {
          selection
            .classed('bar-selected', true)
            .attr('fill', lightenColor(base, 0.22))
            .attr('stroke', theme.axisTextColor)
            .attr('stroke-width', 1.1)
            .style('filter', `drop-shadow(4px 0 20px ${theme.selectedShadow})`);
        } else {
          selection.classed('bar-selected', false).attr('fill', base).attr('stroke', 'none').style('filter', 'none');
        }

        const clearFilterBtn = d3.select(chartContainerEl).select<HTMLDivElement>('.clear-filter-btn');
        clearFilterBtn.classed('visible', chartState.selectedBars.size > 0);

        const filters: ItemFilter[] = [];
        const groupedFilters = new Map<string, Set<string>>();

        chartState.selectedBars.forEach((selectedRowKey) => {
          const categoryContent = chartState.categorySlot?.content?.[0];
          if (!categoryContent) {
            return;
          }
          const datum = chartData.find((d) => d.rowKey === selectedRowKey);
          if (!datum) {
            return;
          }
          const columnKey = `${categoryContent.columnId || (categoryContent as { column?: string }).column}:${
            categoryContent.datasetId || (categoryContent as { set?: string }).set
          }`;
          if (!groupedFilters.has(columnKey)) {
            groupedFilters.set(columnKey, new Set());
          }
          groupedFilters.get(columnKey)?.add(datum.category);
        });

        groupedFilters.forEach((values, key) => {
          const [columnId, datasetId] = key.split(':');
          const uniqueValues = Array.from(values);
          filters.push({
            expression: uniqueValues.length > 1 ? '? in ?' : '? = ?',
            parameters: [
              {
                column_id: columnId,
                dataset_id: datasetId,
                level: chartState.categorySlot?.content?.[0]?.level || undefined
              },
              uniqueValues.length > 1 ? uniqueValues : uniqueValues[0]
            ],
            properties: {
              origin: 'filterFromVizItem',
              type: 'where'
            }
          });
        });

        sendFilterEvent(filters);
        sendCustomEvent({
          category: datum.category,
          value: datum.value,
          rawValue: datum.rawValue
        });
      });
  });

  if (axisTitleStr) {
    const measureAxisLabel = axisChart
      .append('text')
      .attr('x', plotWidth / 2)
      .attr('y', axisFooterHeight - 6)
      .attr('text-anchor', 'middle')
      .style('fill', theme.axisTextColor)
      .style('font-size', '11px')
      .style('font-weight', '600')
      .text(axisTitleStr);
    if (theme.fontFamily) {
      measureAxisLabel.style('font-family', theme.fontFamily);
    }
  }
}

export const render = ({
  container,
  data = [],
  slots = [],
  options = {},
  language = 'en',
  dimensions: { width, height } = { width: 0, height: 0 }
}: ChartParams): void => {
  const themeContext = resolveTheme(options.theme);
  (container as { __themeContext?: ThemeContext }).__themeContext = themeContext;
  syncSlotsFromParams(slots);

  const chartContainer = setupContainer(container, themeContext);

  const measureFormatterFn = chartState.measureSlot?.content?.[0]
    ? formatter(chartState.measureSlot.content[0])
    : (value: number) => new Intl.NumberFormat(language).format(value);

  const hasCategory = (chartState.categorySlot?.content?.length ?? 0) > 0;
  const hasMeasure = (chartState.measureSlot?.content?.length ?? 0) > 0;

  let chartData: ChartDataItem[] = [];

  if (!(data?.length ?? 0) || !hasCategory || !hasMeasure) {
    const demoCategories = ['Low', 'Low–mid A', 'Low–mid B', 'Mid', 'Mid–high A', 'Mid–high B', 'High', 'Sample 8'];
    const demoValues = [12, 25, 40, 55, 62, 75, 88, 33];
    chartData = demoCategories.map((category, i) => ({
      rowKey: `demo${i}`,
      category,
      rawValue: demoValues[i] ?? 0,
      value: measureFormatterFn(demoValues[i] ?? 0)
    }));
  } else {
    chartData = preProcessData(data, chartState.measureSlot!, chartState.categorySlot!, measureFormatterFn);
  }

  chartData = sortChartDataByMeasureDescending(chartData);

  const plotStack = document.createElement('div');
  plotStack.className = 'bar-chart-plot-stack';
  const scroll = document.createElement('div');
  scroll.className = 'bar-chart-scroll';
  const axisStrip = document.createElement('div');
  axisStrip.className = 'bar-chart-measure-axis';
  plotStack.appendChild(scroll);
  plotStack.appendChild(axisStrip);
  chartContainer.appendChild(plotStack);
  layoutChartHost(container, chartContainer, plotStack, scroll, axisStrip, width, height);

  renderChart(scroll, axisStrip, chartData, width, themeContext, measureFormatterFn, language);

  (container as { __chartData?: ChartDataItem[] }).__chartData = chartData;
};

export const resize = ({
  container,
  data = [],
  slots = [],
  options = {},
  language = 'en',
  dimensions: { width, height } = { width: 0, height: 0 }
}: ChartParams): void => {
  const prev = (container as { __themeContext?: ThemeContext; __chartData?: ChartDataItem[] }).__themeContext;
  const themeContext = options.theme ? resolveTheme(options.theme) : prev ?? resolveTheme(undefined);
  (container as { __themeContext?: ThemeContext }).__themeContext = themeContext;
  syncSlotsFromParams(slots);

  let chartData = (container as { __chartData?: ChartDataItem[] }).__chartData ?? [];
  const measureFormatterFn = chartState.measureSlot?.content?.[0]
    ? formatter(chartState.measureSlot.content[0])
    : (value: number) => new Intl.NumberFormat(language).format(value);

  const hasCategory = (chartState.categorySlot?.content?.length ?? 0) > 0;
  const hasMeasure = (chartState.measureSlot?.content?.length ?? 0) > 0;

  if ((data?.length ?? 0) && hasCategory && hasMeasure) {
    chartData = preProcessData(data, chartState.measureSlot!, chartState.categorySlot!, measureFormatterFn);
    (container as { __chartData?: ChartDataItem[] }).__chartData = chartData;
  } else if (!chartData.length) {
    const demoCategories = ['Low', 'Low–mid A', 'Low–mid B', 'Mid', 'Mid–high A', 'Mid–high B', 'High', 'Sample 8'];
    const demoValues = [12, 25, 40, 55, 62, 75, 88, 33];
    chartData = demoCategories.map((category, i) => ({
      rowKey: `demo${i}`,
      category,
      rawValue: demoValues[i] ?? 0,
      value: measureFormatterFn(demoValues[i] ?? 0)
    }));
  }

  chartData = sortChartDataByMeasureDescending(chartData);
  (container as { __chartData?: ChartDataItem[] }).__chartData = chartData;

  const newChartContainer = setupContainer(container, themeContext);
  const plotStack = document.createElement('div');
  plotStack.className = 'bar-chart-plot-stack';
  const scroll = document.createElement('div');
  scroll.className = 'bar-chart-scroll';
  const axisStrip = document.createElement('div');
  axisStrip.className = 'bar-chart-measure-axis';
  plotStack.appendChild(scroll);
  plotStack.appendChild(axisStrip);
  newChartContainer.appendChild(plotStack);
  layoutChartHost(container, newChartContainer, plotStack, scroll, axisStrip, width, height);
  renderChart(scroll, axisStrip, chartData, width, themeContext, measureFormatterFn, language);
};
