import { Slot, SlotConfig, ItemQueryDimension, ItemQueryMeasure, ItemQuery, ThemeConfig } from '@luzmo/dashboard-contents-types';
import * as d3 from 'd3';
import * as d3Hexbin from 'd3-hexbin';

interface HexBinExtended extends d3Hexbin.HexbinBin<[number, number]> {
  selected?: boolean;
  path?: Path2D;
  currentOpacity?: number;
  targetOpacity?: number;
  startOpacity?: number;
}

interface DrawableArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ChartState {
  width: number;
  height: number;
  backgroundColor: string;
  data: [number, number][];
  totalClicks: number;
  drawable: DrawableArea;
  xScale: d3.ScaleLinear<number, number>;
  yScale: d3.ScaleLinear<number, number>;
  hexbin: d3Hexbin.Hexbin<[number, number]>;
  bins: HexBinExtended[];
  maxCount: number;
  colorScale: d3.ScaleSequential<string>;
  hexagonPath: Path2D;
}

type TooltipSelection = d3.Selection<HTMLDivElement, unknown, null, undefined>;
type ButtonSelection = d3.Selection<HTMLDivElement, unknown, null, undefined>;

interface ChartRuntime {
  hoveredBin: HexBinExtended | null;
  animationTimer: d3.Timer | null;
  tooltip: TooltipSelection;
  clearButton: ButtonSelection;
  draw: () => void;
  updateClearButtonPosition: () => void;
}

const MARGIN = { top: 20, right: 20, bottom: 30, left: 40 };
const HEX_RADIUS = 6;
const BACKGROUND_IMAGE_URL = 'https://i.imgur.com/M0giHDq.png';
const BACKGROUND_OPACITY = 0.85;
const BASE_OPACITY = 0.3;
const OPACITY_RANGE = 0.7;
const TOOLTIP_CLASS = 'tooltip';
const CLEAR_BUTTON_CLASS = 'clear-selection-btn';
const CLEAR_BUTTON_TEXT = 'Clear selection';
const TOOLTIP_OFFSET = 12;
const CLEAR_BUTTON_VISIBLE_OPACITY = '0.925';
const CLEAR_BUTTON_HIDDEN_OPACITY = '0';
const WINDOW_EVENT_NAMESPACE = '.hexbinHeatmap';

function debounce<T extends (...args: any[]) => void>(fn: T, wait: number): T {
  let timeoutId: number | undefined;
  return function(this: unknown, ...args: Parameters<T>) {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => {
      fn.apply(this, args);
    }, wait);
  } as T;
}

function baseOpacity(bin: HexBinExtended, maxCount: number): number {
  return BASE_OPACITY + OPACITY_RANGE * (bin.length / maxCount);
}

function resetContainer(container: HTMLElement): void {
  clearWindowListeners();
  d3.select(container).selectAll('canvas').remove();
  d3.select(container).selectAll(`.${TOOLTIP_CLASS}, .${CLEAR_BUTTON_CLASS}`).remove();
}

function clearWindowListeners(): void {
  d3.select(window)
    .on(`scroll${WINDOW_EVENT_NAMESPACE}`, null)
    .on(`resize${WINDOW_EVENT_NAMESPACE}`, null);
}

function createCanvas(container: HTMLElement, width: number, height: number): HTMLCanvasElement {
  return d3.select(container)
    .append('canvas')
    .attr('width', width)
    .attr('height', height)
    .style('display', 'block')
    .node() as HTMLCanvasElement;
}

function ensureBackgroundImage(canvas: HTMLCanvasElement, onReady: () => void): void {
  let image = (canvas as any)._bgImg as HTMLImageElement | undefined;
  if (!image) {
    image = new Image();
    image.src = BACKGROUND_IMAGE_URL;
    (canvas as any)._bgImg = image;
  }

  const handleReady = () => {
    onReady();
  };

  if (image.complete) {
    handleReady();
  } else {
    image.onload = () => {
      handleReady();
    };
  }
}

function getContainedImageRect(image: HTMLImageElement, width: number, height: number) {
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) {
    return null;
  }

  const scale = Math.min(width / naturalWidth, height / naturalHeight);
  const drawWidth = naturalWidth * scale;
  const drawHeight = naturalHeight * scale;

  return {
    width: drawWidth,
    height: drawHeight,
    left: (width - drawWidth) / 2,
    top: (height - drawHeight) / 2,
  };
}

function drawBackgroundImage(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): void {
  const image = (canvas as any)._bgImg as HTMLImageElement | undefined;
  if (!image || !image.complete) {
    return;
  }

  const rect = getContainedImageRect(image, width, height);
  if (!rect) {
    return;
  }

  ctx.save();
  ctx.globalAlpha = BACKGROUND_OPACITY;
  ctx.drawImage(image, rect.left, rect.top, rect.width, rect.height);
  ctx.restore();
}

function calculateDrawableArea(canvas: HTMLCanvasElement, width: number, height: number): DrawableArea {
  const image = (canvas as any)._bgImg as HTMLImageElement | undefined;
  if (!image || !image.complete) {
    return { left: 0, top: 0, width, height };
  }

  const rect = getContainedImageRect(image, width, height);
  if (!rect) {
    return { left: 0, top: 0, width, height };
  }

  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function computeChartState(
  data: [number, number][],
  width: number,
  height: number,
  drawable: DrawableArea,
  backgroundColor: string,
): ChartState | null {
  const chartWidth = Math.max(width, 0);
  const chartHeight = Math.max(height, 0);
  const drawableWidth = Math.max(drawable.width, 0);
  const drawableHeight = Math.max(drawable.height, 0);

  const xExtent = d3.extent(data, (d) => +d[0]);
  const yExtent = d3.extent(data, (d) => +d[1]);

  if (
    xExtent[0] === undefined ||
    xExtent[1] === undefined ||
    yExtent[0] === undefined ||
    yExtent[1] === undefined
  ) {
    return null;
  }

  let innerLeft = drawable.left + MARGIN.left;
  let innerRight = drawable.left + drawableWidth - MARGIN.right;
  let innerTop = drawable.top + MARGIN.top;
  let innerBottom = drawable.top + drawableHeight - MARGIN.bottom;

  if (innerRight <= innerLeft) {
    innerLeft = drawable.left;
    innerRight = drawable.left + drawableWidth;
  }

  if (innerBottom <= innerTop) {
    innerTop = drawable.top;
    innerBottom = drawable.top + drawableHeight;
  }

  if (innerRight <= innerLeft || innerBottom <= innerTop) {
    return null;
  }

  const xScale = d3.scaleLinear()
    .domain([xExtent[0], xExtent[1]])
    .nice()
    .range([innerLeft, innerRight]);

  const yScale = d3.scaleLinear()
    .domain([yExtent[0], yExtent[1]])
    .nice()
    .range([innerBottom, innerTop]);

  const hexbin = d3Hexbin.hexbin<[number, number]>()
    .x((d) => xScale(d[0]))
    .y((d) => yScale(d[1]))
    .radius(HEX_RADIUS)
    .extent([[innerLeft, innerTop], [innerRight, innerBottom]]);

  const bins = hexbin(data) as HexBinExtended[];
  const maxCount = d3.max(bins, (bin) => bin.length) || 1;
  const colorScale = d3.scaleSequential<string>(d3.interpolateMagma).domain([0, maxCount]);
  const hexagonPath = new Path2D(hexbin.hexagon());

  for (const bin of bins) {
    bin.selected = false;
    bin.startOpacity = undefined;
    bin.targetOpacity = undefined;
    bin.currentOpacity = baseOpacity(bin, maxCount);
    const translatedPath = new Path2D();
    const matrix = new DOMMatrix().translate(bin.x, bin.y);
    translatedPath.addPath(hexagonPath, matrix);
    bin.path = translatedPath;
  }

  return {
    width: chartWidth,
    height: chartHeight,
    backgroundColor,
    data,
    totalClicks: data.length,
    drawable: { ...drawable },
    xScale,
    yScale,
    hexbin,
    bins,
    maxCount,
    colorScale,
    hexagonPath,
  };
}

function drawChart(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  state: ChartState,
  hoveredBin: HexBinExtended | null,
): void {
  ctx.clearRect(0, 0, state.width, state.height);

  ctx.save();
  ctx.fillStyle = state.backgroundColor;
  ctx.fillRect(0, 0, state.width, state.height);
  ctx.restore();

  drawBackgroundImage(ctx, canvas, state.width, state.height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(state.drawable.left, state.drawable.top, state.drawable.width, state.drawable.height);
  ctx.clip();

  for (const bin of state.bins) {
    if (!bin.path) {
      continue;
    }

    ctx.save();
    ctx.fillStyle = state.colorScale(bin.length) as string;
    ctx.globalAlpha = bin.currentOpacity ?? baseOpacity(bin, state.maxCount);
    const highlighted = Boolean(bin.selected || (hoveredBin && hoveredBin === bin));
    ctx.strokeStyle = 'black';
    ctx.lineWidth = highlighted ? 1.25 : 0.15;
    ctx.fill(bin.path);
    ctx.stroke(bin.path);
    ctx.restore();
  }

  ctx.restore();
}

function createTooltip(container: HTMLElement): TooltipSelection {
  return d3.select(container)
    .append('div')
    .attr('class', TOOLTIP_CLASS)
    .style('position', 'absolute')
    .style('pointer-events', 'none')
    .style('background-color', '#000')
    .style('color', '#fff')
    .style('padding', '8px 12px')
    .style('border-radius', '6px')
    .style('font-family', 'Inter, sans-serif')
    .style('font-size', '14px')
    .style('line-height', '20px')
    .style('opacity', '0')
    .style('visibility', 'hidden');
}

function createClearButton(container: HTMLElement): ButtonSelection {
  return d3.select(container)
    .append('div')
    .attr('class', CLEAR_BUTTON_CLASS)
    .style('position', 'absolute')
    .style('background-color', '#000')
    .style('color', '#fff')
    .style('padding', '6px 8px')
    .style('border-radius', '6px')
    .style('font-family', 'Inter, sans-serif')
    .style('font-size', '12px')
    .style('cursor', 'pointer')
    .style('opacity', CLEAR_BUTTON_HIDDEN_OPACITY)
    .style('pointer-events', 'none')
    .text(CLEAR_BUTTON_TEXT);
}

function updateClearButtonPosition(button: ButtonSelection, canvas: HTMLCanvasElement): void {
  const rect = canvas.getBoundingClientRect();
  const left = rect.left + window.scrollX + 10;
  const top = rect.top + window.scrollY + 10;
  button
    .style('left', `${left}px`)
    .style('top', `${top}px`);
}

function updateClearButtonVisibility(button: ButtonSelection, visible: boolean): void {
  button
    .style('opacity', visible ? CLEAR_BUTTON_VISIBLE_OPACITY : CLEAR_BUTTON_HIDDEN_OPACITY)
    .style('pointer-events', visible ? 'auto' : 'none');
}

function getCanvasState(canvas: HTMLCanvasElement): ChartState | undefined {
  return (canvas as any)._state as ChartState | undefined;
}

function setCanvasState(canvas: HTMLCanvasElement, state: ChartState): void {
  (canvas as any)._state = state;
}

function getRuntime(canvas: HTMLCanvasElement): ChartRuntime | undefined {
  return (canvas as any)._runtime as ChartRuntime | undefined;
}

function setRuntime(canvas: HTMLCanvasElement, runtime: ChartRuntime): void {
  (canvas as any)._runtime = runtime;
}

function getRelativeMousePosition(event: MouseEvent, canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function findBinAtPoint(
  ctx: CanvasRenderingContext2D,
  bins: HexBinExtended[],
  x: number,
  y: number,
): HexBinExtended | null {
  for (const bin of bins) {
    if (bin.path && ctx.isPointInPath(bin.path, x, y)) {
      return bin;
    }
  }
  return null;
}

function hideTooltip(tooltip: TooltipSelection): void {
  tooltip.style('opacity', '0').style('visibility', 'hidden');
}

function updateTooltip(
  tooltip: TooltipSelection,
  event: MouseEvent,
  state: ChartState,
  bin: HexBinExtended,
): void {
  const xValue = state.xScale.invert(bin.x);
  const yValue = state.yScale.invert(bin.y);
  const percentage = state.totalClicks > 0
    ? ((bin.length / state.totalClicks) * 100).toFixed(2)
    : '0.00';

  tooltip
    .style('visibility', 'visible')
    .style('opacity', '0')
    .html(
      `<b>Coordinates</b>: (${xValue.toFixed(2)}, ${yValue.toFixed(2)})<br/>` +
      `<b>Click count</b>: ${bin.length} (${percentage}% of total)`
    );

  positionTooltip(tooltip, event);
  tooltip.style('opacity', CLEAR_BUTTON_VISIBLE_OPACITY);
}

function positionTooltip(tooltip: TooltipSelection, event: MouseEvent): void {
  const element = tooltip.node();
  if (!element) {
    return;
  }

  tooltip.style('left', '-9999px').style('top', '-9999px');

  const rect = element.getBoundingClientRect();
  const viewportRight = window.scrollX + window.innerWidth;
  const viewportBottom = window.scrollY + window.innerHeight;

  let left = event.pageX + TOOLTIP_OFFSET;
  if (left + rect.width > viewportRight) {
    left = event.pageX - rect.width - TOOLTIP_OFFSET;
  }
  left = Math.max(window.scrollX + TOOLTIP_OFFSET, left);

  let top = event.pageY + TOOLTIP_OFFSET;
  if (top + rect.height > viewportBottom) {
    top = event.pageY - rect.height - TOOLTIP_OFFSET;
  }
  top = Math.max(window.scrollY + TOOLTIP_OFFSET, top);

  tooltip.style('left', `${left}px`).style('top', `${top}px`);
}

function setSelection(state: ChartState, targetBin: HexBinExtended | null): boolean {
  const selectionExists = Boolean(targetBin);

  for (const bin of state.bins) {
    bin.startOpacity = bin.currentOpacity ?? baseOpacity(bin, state.maxCount);
    if (selectionExists) {
      const isSelected = bin === targetBin;
      bin.selected = isSelected;
      bin.targetOpacity = isSelected ? 1 : 0.25;
    } else {
      bin.selected = false;
      bin.targetOpacity = baseOpacity(bin, state.maxCount);
    }
  }

  return selectionExists;
}

function animateBins(state: ChartState, runtime: ChartRuntime, duration = 300): void {
  if (runtime.animationTimer) {
    runtime.animationTimer.stop();
  }

  let needsAnimation = false;
  for (const bin of state.bins) {
    if (bin.startOpacity !== undefined && bin.targetOpacity !== undefined && bin.startOpacity !== bin.targetOpacity) {
      needsAnimation = true;
      break;
    }
  }

  if (!needsAnimation) {
    runtime.draw();
    return;
  }

  runtime.animationTimer = d3.timer((elapsed) => {
    const progress = Math.min(1, elapsed / duration);
    const eased = d3.easeCubicOut(progress);

    for (const bin of state.bins) {
      if (bin.startOpacity === undefined || bin.targetOpacity === undefined) {
        continue;
      }
      const start = bin.startOpacity;
      const target = bin.targetOpacity;
      bin.currentOpacity = start + (target - start) * eased;
    }

    runtime.draw();

    if (progress >= 1) {
      runtime.animationTimer?.stop();
      runtime.animationTimer = null;
      for (const bin of state.bins) {
        if (bin.targetOpacity !== undefined) {
          bin.currentOpacity = bin.targetOpacity;
        }
        bin.startOpacity = undefined;
      }
    }
  });
}

function clearSelection(state: ChartState, runtime: ChartRuntime): void {
  const hadSelection = state.bins.some((bin) => bin.selected);
  if (!hadSelection) {
    return;
  }

  setSelection(state, null);
  runtime.hoveredBin = null;
  updateClearButtonVisibility(runtime.clearButton, false);
  hideTooltip(runtime.tooltip);
  animateBins(state, runtime);
}

function attachInteractions(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  runtime: ChartRuntime,
): void {
  const tooltip = runtime.tooltip;
  const canvasSelection = d3.select(canvas);

  canvasSelection
    .on(`mousemove${WINDOW_EVENT_NAMESPACE}`, (event: MouseEvent) => {
      const state = getCanvasState(canvas);
      if (!state) {
        return;
      }

      const { x, y } = getRelativeMousePosition(event, canvas);
      const hovered = findBinAtPoint(ctx, state.bins, x, y);

      if (hovered) {
        runtime.hoveredBin = hovered;
        canvas.style.cursor = 'pointer';
        runtime.draw();
        updateTooltip(tooltip, event, state, hovered);
      } else {
        if (runtime.hoveredBin) {
          runtime.hoveredBin = null;
          runtime.draw();
        }
        canvas.style.cursor = 'default';
        hideTooltip(tooltip);
      }
    })
    .on(`mouseleave${WINDOW_EVENT_NAMESPACE}`, () => {
      runtime.hoveredBin = null;
      canvas.style.cursor = 'default';
      hideTooltip(tooltip);
      runtime.draw();
    })
    .on(`click${WINDOW_EVENT_NAMESPACE}`, (event: MouseEvent) => {
      const state = getCanvasState(canvas);
      if (!state) {
        return;
      }

      const { x, y } = getRelativeMousePosition(event, canvas);
      const clickedBin = findBinAtPoint(ctx, state.bins, x, y);
      if (!clickedBin) {
        return;
      }

      const selectionExists = setSelection(state, clickedBin.selected ? null : clickedBin);
      runtime.hoveredBin = clickedBin.selected ? null : clickedBin;
      runtime.draw();
      updateClearButtonVisibility(runtime.clearButton, selectionExists);
      animateBins(state, runtime);
    });

  runtime.clearButton.on('click', (event) => {
    event.stopPropagation();
    const state = getCanvasState(canvas);
    if (!state) {
      return;
    }
    clearSelection(state, runtime);
  });
}

export const render = ({
  container,
  data = [],
  slots = [],
  slotConfigurations = [],
  options = {},
  language = 'en',
  dimensions: { width, height } = { width: 0, height: 0 },
}: {
  container: HTMLElement;
  data: [number, number][];
  slots: Slot[];
  slotConfigurations: SlotConfig[];
  options: Record<string, any>;
  language: string;
  dimensions: { width: number; height: number };
}): void => {
  resetContainer(container);

  if (!Array.isArray(data) || data.length === 0) {
    return;
  }

  const theme = (options?.theme ?? {}) as ThemeConfig;
  const backgroundColor = theme.itemsBackground ?? '#ffffff';
  container.style.backgroundColor = backgroundColor;

  const chartWidth = width ?? 0;
  const chartHeight = height ?? 0;
  const canvas = createCanvas(container, chartWidth, chartHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const drawableArea = calculateDrawableArea(canvas, chartWidth, chartHeight);
  const state = computeChartState(data, chartWidth, chartHeight, drawableArea, backgroundColor);
  if (!state) {
    return;
  }

  setCanvasState(canvas, state);

  const tooltip = createTooltip(container);
  const clearButton = createClearButton(container);

  const runtime: ChartRuntime = {
    hoveredBin: null,
    animationTimer: null,
    tooltip,
    clearButton,
    draw: () => {
      const currentState = getCanvasState(canvas);
      if (!currentState) {
        return;
      }
      drawChart(canvas, ctx, currentState, runtime.hoveredBin);
    },
    updateClearButtonPosition: () => updateClearButtonPosition(clearButton, canvas),
  };

  setRuntime(canvas, runtime);

  ensureBackgroundImage(canvas, () => {
    performResize(container, canvas.width, canvas.height);
  });
  runtime.updateClearButtonPosition();

  const debouncedUpdatePosition = debounce(runtime.updateClearButtonPosition, 100);
  d3.select(window)
    .on(`scroll${WINDOW_EVENT_NAMESPACE}`, debouncedUpdatePosition)
    .on(`resize${WINDOW_EVENT_NAMESPACE}`, debouncedUpdatePosition);

  attachInteractions(canvas, ctx, runtime);
  runtime.draw();
};

let resizeTimer: number | null = null;
const RESIZE_DEBOUNCE_TIME = 200;

export const resize = ({
  container,
  slots = [],
  slotConfigurations = [],
  options = {},
  language = 'en',
  dimensions: { width, height } = { width: 0, height: 0 },
}: {
  container: HTMLElement;
  slots: Slot[];
  slotConfigurations: SlotConfig[];
  options: Record<string, any>;
  language: string;
  dimensions: { width: number; height: number };
}): void => {
  if (resizeTimer !== null) {
    window.clearTimeout(resizeTimer);
  }

  resizeTimer = window.setTimeout(() => {
    performResize(container, width, height);
    resizeTimer = null;
  }, RESIZE_DEBOUNCE_TIME);
};

function performResize(container: HTMLElement, width?: number, height?: number): void {
  const canvasSelection = d3.select(container).select<HTMLCanvasElement>('canvas');
  if (canvasSelection.empty()) {
    return;
  }

  const canvas = canvasSelection.node() as HTMLCanvasElement;
  const state = getCanvasState(canvas);
  const runtime = getRuntime(canvas);

  if (!state || !runtime) {
    return;
  }

  const nextWidth = width ?? canvas.width;
  const nextHeight = height ?? canvas.height;

  canvas.width = nextWidth;
  canvas.height = nextHeight;

  const drawableArea = calculateDrawableArea(canvas, nextWidth, nextHeight);
  const nextState = computeChartState(state.data, nextWidth, nextHeight, drawableArea, state.backgroundColor);
  if (!nextState) {
    return;
  }

  setCanvasState(canvas, nextState);

  if (runtime.animationTimer) {
    runtime.animationTimer.stop();
    runtime.animationTimer = null;
  }

  runtime.hoveredBin = null;
  hideTooltip(runtime.tooltip);
  updateClearButtonVisibility(runtime.clearButton, false);
  runtime.updateClearButtonPosition();
  runtime.draw();
}

export const buildQuery = ({ slots }: { slots: Slot[]; slotConfigurations: SlotConfig[] }): ItemQuery => {
  const measures: ItemQueryMeasure[] = [];
  const dimensions: ItemQueryDimension[] = [];

  const addDimension = (slotName: string) => {
    const slot = slots.find((item) => item.name === slotName);
    const content = slot?.content?.[0];
    if (!content) {
      return;
    }

    dimensions.push({
      dataset_id: content.datasetId ?? content.set,
      column_id: content.columnId ?? content.column,
      level: content.level ?? 1,
    });
  };

  addDimension('x-axis');
  addDimension('y-axis');

  return {
    dimensions,
    measures,
    limit: { by: 100000 },
    options: { rollup_data: false },
  };
};
