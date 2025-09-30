import { formatter } from '@luzmo/analytics-components-kit/utils';
import type {
  ItemData,
  ItemThemeConfig,
  Slot,
  SlotConfig
} from '@luzmo/dashboard-contents-types';
import * as d3 from 'd3';

type WaterfallStepType = 'start' | 'change' | 'total';

interface RawWaterfallStep {
  label: string;
  value: number;
  type: WaterfallStepType;
}

interface PreparedWaterfallStep extends RawWaterfallStep {
  index: number;
  start: number;
  end: number;
  runningTotal: number;
  labelValue: number;
}

interface ChartConfig {
  colors: {
    increase: string;
    decrease: string;
    total: string;
    connector: string;
  };
  animationDuration: number;
}

interface AxisColorScheme {
  text: string;
  line: string;
  baseline: string;
}

interface WaterfallState {
  steps: PreparedWaterfallStep[];
  formatValue: (value: number) => string;
  formatLabel: (value: number, type: WaterfallStepType) => string;
  config: ChartConfig;
  language: string;
  theme?: ItemThemeConfig;
}

interface WaterfallOptions {
  increaseColor?: string;
  decreaseColor?: string;
  totalColor?: string;
  connectorColor?: string;
  numberFormat?: string;
  animationDuration?: number;
  typeMapping?: Record<string, WaterfallStepType>;
  data?: Array<{ label: string; value: number; type?: WaterfallStepType }>;
}

type ChartRenderOptions = WaterfallOptions & { theme?: ItemThemeConfig } & Record<string, unknown>;

interface ChartParams {
  container: HTMLElement;
  data?: ItemData['data'];
  slots?: Slot[];
  slotConfigurations?: SlotConfig[];
  options?: ChartRenderOptions;
  language?: string;
  dimensions?: { width?: number; height?: number };
}

const STATE_KEY = '__waterfallChartState';
const MIN_CHART_WIDTH = 320;
const MIN_CHART_HEIGHT = 260;

export const render = ({
  container,
  data = [],
  slots = [],
  options = {} as ChartRenderOptions,
  language = 'en',
  dimensions: { width = 0, height = 0 } = {}
}: ChartParams): void => {
  const resolvedOptions: ChartRenderOptions = options ?? ({} as ChartRenderOptions);
  const { root, tooltip } = setupContainer(container);

  const state = createWaterfallState({
    data,
    slots,
    options: resolvedOptions,
    language
  });

  if (!state.steps.length) {
    renderEmptyState(root);
    (container as any)[STATE_KEY] = state;
    return;
  }

  drawWaterfallChart({
    root,
    tooltip,
    steps: state.steps,
    config: state.config,
    formatValue: state.formatValue,
    formatLabel: state.formatLabel,
    dimensions: { width, height },
    container,
    theme: state.theme
  });

  (container as any)[STATE_KEY] = state;
};

export const resize = ({
  container,
  data = [],
  slots = [],
  options = {} as ChartRenderOptions,
  language = 'en',
  dimensions: { width = 0, height = 0 } = {}
}: ChartParams): void => {
  const state = ((container as any)[STATE_KEY] ?? null) as WaterfallState | null;

  if (!state) {
    render({ container, data, slots, options, language, dimensions: { width, height } });
    return;
  }

  const { root, tooltip } = setupContainer(container);

  if (!state.steps.length) {
    renderEmptyState(root);
    (container as any)[STATE_KEY] = state;
    return;
  }

  drawWaterfallChart({
    root,
    tooltip,
    steps: state.steps,
    config: state.config,
    formatValue: state.formatValue,
    formatLabel: state.formatLabel,
    dimensions: { width, height },
    container,
    theme: state.theme
  });

  (container as any)[STATE_KEY] = state;
};

function createWaterfallState({
  data,
  slots,
  options,
  language
}: {
  data: ItemData['data'];
  slots: Slot[];
  options: ChartRenderOptions;
  language: string;
}): WaterfallState {
  const categorySlot = slots?.find((slot) => slot.name === 'category');
  const measureSlot = slots?.find((slot) => slot.name === 'measure');

  const numberFormatter = createNumberFormatter(measureSlot, options, language);
  const formatLabel = (value: number, type: WaterfallStepType) =>
    formatDisplayValue(value, type, numberFormatter);

  const rawSteps = buildRawSteps({
    data,
    categorySlot,
    measureSlot,
    options,
    language
  });

  const steps = prepareSteps(rawSteps);

  const config: ChartConfig = {
    colors: resolveColors(options, options.theme),
    animationDuration: Math.max(0, Number(options.animationDuration) || 700)
  };

  return {
    steps,
    formatValue: numberFormatter,
    formatLabel,
    config,
    language,
    theme: options.theme
  };
}

function setupContainer(container: HTMLElement): {
  root: d3.Selection<HTMLDivElement, unknown, null, undefined>;
  tooltip: d3.Selection<HTMLDivElement, unknown, null, undefined>;
} {
  container.innerHTML = '';

  const rootElement = document.createElement('div');
  rootElement.className = 'waterfall-chart-container';
  container.appendChild(rootElement);

  const root = d3.select(rootElement);
  const tooltip = root
    .append('div')
    .attr('class', 'waterfall-tooltip')
    .style('opacity', '0');

  return { root, tooltip };
}

function renderEmptyState(
  root: d3.Selection<HTMLDivElement, unknown, null, undefined>
): void {
  const empty = root.append('div').attr('class', 'empty-state');
  empty.append('div').attr('class', 'empty-state-title').text('Waterfall chart');
  empty
    .append('div')
    .attr('class', 'empty-state-message')
    .text('Assign a category and a measure to render the waterfall chart.');
}

interface DrawWaterfallParams {
  root: d3.Selection<HTMLDivElement, unknown, null, undefined>;
  tooltip: d3.Selection<HTMLDivElement, unknown, null, undefined>;
  steps: PreparedWaterfallStep[];
  config: ChartConfig;
  formatValue: (value: number) => string;
  formatLabel: (value: number, type: WaterfallStepType) => string;
  dimensions: { width: number; height: number };
  container: HTMLElement;
  theme?: ItemThemeConfig;
}

function drawWaterfallChart({
  root,
  tooltip,
  steps,
  config,
  formatValue,
  formatLabel,
  dimensions,
  container,
  theme
}: DrawWaterfallParams): void {
  const { width = 0, height = 0 } = dimensions;
  const resolvedWidth = Math.max(width || container.clientWidth || MIN_CHART_WIDTH, MIN_CHART_WIDTH);
  const resolvedHeight = Math.max(height || container.clientHeight || MIN_CHART_HEIGHT, MIN_CHART_HEIGHT);
  const margin = { top: 48, right: 48, bottom: 110, left: 92 };
  const chartWidth = Math.max(resolvedWidth - margin.left - margin.right, 80);
  const chartHeight = Math.max(resolvedHeight - margin.top - margin.bottom, 80);

  if (theme?.itemsBackground) {
    root.style('background', theme.itemsBackground);
  } else {
    root.style('background', 'transparent');
  }

  const axisColors = resolveAxisColors(theme?.itemsBackground);

  const svg = root
    .append('svg')
    .attr('class', 'waterfall-svg')
    .attr('viewBox', `0 0 ${resolvedWidth} ${resolvedHeight}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  svg.style('width', '100%').style('height', '100%');

  const chartGroup = svg
    .append('g')
    .attr('class', 'waterfall-chart')
    .attr('transform', `translate(${margin.left}, ${margin.top})`);

  const xScale = d3
    .scaleBand<string>()
    .domain(steps.map((step) => step.label))
    .range([0, chartWidth])
    .paddingInner(0.4)
    .paddingOuter(0.25);

  const yDomainMin = Math.min(0, ...steps.map((step) => Math.min(step.start, step.end)));
  const yDomainMax = Math.max(0, ...steps.map((step) => Math.max(step.start, step.end)));
  const yScale = d3
    .scaleLinear()
    .domain([yDomainMin, yDomainMax])
    .nice()
    .range([chartHeight, 0]);

  chartGroup
    .append('line')
    .attr('class', 'waterfall-baseline')
    .attr('x1', 0)
    .attr('x2', chartWidth)
    .attr('y1', yScale(0))
    .attr('y2', yScale(0))
    .attr('stroke', axisColors.baseline);

  const yAxis = d3.axisLeft(yScale).ticks(6).tickFormat((d) => formatValue(Number(d)));
  chartGroup.append('g').attr('class', 'waterfall-axis waterfall-axis--y').call(yAxis);

  const xAxis = d3.axisBottom(xScale);
  const xAxisGroup = chartGroup
    .append('g')
    .attr('class', 'waterfall-axis waterfall-axis--x')
    .attr('transform', `translate(0, ${chartHeight})`)
    .call(xAxis);

  xAxisGroup
    .selectAll('text')
    .attr('transform', 'rotate(-30)')
    .attr('text-anchor', 'end')
    .attr('dx', '-0.6em')
    .attr('dy', '0.9em');

  if (theme?.axis?.fontSize) {
    const axisFontSize = `${theme.axis.fontSize}px`;
    svg.selectAll('.waterfall-axis text').style('font-size', axisFontSize);
  }

  svg.selectAll('.waterfall-axis line, .waterfall-axis path').attr('stroke', axisColors.line);
  svg.selectAll('.waterfall-axis text').style('fill', axisColors.text);
  chartGroup.select('.waterfall-baseline').attr('stroke', axisColors.baseline);

  const transition = d3
    .transition('waterfall-bars')
    .duration(config.animationDuration)
    .ease(d3.easeCubicOut);

  const connectorsGroup = chartGroup.append('g').attr('class', 'waterfall-connectors');

  const connectorsData: Array<{ from: PreparedWaterfallStep; to: PreparedWaterfallStep }> = [];
  for (let i = 1; i < steps.length; i += 1) {
    connectorsData.push({
      from: steps[i - 1],
      to: steps[i]
    });
  }

  const connectors = connectorsGroup
    .selectAll('path')
    .data(connectorsData)
    .enter()
    .append('path')
    .attr(
      'class',
      (d) => `waterfall-connector connector-from-${d.from.index} connector-to-${d.to.index}`
    )
    .attr('d', (d) => createConnectorPath(d, xScale, yScale))
    .attr('stroke', config.colors.connector)
    .attr('stroke-width', 1.5)
    .attr('stroke-linecap', 'round')
    .attr('fill', 'none')
    .attr('opacity', 0)
    .attr('pointer-events', 'none');

  connectors
    .transition(transition)
    .delay(config.animationDuration / 3)
    .attr('opacity', 1);

  const barsGroup = chartGroup.append('g').attr('class', 'waterfall-bars');

  const bars = barsGroup
    .selectAll('g')
    .data(steps)
    .enter()
    .append('g')
    .attr('class', (d) => `waterfall-bar waterfall-bar--${d.type}`)
    .attr('transform', (d) => `translate(${xScale(d.label) ?? 0}, 0)`);

  const barRects = bars
    .append('rect')
    .attr('class', 'waterfall-bar-rect')
    .attr('x', 0)
    .attr('width', xScale.bandwidth())
    .attr('y', (d) => yScale(d.start))
    .attr('height', 0)
    .attr('fill', (d) => getBarColor(d, config.colors))
    .attr('rx', 3)
    .attr('ry', 3);

  barRects
    .transition(transition)
    .attr('y', (d) => yScale(Math.max(d.start, d.end)))
    .attr('height', (d) => {
      const h = Math.abs(yScale(d.start) - yScale(d.end));
      return h < 1 ? 1 : h;
    });

  const labels = bars
    .append('text')
    .attr('class', 'waterfall-bar-label')
    .attr('x', xScale.bandwidth() / 2)
    .attr('text-anchor', 'middle')
    .attr('y', (d) => computeLabelY(d, yScale))
    .text((d) => formatLabel(d.labelValue, d.type))
    .style('opacity', 0);

  applyLabelStyles(labels, yScale, config.colors, axisColors.text);

  labels
    .transition(transition.delay(config.animationDuration / 4))
    .style('opacity', 1)
    .attr('y', (d) => computeLabelY(d, yScale));

  bars
    .on('mouseenter', function (event: PointerEvent, datum) {
      d3.select(this).classed('is-active', true);
      toggleConnectorHighlight(connectorsGroup, datum.index, true);

      tooltip
        .html(createTooltipHtml(datum, formatLabel, formatValue))
        .style('opacity', '1')
        .classed('is-visible', true);

      positionTooltip(event, tooltip, root);
    })
    .on('mousemove', function (event: PointerEvent) {
      positionTooltip(event, tooltip, root);
    })
    .on('mouseleave', function (_event: PointerEvent, datum) {
      d3.select(this).classed('is-active', false);
      toggleConnectorHighlight(connectorsGroup, datum.index, false);
      tooltip.style('opacity', '0').classed('is-visible', false);
    });
}

function prepareSteps(steps: RawWaterfallStep[]): PreparedWaterfallStep[] {
  let runningTotal = 0;
  let baselineEstablished = false;

  return steps.map((step, index) => {
    const type = step.type;
    let start: number;
    let end: number;
    let labelValue: number;
    let effectiveValue = step.value;

    if (type === 'start') {
      start = 0;
      end = step.value;
      runningTotal = end;
      baselineEstablished = true;
      labelValue = runningTotal;
    } else if (type === 'total') {
      const totalValue = baselineEstablished ? runningTotal : step.value;
      start = 0;
      end = totalValue;
      runningTotal = totalValue;
      labelValue = totalValue;
      effectiveValue = totalValue;
    } else {
      start = baselineEstablished || index > 0 ? runningTotal : 0;
      end = start + step.value;
      runningTotal = end;
      labelValue = step.value;
    }

    return {
      index,
      label: step.label,
      type,
      value: effectiveValue,
      start,
      end,
      runningTotal,
      labelValue
    };
  });
}

function buildRawSteps({
  data,
  categorySlot,
  measureSlot,
  options,
  language
}: {
  data: ItemData['data'];
  categorySlot?: Slot;
  measureSlot?: Slot;
  options: ChartRenderOptions;
  language: string;
}): RawWaterfallStep[] {
  if (Array.isArray(options.data) && options.data.length) {
    return options.data.map((item, index, arr) => ({
      label: String(item.label ?? `Step ${index + 1}`),
      value: Number(item.value) || 0,
      type: normaliseStepType(item.type, index, arr.length)
    }));
  }

  const categoryContent = categorySlot?.content?.[0];
  const measureContent = measureSlot?.content?.[0];
  const hasValidSlots = Boolean(categoryContent) && Boolean(measureContent);

  if (!hasValidSlots || !data?.length) {
    return createSampleSteps();
  }

  const categoryFormatter = categoryContent
    ? formatter(categoryContent, {
      level: categoryContent.level ?? 9
    })
    : (val: unknown) => String(val ?? '');

  const typeMapping = options.typeMapping ?? {};
  const categoryType = categoryContent?.type;

  const extendedSteps = data.map((row, index, rows) => {
    const rawCategoryCell = row[0];
    const categoryValue = extractRawValue(rawCategoryCell, language);
    const formattedCategory =
      categoryType === 'datetime'
        ? categoryFormatter(new Date(categoryValue))
        : categoryFormatter(categoryValue);

    const rawMeasureCell = row[1];
    const numericValue = toNumber(rawMeasureCell);

    const explicitType = extractTypeFromRow(row[2]);
    const mappedType = typeMapping[String(formattedCategory)];
    const type = normaliseStepType(mappedType ?? explicitType, index, rows.length);

    let sortValue: number | string | null = null;
    if (categoryType === 'datetime') {
      sortValue = toTimestamp(categoryValue);
    } else if (categoryType === 'hierarchy') {
      sortValue = String(formattedCategory).toLocaleLowerCase();
    }

    return {
      label: String(formattedCategory),
      value: numericValue,
      type,
      sortValue,
      order: index
    };
  });

  if (!extendedSteps.length) {
    return createSampleSteps();
  }

  let orderedSteps = extendedSteps;
  /*
  if (categoryType === 'datetime') {
    orderedSteps = [...extendedSteps].sort((a, b) => {
      const aValue = typeof a.sortValue === 'number' ? a.sortValue : Number.POSITIVE_INFINITY;
      const bValue = typeof b.sortValue === 'number' ? b.sortValue : Number.POSITIVE_INFINITY;
      if (aValue === bValue) {
        return a.order - b.order;
      }
      return aValue - bValue;
    });
  } else if (categoryType === 'hierarchy') {
    const locale = language || 'en';
    orderedSteps = [...extendedSteps].sort((a, b) => {
      const aValue = typeof a.sortValue === 'string' ? a.sortValue : String(a.label).toLocaleLowerCase();
      const bValue = typeof b.sortValue === 'string' ? b.sortValue : String(b.label).toLocaleLowerCase();
      const comparison = aValue.localeCompare(bValue, locale, { sensitivity: 'base' });
      return comparison !== 0 ? comparison : a.order - b.order;
    });
  }
  */

  const rawSteps = orderedSteps.map((step) => ({
    label: step.label,
    value: step.value,
    type: step.type
  }));

  if (!rawSteps.length) {
    return createSampleSteps();
  }

  if (!rawSteps.some((step) => step.type === 'start')) {
    rawSteps[0].type = 'start';
  }

  const lastIndex = rawSteps.length - 1;
  if (!rawSteps.some((step) => step.type === 'total') && lastIndex >= 0) {
    rawSteps[lastIndex].type = 'total';
  }

  return rawSteps;
}

function createNumberFormatter(
  measureSlot: Slot | undefined,
  options: WaterfallOptions | undefined,
  language: string
): (value: number) => string {
  if (measureSlot?.content?.[0]) {
    const slotFormatter = formatter(measureSlot.content[0]);
    return (value: number) => slotFormatter(value);
  }

  if (options?.numberFormat) {
    try {
      const d3Formatter = d3.format(options.numberFormat);
      return (value: number) => d3Formatter(value);
    } catch (error) {
      // Ignore invalid number format strings and fall back to Intl.NumberFormat
    }
  }

  const intl = new Intl.NumberFormat(language || 'en');
  return (value: number) => intl.format(value);
}

function resolveColors(
  options: WaterfallOptions,
  theme?: ItemThemeConfig
): ChartConfig['colors'] {
  const palette = Array.isArray(theme?.colors) ? theme?.colors ?? [] : [];
  const increase = options.increaseColor || palette[0] || '#2e7d32';
  const decrease = options.decreaseColor || palette[1] || '#c62828';
  const total = options.totalColor || palette[2] || '#455a64';
  const connector = options.connectorColor || '#9e9e9e';

  return {
    increase: String(increase),
    decrease: String(decrease),
    total: String(total),
    connector: String(connector)
  };
}

function resolveAxisColors(background?: string | null): AxisColorScheme {
  const defaults: AxisColorScheme = {
    text: '#555555',
    line: '#d0d0d0',
    baseline: '#9e9e9e'
  };

  if (!background) {
    return defaults;
  }

  if (!d3.color(background)) {
    return defaults;
  }

  if (isColorDark(background)) {
    return {
      text: '#f5f5f5',
      line: 'rgba(255, 255, 255, 0.35)',
      baseline: 'rgba(255, 255, 255, 0.55)'
    };
  }

  return defaults;
}

function getBarColor(
  step: PreparedWaterfallStep,
  colors: ChartConfig['colors']
): string {
  if (step.type === 'change') {
    if (step.labelValue < 0) {
      return colors.decrease;
    }
    if (step.labelValue > 0) {
      return colors.increase;
    }
    return colors.total;
  }

  return colors.total;
}


function applyLabelStyles(
  selection: d3.Selection<SVGTextElement, PreparedWaterfallStep, SVGGElement, unknown>,
  yScale: d3.ScaleLinear<number, number>,
  colors: ChartConfig['colors'],
  defaultTextColor: string
): void {
  const fallbackColor = defaultTextColor ?? '#212121';

  selection.each(function (step) {
    const barColor = getBarColor(step, colors);
    const isDark = isColorDark(barColor);
    const inside = isLabelInsideBar(step, yScale);

    d3.select(this)
      .classed('is-invert', isDark && inside)
      .style('fill', inside && isDark ? '#ffffff' : fallbackColor);
  });
}

function isLabelInsideBar(
  step: PreparedWaterfallStep,
  yScale: d3.ScaleLinear<number, number>
): boolean {
  const startY = yScale(step.start);
  const endY = yScale(step.end);
  const labelY = computeLabelY(step, yScale);
  const minY = Math.min(startY, endY);
  const maxY = Math.max(startY, endY);
  const epsilon = 1;

  return labelY >= minY - epsilon && labelY <= maxY + epsilon;
}

function isColorDark(color: string): boolean {
  const parsed = d3.color(color);
  if (!parsed) {
    return false;
  }
  const rgb = parsed.rgb();
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance <= 0.55;
}

function shouldPlaceLabelInside(
  step: PreparedWaterfallStep,
  yScale: d3.ScaleLinear<number, number>
): boolean {
  if (!(step.type === 'change' && step.labelValue < 0)) {
    return false;
  }

  const height = Math.abs(yScale(step.start) - yScale(step.end));
  return height >= 22;
}

function computeLabelY(
  step: PreparedWaterfallStep,
  yScale: d3.ScaleLinear<number, number>
): number {
  const startY = yScale(Math.max(step.start, step.end));
  const endY = yScale(Math.min(step.start, step.end));
  const height = Math.abs(yScale(step.start) - yScale(step.end));

  if (shouldPlaceLabelInside(step, yScale)) {
    const padding = 8;
    return startY + height - padding;
  }

  if (step.type === 'change' && step.labelValue < 0) {
    return startY + height + 14;
  }

  const offset = 8;
  return endY - offset;
}

function toggleConnectorHighlight(
  connectorsGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  index: number,
  isActive: boolean
): void {
  connectorsGroup
    .selectAll(`.connector-to-${index}, .connector-from-${index}`)
    .classed('is-active', isActive);
}

function createTooltipHtml(
  step: PreparedWaterfallStep,
  formatLabel: (value: number, type: WaterfallStepType) => string,
  formatValue: (value: number) => string
): string {
  const valueLabel = formatLabel(step.labelValue, step.type);
  const totalLabel = formatValue(step.runningTotal);

  return `
    <div class="waterfall-tooltip__title">${step.label}</div>
    <div class="waterfall-tooltip__row"><span>Value</span><span>${valueLabel}</span></div>
    <div class="waterfall-tooltip__row"><span>Running total</span><span>${totalLabel}</span></div>
  `;
}

function positionTooltip(
  event: PointerEvent,
  tooltip: d3.Selection<HTMLDivElement, unknown, null, undefined>,
  root: d3.Selection<HTMLDivElement, unknown, null, undefined>
): void {
  const rootNode = root.node();
  const tooltipNode = tooltip.node();

  if (!rootNode || !tooltipNode) {
    return;
  }

  const pointer = d3.pointer(event, rootNode);
  const tooltipWidth = tooltipNode.offsetWidth;
  const tooltipHeight = tooltipNode.offsetHeight;
  const containerWidth = rootNode.clientWidth;
  const containerHeight = rootNode.clientHeight;

  let left = pointer[0] + 16;
  let top = pointer[1] - tooltipHeight - 16;

  if (left + tooltipWidth > containerWidth) {
    left = Math.max(8, containerWidth - tooltipWidth - 8);
  }

  if (top < 0) {
    top = pointer[1] + 16;
  }

  if (top + tooltipHeight > containerHeight) {
    top = Math.max(8, containerHeight - tooltipHeight - 8);
  }

  tooltip.style('transform', `translate(${left}px, ${top}px)`);
}

function createConnectorPath(
  connector: { from: PreparedWaterfallStep; to: PreparedWaterfallStep },
  xScale: d3.ScaleBand<string>,
  yScale: d3.ScaleLinear<number, number>
): string {
  const fromX = (xScale(connector.from.label) ?? 0) + xScale.bandwidth();
  const toX = xScale(connector.to.label) ?? 0;
  const fromY = yScale(connector.from.end);
  const toY = yScale(connector.to.start);

  if (Math.abs(fromY - toY) < 1) {
    return `M${fromX},${fromY}H${toX}`;
  }

  const midX = fromX + (toX - fromX) / 2;
  return `M${fromX},${fromY}H${midX}V${toY}H${toX}`;
}

function formatDisplayValue(
  value: number,
  type: WaterfallStepType,
  formatValue: (value: number) => string
): string {
  if (type === 'change') {
    if (value < 0) {
      return `(${formatValue(Math.abs(value))})`;
    }

    if (value > 0) {
      return `+${formatValue(value)}`;
    }
  }

  return formatValue(value);
}

function createSampleSteps(): RawWaterfallStep[] {
  const sampleSteps: RawWaterfallStep[] = [
    { label: 'Opening Balance', value: 120000, type: 'start' },
    { label: 'Sales Growth', value: 85000, type: 'change' },
    { label: 'Cost of Goods Sold', value: -45000, type: 'change' },
    { label: 'Operating Expenses', value: -32000, type: 'change' },
    { label: 'Marketing Investment', value: -15000, type: 'change' },
    { label: 'Other Income', value: 12000, type: 'change' }
  ];

  let runningTotal = 0;
  sampleSteps.forEach((step, index) => {
    if (index === 0) {
      runningTotal = step.value;
    } else {
      runningTotal += step.value;
    }
  });

  sampleSteps.push({
    label: 'Net Result',
    value: runningTotal,
    type: 'total'
  });

  return sampleSteps;
}

function extractRawValue(cell: unknown, language: string): any {
  if (cell == null) {
    return '';
  }

  if (typeof cell === 'object') {
    const value = cell as Record<string, unknown>;

    if (typeof value.raw !== 'undefined') {
      return value.raw;
    }

    if (typeof value.value !== 'undefined') {
      return value.value;
    }

    if (typeof value.name === 'object' && value.name !== null) {
      const name = value.name as Record<string, string>;
      return name[language] ?? name.en ?? Object.values(name)[0];
    }
  }

  return cell;
}

function toNumber(value: unknown): number {
  if (value == null) {
    return 0;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (typeof value === 'object') {
    const numericObject = value as Record<string, unknown>;

    if (typeof numericObject.raw === 'number') {
      return numericObject.raw;
    }

    if (typeof numericObject.value === 'number') {
      return numericObject.value;
    }

    if (typeof numericObject.value === 'string') {
      const parsed = Number(numericObject.value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
  }

  return 0;
}

function toTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
function normaliseStepType(
  type: unknown,
  index?: number,
  total?: number
): WaterfallStepType {
  if (typeof type === 'string') {
    const value = type.toLowerCase();

    if (['start', 'begin', 'baseline', 'opening'].includes(value)) {
      return 'start';
    }

    if (['total', 'end', 'closing', 'net', 'result'].includes(value)) {
      return 'total';
    }

    if (['change', 'delta', 'increase', 'decrease', 'diff', 'adjustment'].includes(value)) {
      return 'change';
    }
  }

  if (index === 0) {
    return 'start';
  }

  if (typeof total === 'number' && index === total - 1) {
    return 'total';
  }

  return 'change';
}

function extractTypeFromRow(cell: unknown): WaterfallStepType | undefined {
  if (cell == null) {
    return undefined;
  }

  if (typeof cell === 'string') {
    return normaliseStepType(cell);
  }

  if (typeof cell === 'object') {
    const value = cell as Record<string, unknown>;

    if (typeof value.type === 'string') {
      return normaliseStepType(value.type);
    }

    if (typeof value.label === 'string') {
      return normaliseStepType(value.label);
    }

    if (typeof value.value === 'string') {
      return normaliseStepType(value.value);
    }

    if (typeof value.name === 'object' && value.name !== null) {
      const name = value.name as Record<string, string>;
      const candidate = name.en ?? Object.values(name)[0];
      return normaliseStepType(candidate);
    }
  }

  return undefined;
}













