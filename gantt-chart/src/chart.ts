import { formatter } from '@luzmo/analytics-components-kit/utils';
import type {
  ItemData,
  ItemFilter,
  ThemeConfig,
  Slot,
  SlotConfig
} from '@luzmo/dashboard-contents-types';
import * as d3 from 'd3';

interface GanttTask {
  taskName: string;
  startDate: Date;
  endDate: Date;
  group: string;
  duration: number; // Duration in days
  columnId?: string;
  datasetId?: string;
}

interface ChartSettings {
  legendVisible: boolean;
  legendPosition: 'top' | 'bottom';
}

interface ChartState {
  selectedTasks: Set<string>;
  taskSlot?: Slot;
  startDateSlot?: Slot;
  endDateSlot?: Slot;
  groupSlot?: Slot;
  settings: ChartSettings;
}

const chartState: ChartState = {
  selectedTasks: new Set(),
  settings: {
    legendVisible: true,
    legendPosition: 'top'
  }
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

function expandPalette(basePalette: string[], mainColor: string, length: number): string[] {
  if (length <= basePalette.length) {
    return basePalette.slice(0, length);
  }

  const palette = [...basePalette];
  const modifiers = [0.15, -0.15, 0.3, -0.3, 0.45, -0.45, 0.6, -0.6];
  let index = 0;

  while (palette.length < length) {
    const modifier = modifiers[index % modifiers.length];
    const intensity = Math.min(0.85, Math.abs(modifier));
    const color = modifier >= 0 ? lightenColor(mainColor, intensity) : darkenColor(mainColor, intensity);
    palette.push(color);
    index++;
  }

  return palette.slice(0, length);
}

function resolveTheme(theme?: ThemeConfig): ThemeContext {
  const backgroundColor = theme?.itemsBackground || '#ffffff';
  const backgroundRgb = toRgb(backgroundColor);
  const luminance = getRelativeLuminance(backgroundRgb);
  const axisTextColor = luminance < 0.45 ? '#f8fafc' : '#1f2937';
  const axisLineReference =
    luminance < 0.45 ? lightenColor(backgroundColor, 0.25) : darkenColor(backgroundColor, 0.15);
  const axisLineColor = d3.color(axisLineReference)?.formatHex() ?? '#d1d5db';

  const paletteFromTheme = (theme?.colors ?? []).filter(Boolean) as string[];
  const mainColor = theme?.mainColor || paletteFromTheme[0] || '#3b82f6';

  const fontFamily = theme?.font?.fontFamily || '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

  const barRounding = Math.max(2, Math.min(16, theme?.itemSpecific?.rounding ?? 4));
  const paddingSetting = theme?.itemSpecific?.padding;
  const barPadding =
    typeof paddingSetting === 'number'
      ? Math.max(0.05, Math.min(0.35, paddingSetting / 100))
      : 0.15;

  const hoverShadowBase = d3.rgb(d3.color(darkenColor(mainColor, 0.55))?.toString() ?? '#0f172a');
  const selectedShadowBase = d3.rgb(d3.color(mainColor)?.toString() ?? '#6366f1');
  const hoverShadow = `rgba(${hoverShadowBase.r}, ${hoverShadowBase.g}, ${hoverShadowBase.b}, ${luminance < 0.45 ? 0.55 : 0.25})`;
  const selectedShadow = `rgba(${selectedShadowBase.r}, ${selectedShadowBase.g}, ${selectedShadowBase.b}, ${luminance < 0.45 ? 0.55 : 0.35})`;

  const tooltipBaseColor = theme?.tooltip?.background ||
    (luminance < 0.45 ? lightenColor(backgroundColor, 0.18) : darkenColor(backgroundColor, 0.35));
  const tooltipColorRgb = toRgb(tooltipBaseColor);
  const tooltipBackground = `rgba(${tooltipColorRgb.r}, ${tooltipColorRgb.g}, ${tooltipColorRgb.b}, 0.70)`;
  const tooltipColor = luminance < 0.45 ? '#0f172a' : '#f8fafc';

  const controlBase =
    luminance < 0.45 ? lightenColor(backgroundColor, 0.22) : darkenColor(backgroundColor, 0.08);
  const controlBackground = controlBase;
  const controlBorder =
    luminance < 0.45 ? lightenColor(controlBase, 0.12) : darkenColor(controlBase, 0.12);
  const controlHoverBackground =
    luminance < 0.45 ? lightenColor(controlBase, 0.18) : darkenColor(controlBase, 0.18);
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
    controlHoverBackground
  };
}

function sendCustomEvent(data: any): void {
  window.parent.postMessage({
    type: 'customEvent',
    data
  }, '*');
}

function sendFilterEvent(filters: ItemFilter[]): void {
  window.parent.postMessage({
    type: 'setFilter',
    filters
  }, '*');
}

interface ChartParams {
  container: HTMLElement;
  data: ItemData['data'];
  slots: Slot[];
  slotConfigurations: SlotConfig[];
  options: Record<string, any> & { theme?: ThemeConfig };
  language: string;
  dimensions: { width: number; height: number };
}

function parseDate(value: any): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  // Fallback to current date if parsing fails
  return new Date();
}

function calculateLegendHeight(groups: string[], totalWidth: number): number {
  const itemWidth = 140;
  const rowHeight = 24;
  const leftMargin = 120;
  const rightMargin = 30;
  const availableWidth = totalWidth - leftMargin - rightMargin;
  
  const itemsPerRow = Math.max(1, Math.floor(availableWidth / itemWidth));
  const numberOfRows = Math.ceil(groups.length / itemsPerRow);
  
  return numberOfRows * rowHeight;
}

function preProcessData(
  data: ItemData['data'],
  taskSlot: Slot,
  startDateSlot: Slot,
  endDateSlot: Slot,
  groupSlot: Slot | undefined,
  slotConfigurations: SlotConfig[]
): GanttTask[] {
  // Check if group slot exists and has content
  const hasGroup = Boolean(groupSlot && groupSlot.content && groupSlot.content.length > 0);
  
  // Determine column indices dynamically based on slot order in manifest
  // The data array order matches the slot order in slotConfigurations, but only includes filled slots
  let taskIndex = -1;
  let startDateIndex = -1;
  let endDateIndex = -1;
  let groupIndex = -1;
  
  // Sort slot configurations by order property to match data array order
  const sortedSlots = [...slotConfigurations].sort((a, b) => (a.order || 0) - (b.order || 0));
  
  // Track the actual data array index (only counting filled slots)
  let dataArrayIndex = 0;
  
  sortedSlots.forEach((slotConfig) => {
    const slot = slotConfig.name === 'name' ? taskSlot :
                 slotConfig.name === 'time' ? startDateSlot :
                 slotConfig.name === 'evolution' ? endDateSlot :
                 slotConfig.name === 'legend' ? groupSlot : null;
    
    // Only assign index if slot is filled, and increment the data array index
    if (slot && slot.content && slot.content.length > 0) {
      if (slotConfig.name === 'name') {
        taskIndex = dataArrayIndex;
      } else if (slotConfig.name === 'time') {
        startDateIndex = dataArrayIndex;
      } else if (slotConfig.name === 'evolution') {
        endDateIndex = dataArrayIndex;
      } else if (slotConfig.name === 'legend') {
        groupIndex = dataArrayIndex;
      }
      dataArrayIndex++;
    }
  });

  return (data ?? []).map((row) => {
    const taskValue = taskIndex >= 0 && row[taskIndex]
      ? (row[taskIndex]?.name?.en || row[taskIndex] || 'Unknown Task')
      : 'Unknown Task';
    const taskName = String(taskValue);

    const startDateValue = startDateIndex >= 0 ? row[startDateIndex] : null;
    const startDate = startDateValue ? parseDate(startDateValue) : new Date();

    const endDateValue = endDateIndex >= 0 ? row[endDateIndex] : null;
    const endDate = endDateValue ? parseDate(endDateValue) : new Date(startDate.getTime() + 86400000);

    // Ensure end date is after start date
    const validEndDate = endDate >= startDate ? endDate : new Date(startDate.getTime() + 86400000);

    const duration = Math.ceil((validEndDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    const groupValue = hasGroup && groupIndex >= 0 && row[groupIndex]
      ? (row[groupIndex]?.name?.en || row[groupIndex] || 'Default')
      : 'Default';
    const group = String(groupValue);

    return {
      taskName,
      startDate,
      endDate: validEndDate,
      group,
      duration,
      columnId: taskIndex >= 0 ? row[taskIndex]?.columnId : undefined,
      datasetId: taskIndex >= 0 ? row[taskIndex]?.datasetId : undefined
    };
  }).sort((a, b) => {
    // Sort by start date, then by task name
    const dateDiff = a.startDate.getTime() - b.startDate.getTime();
    if (dateDiff !== 0) return dateDiff;
    return a.taskName.localeCompare(b.taskName);
  });
}

function createSettingsModal(chartContainer: HTMLElement, theme: ThemeContext, container: HTMLElement, onClose: () => void): HTMLElement {
  const modal = document.createElement('div');
  modal.className = 'settings-modal';
  modal.style.display = 'flex';

  const modalContent = document.createElement('div');
  modalContent.className = 'settings-modal-content';

  const modalHeader = document.createElement('div');
  modalHeader.className = 'settings-modal-header';
  modalHeader.innerHTML = '<h3>Chart Settings</h3>';
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'settings-modal-close';
  closeBtn.innerHTML = '×';
  closeBtn.onclick = () => {
    modal.style.display = 'none';
    onClose();
  };
  modalHeader.appendChild(closeBtn);
  modalContent.appendChild(modalHeader);

  const modalBody = document.createElement('div');
  modalBody.className = 'settings-modal-body';

  // Function to trigger chart re-render
  const triggerRerender = () => {
    const tasks = (container as any).__chartData || [];
    const storedDimensions = (container as any).__chartDimensions || { width: 0, height: 0 };
    
    // Use stored dimensions if available, otherwise fall back to container dimensions
    const width = storedDimensions.width > 0 ? storedDimensions.width : container.clientWidth;
    const height = storedDimensions.height > 0 ? storedDimensions.height : container.clientHeight;
    
    const groups: string[] = Array.from(new Set(tasks.map((t: GanttTask) => t.group)));
    const hasMultipleGroups = groups.length > 1 || (groups.length === 1 && groups[0] !== 'Default');
    const legendHeight = (chartState.settings.legendVisible && hasMultipleGroups) 
      ? calculateLegendHeight(groups, width) 
      : 0;
    
    const margin = { 
      top: chartState.settings.legendPosition === 'top' ? 40 + legendHeight : 40, 
      right: 30, 
      bottom: chartState.settings.legendPosition === 'bottom' ? 60 + legendHeight : 60, 
      left: 120 
    };
    const innerWidth = Math.max(0, width - margin.left - margin.right);
    const innerHeight = Math.max(0, height - margin.top - margin.bottom);
    
    // Remove existing SVG and tooltip
    d3.select(chartContainer).select('svg').remove();
    d3.select(chartContainer).select('.tooltip').remove();
    
    // Re-render chart
    renderChart(
      chartContainer,
      tasks,
      width,
      height,
      margin,
      innerWidth,
      innerHeight,
      theme
    );
  };

  // Legend visibility toggle
  const legendVisibilityGroup = document.createElement('div');
  legendVisibilityGroup.className = 'settings-group';
  
  const legendVisibilityLabel = document.createElement('label');
  legendVisibilityLabel.className = 'settings-label';
  legendVisibilityLabel.textContent = 'Show Legend';
  
  const legendVisibilityToggle = document.createElement('input');
  legendVisibilityToggle.type = 'checkbox';
  legendVisibilityToggle.className = 'settings-toggle';
  legendVisibilityToggle.checked = chartState.settings.legendVisible;
  legendVisibilityToggle.onchange = () => {
    chartState.settings.legendVisible = legendVisibilityToggle.checked;
    triggerRerender();
  };
  
  const toggleWrapper = document.createElement('div');
  toggleWrapper.className = 'settings-toggle-wrapper';
  toggleWrapper.appendChild(legendVisibilityToggle);
  
  legendVisibilityGroup.appendChild(legendVisibilityLabel);
  legendVisibilityGroup.appendChild(toggleWrapper);
  modalBody.appendChild(legendVisibilityGroup);

  // Legend position selector
  const legendPositionGroup = document.createElement('div');
  legendPositionGroup.className = 'settings-group';
  
  const legendPositionLabel = document.createElement('label');
  legendPositionLabel.className = 'settings-label';
  legendPositionLabel.textContent = 'Legend Position';
  
  const legendPositionSelect = document.createElement('select');
  legendPositionSelect.className = 'settings-select';
  legendPositionSelect.value = chartState.settings.legendPosition;
  legendPositionSelect.onchange = () => {
    chartState.settings.legendPosition = legendPositionSelect.value as 'top' | 'bottom';
    triggerRerender();
  };
  
  const topOption = document.createElement('option');
  topOption.value = 'top';
  topOption.textContent = 'Top';
  const bottomOption = document.createElement('option');
  bottomOption.value = 'bottom';
  bottomOption.textContent = 'Bottom';
  
  legendPositionSelect.appendChild(topOption);
  legendPositionSelect.appendChild(bottomOption);
  
  legendPositionGroup.appendChild(legendPositionLabel);
  legendPositionGroup.appendChild(legendPositionSelect);
  modalBody.appendChild(legendPositionGroup);

  modalContent.appendChild(modalBody);
  modal.appendChild(modalContent);

  // Close modal when clicking outside
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
      onClose();
    }
  };

  return modal;
}

function setupContainer(container: HTMLElement, theme: ThemeContext): HTMLElement {
  container.innerHTML = '';
  container.style.background = theme.backgroundColor;

  const chartContainer = document.createElement('div');
  chartContainer.className = 'gantt-chart-container';
  chartContainer.style.background = theme.backgroundColor;
  chartContainer.style.setProperty('--chart-background', theme.backgroundColor);
  chartContainer.style.setProperty('--axis-text-color', theme.axisTextColor);
  chartContainer.style.setProperty('--axis-line-color', theme.axisLineColor);
  chartContainer.style.setProperty('--control-bg', theme.controlBackground);
  chartContainer.style.setProperty('--control-border', theme.controlBorder);
  chartContainer.style.setProperty('--control-text', theme.controlText);
  chartContainer.style.setProperty('--control-hover-bg', theme.controlHoverBackground);
  chartContainer.style.setProperty('--hover-shadow', theme.hoverShadow);
  chartContainer.style.setProperty('--selected-shadow', theme.selectedShadow);
  chartContainer.style.setProperty('--tooltip-bg', theme.tooltipBackground);
  chartContainer.style.setProperty('--tooltip-color', theme.tooltipColor);
  chartContainer.style.setProperty('--bar-radius', `${theme.barRounding}px`);
  chartContainer.style.setProperty('--chart-font-family', theme.fontFamily);
  chartContainer.style.setProperty('--main-color', theme.mainColor);

  if (theme.fontFamily) {
    chartContainer.style.fontFamily = theme.fontFamily;
  }

  container.appendChild(chartContainer);

  const clearFilterBtn = document.createElement('button');
  clearFilterBtn.className = 'clear-filter-btn';
  clearFilterBtn.textContent = 'Clear Filters';
  clearFilterBtn.onclick = () => {
    chartState.selectedTasks.clear();
    d3.selectAll<SVGRectElement, unknown>('.gantt-bar')
      .classed('gantt-bar-selected', false)
      .each(function (this: SVGRectElement) {
        const selection = d3.select(this);
        const baseFill = selection.attr('data-base-fill');
        if (baseFill) {
          selection.attr('fill', baseFill);
        }
        selection
          .attr('stroke', 'none')
          .attr('stroke-width', 0)
          .style('filter', 'none');
      });
    clearFilterBtn.classList.remove('visible');
    sendFilterEvent([]);
  };
  chartContainer.appendChild(clearFilterBtn);

  // Settings button
  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'settings-btn';
  settingsBtn.innerHTML = '⚙️';
  settingsBtn.title = 'Settings';
  settingsBtn.onclick = () => {
    const modal = createSettingsModal(chartContainer, theme, container, () => {
      // Modal closed callback (optional cleanup if needed)
    });
    chartContainer.appendChild(modal);
  };
  chartContainer.appendChild(settingsBtn);

  return chartContainer;
}

function renderChart(
  chartContainer: HTMLElement,
  tasks: GanttTask[],
  width: number,
  height: number,
  margin: { top: number; right: number; bottom: number; left: number },
  innerWidth: number,
  innerHeight: number,
  theme: ThemeContext
): void {
  if (tasks.length === 0) {
    const svg = d3.select(chartContainer)
      .append('svg')
      .attr('width', width)
      .attr('height', height);
    
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', theme.axisTextColor)
      .style('font-size', '14px')
      .text('No tasks to display');
    return;
  }

  const svg = d3.select(chartContainer)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('class', 'gantt-chart-svg');

  if (theme.fontFamily) {
    svg.style('font-family', theme.fontFamily);
  }

  const chart = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Get unique task names and groups
  const taskNames = Array.from(new Set(tasks.map(t => t.taskName)));
  const groups = Array.from(new Set(tasks.map(t => t.group)));
  const hasMultipleGroups = groups.length > 1 || (groups.length === 1 && groups[0] !== 'Default');

  // Calculate date range
  const allDates = tasks.flatMap(t => [t.startDate, t.endDate]);
  const minDate = d3.min(allDates) || new Date();
  const maxDate = d3.max(allDates) || new Date();
  
  // Add padding to date range
  const datePadding = (maxDate.getTime() - minDate.getTime()) * 0.1;
  const paddedMinDate = new Date(minDate.getTime() - datePadding);
  const paddedMaxDate = new Date(maxDate.getTime() + datePadding);

  // Create scales
  const yScale = d3.scaleBand<string>()
    .domain(taskNames)
    .range([0, innerHeight])
    .padding(theme.barPadding);

  const xScale = d3.scaleTime()
    .domain([paddedMinDate, paddedMaxDate])
    .range([0, innerWidth]);

  // Create color scale
  const palette = expandPalette(theme.basePalette, theme.mainColor, Math.max(groups.length, 1));
  const colorScale = d3.scaleOrdinal<string, string>()
    .domain(groups)
    .range(palette);

  // Create axes
  const xAxis = d3.axisBottom(xScale)
    .ticks(Math.max(5, Math.min(10, Math.floor(innerWidth / 80))))
    .tickSizeOuter(0);

  const yAxis = d3.axisLeft(yScale)
    .tickSizeOuter(0);

  // Render X axis
  const xAxisGroup = chart.append('g')
    .attr('class', 'axis x-axis')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(xAxis);

  xAxisGroup.selectAll<SVGTextElement, Date>('text')
    .style('fill', theme.axisTextColor)
    .style('font-size', '11px');

  if (theme.fontFamily) {
    xAxisGroup.selectAll<SVGTextElement, Date>('text').style('font-family', theme.fontFamily);
  }

  xAxisGroup.selectAll<SVGLineElement, unknown>('line').attr('stroke', theme.axisLineColor);
  xAxisGroup.selectAll<SVGPathElement, unknown>('path').attr('stroke', theme.axisLineColor);

  // Render Y axis
  const yAxisGroup = chart.append('g')
    .attr('class', 'axis y-axis')
    .call(yAxis);

  yAxisGroup.selectAll<SVGTextElement, string>('text')
    .style('fill', theme.axisTextColor)
    .style('font-size', '12px');

  if (theme.fontFamily) {
    yAxisGroup.selectAll<SVGTextElement, string>('text').style('font-family', theme.fontFamily);
  }

  yAxisGroup.selectAll<SVGLineElement, unknown>('line').attr('stroke', theme.axisLineColor);
  yAxisGroup.selectAll<SVGPathElement, unknown>('path').attr('stroke', theme.axisLineColor);

  // Create tooltip
  const tooltip = d3.select(chartContainer)
    .append('div')
    .attr('class', 'tooltip')
    .style('opacity', 0)
    .style('background-color', theme.tooltipBackground)
    .style('color', theme.tooltipColor)
    .style('box-shadow', `0 12px 24px ${theme.hoverShadow}`);

  // Render bars
  const barHeight = yScale.bandwidth();
  const barRadius = Math.min(theme.barRounding, barHeight / 2);

  tasks.forEach((task) => {
    const x = xScale(task.startDate);
    const width = xScale(task.endDate) - x;
    const y = yScale(task.taskName) || 0;
    const barId = `${task.taskName}-${task.startDate.getTime()}`;
    const baseFill = colorScale(task.group);

    const bar = chart.append('rect')
      .attr('class', 'gantt-bar')
      .attr('data-bar-id', barId)
      .attr('data-base-fill', baseFill)
      .attr('x', x)
      .attr('y', y)
      .attr('width', Math.max(2, width))
      .attr('height', barHeight)
      .attr('fill', baseFill)
      .attr('rx', barRadius)
      .attr('ry', barRadius);

    bar
      .on('mouseover', function (this: SVGRectElement, event: MouseEvent) {
        const selection = d3.select(this);
        const startingFill = selection.attr('data-base-fill') || baseFill;
        const hoverFill = lightenColor(startingFill, 0.18);

        selection
          .raise()
          .attr('fill', hoverFill)
          .style('filter', `drop-shadow(0 12px 20px ${theme.hoverShadow})`);

        const dateFormatter = new Intl.DateTimeFormat('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });

        const halfWidth = width / 2;
        const tooltipOffset = 16;
        const estimatedTooltipWidth = 220;
        
        const isRightHalf = event.offsetX >= halfWidth;
        const tooltipLeft = isRightHalf 
          ? Math.max(0, event.offsetX - estimatedTooltipWidth - tooltipOffset)
          : event.offsetX + tooltipOffset;

        tooltip
          .interrupt()
          .style('opacity', 1)
          .html(`
            <div class="tooltip-title">${task.taskName}</div>
            <div class="tooltip-row"><span>Start:</span><span>${dateFormatter.format(task.startDate)}</span></div>
            <div class="tooltip-row"><span>End:</span><span>${dateFormatter.format(task.endDate)}</span></div>
            <div class="tooltip-row"><span>Duration:</span><span>${task.duration} day${task.duration !== 1 ? 's' : ''}</span></div>
            ${hasMultipleGroups ? `<div class="tooltip-row"><span>Group:</span><span>${task.group}</span></div>` : ''}
          `)
          .style('left', `${tooltipLeft}px`)
          .style('top', `${Math.max(0, event.offsetY - 80)}px`);
      })
      .on('mouseout', function (this: SVGRectElement) {
        const selection = d3.select(this);
        const startingFill = selection.attr('data-base-fill') || baseFill;
        const barKey = selection.attr('data-bar-id');
        const isSelected = barKey ? chartState.selectedTasks.has(barKey) : false;

        if (isSelected) {
          selection
            .attr('fill', lightenColor(startingFill, 0.25))
            .style('filter', `drop-shadow(0 18px 32px ${theme.selectedShadow})`);
        } else {
          selection
            .attr('fill', startingFill)
            .style('filter', 'none');
        }

        tooltip.transition().duration(120).style('opacity', 0);
      })
      .on('click', function (this: SVGRectElement, event: MouseEvent) {
        event.stopPropagation();
        const selection = d3.select(this);
        const base = selection.attr('data-base-fill') || baseFill;

        if (chartState.selectedTasks.has(barId)) {
          chartState.selectedTasks.delete(barId);
        } else {
          chartState.selectedTasks.add(barId);
        }

        const isSelectedNow = chartState.selectedTasks.has(barId);

        if (isSelectedNow) {
          selection
            .classed('gantt-bar-selected', true)
            .attr('fill', lightenColor(base, 0.25))
            .attr('stroke', theme.axisTextColor)
            .attr('stroke-width', 1.5)
            .style('filter', `drop-shadow(0 20px 36px ${theme.selectedShadow})`);
        } else {
          selection
            .classed('gantt-bar-selected', false)
            .attr('fill', base)
            .attr('stroke', 'none')
            .attr('stroke-width', 0)
            .style('filter', 'none');
        }

        const clearFilterBtn = d3.select(chartContainer).select<HTMLButtonElement>('.clear-filter-btn');
        clearFilterBtn.classed('visible', chartState.selectedTasks.size > 0);

        const filters: ItemFilter[] = [];
        const groupedFilters = new Map<string, Set<string>>();

        Array.from(chartState.selectedTasks).forEach((selectedId) => {
          const selectedTask = tasks.find(t => `${t.taskName}-${t.startDate.getTime()}` === selectedId);
          if (!selectedTask || !chartState.taskSlot?.content[0]) {
            return;
          }
          const categoryContent = chartState.taskSlot.content[0];
          const columnKey = `${categoryContent.columnId || (categoryContent as any).column}:${categoryContent.datasetId || (categoryContent as any).set}`;
          if (!groupedFilters.has(columnKey)) {
            groupedFilters.set(columnKey, new Set());
          }
          groupedFilters.get(columnKey)?.add(selectedTask.taskName);
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
                level: chartState.taskSlot?.content[0]?.level || undefined
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
          taskName: task.taskName,
          startDate: task.startDate.toISOString(),
          endDate: task.endDate.toISOString(),
          duration: task.duration,
          group: task.group
        });
      });
  });

  // Render legend if multiple groups and legend is visible
  if (hasMultipleGroups && chartState.settings.legendVisible) {
    const itemWidth = 140;
    const rowHeight = 24;
    const availableWidth = innerWidth;
    const itemsPerRow = Math.max(1, Math.floor(availableWidth / itemWidth));

    const legendY = chartState.settings.legendPosition === 'top' 
      ? Math.max(16, 20)
      : innerHeight + margin.bottom - calculateLegendHeight(groups, width) + 20;

    const legend = svg
      .append('g')
      .attr('class', 'legend')
      .attr('transform', `translate(${margin.left}, ${legendY})`);

    groups.forEach((group, index) => {
      const row = Math.floor(index / itemsPerRow);
      const col = index % itemsPerRow;
      
      const legendItem = legend
        .append('g')
        .attr('class', 'legend-item')
        .attr('transform', `translate(${col * itemWidth}, ${row * rowHeight})`);

      legendItem
        .append('rect')
        .attr('class', 'legend-color')
        .attr('x', 0)
        .attr('y', -9)
        .attr('width', 14)
        .attr('height', 14)
        .attr('rx', Math.max(barRadius / 2, 2))
        .attr('ry', Math.max(barRadius / 2, 2))
        .attr('fill', colorScale(group));

      legendItem
        .append('text')
        .attr('x', 20)
        .attr('y', 2)
        .style('fill', theme.axisTextColor)
        .style('font-size', '12px')
        .style('font-weight', 500)
        .text(group);
    });
  }
}

export const render = ({
  container,
  data = [],
  slots = [],
  slotConfigurations = [],
  options = {},
  language = 'en',
  dimensions: { width, height } = { width: 0, height: 0 }
}: ChartParams): void => {
  const themeContext = resolveTheme(options.theme);
  (container as any).__themeContext = themeContext;
  const chartContainer = setupContainer(container, themeContext);

  // Store slots in chart state
  chartState.taskSlot = slots.find((s) => s.name === 'name');
  chartState.startDateSlot = slots.find((s) => s.name === 'time');
  chartState.endDateSlot = slots.find((s) => s.name === 'evolution');
  chartState.groupSlot = slots.find((s) => s.name === 'legend');

  const hasTask = chartState.taskSlot?.content?.length! > 0;
  const hasStartDate = chartState.startDateSlot?.content?.length! > 0;
  const hasEndDate = chartState.endDateSlot?.content?.length! > 0;

  // Prepare data for visualization
  let tasks: GanttTask[] = [];

  if (!data.length || !hasTask || !hasStartDate || !hasEndDate) {
    // Generate sample data for empty state
    const sampleTasks: GanttTask[] = [];
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() - 30);

    const taskNames = ['Design Phase', 'Development', 'Testing', 'Deployment', 'Documentation'];
    const groups = ['Team A', 'Team B', 'Team C'];

    taskNames.forEach((taskName, index) => {
      const startDate = new Date(baseDate);
      startDate.setDate(startDate.getDate() + index * 7);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + (Math.random() * 10 + 5));
      
      sampleTasks.push({
        taskName,
        startDate,
        endDate,
        group: groups[index % groups.length],
        duration: Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
      });
    });

    tasks = sampleTasks;
  } else {
    tasks = preProcessData(
      data,
      chartState.taskSlot!,
      chartState.startDateSlot!,
      chartState.endDateSlot!,
      chartState.groupSlot,
      slotConfigurations
    );
  }

  // Calculate legend height
  const groups: string[] = Array.from(new Set(tasks.map(t => t.group)));
  const hasMultipleGroups = groups.length > 1 || (groups.length === 1 && groups[0] !== 'Default');
  const legendHeight = (chartState.settings.legendVisible && hasMultipleGroups) 
    ? calculateLegendHeight(groups, width) 
    : 0;

  // Set up dimensions based on legend position
  const margin = { 
    top: chartState.settings.legendPosition === 'top' ? 40 + legendHeight : 40, 
    right: 30, 
    bottom: chartState.settings.legendPosition === 'bottom' ? 60 + legendHeight : 60, 
    left: 120 
  };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // Render the chart
  renderChart(
    chartContainer,
    tasks,
    width,
    height,
    margin,
    innerWidth,
    innerHeight,
    themeContext
  );

  // Store the chart data and dimensions on the container for reference during resize and settings changes
  (container as any).__chartData = tasks;
  (container as any).__chartDimensions = { width, height };
};

export const resize = ({
  container,
  slots = [],
  slotConfigurations = [],
  options = {},
  language = 'en',
  dimensions: { width, height } = { width: 0, height: 0 }
}: ChartParams): void => {
  // Get the existing state
  const tasks = (container as any).__chartData || [];
  const previousThemeContext = (container as any).__themeContext as ThemeContext | undefined;
  const themeContext = options.theme ? resolveTheme(options.theme) : previousThemeContext ?? resolveTheme(undefined);
  (container as any).__themeContext = themeContext;
  const chartContainer = setupContainer(container, themeContext);

  // Calculate legend height
  const groups: string[] = Array.from(new Set(tasks.map((t: GanttTask) => t.group)));
  const hasMultipleGroups = groups.length > 1 || (groups.length === 1 && groups[0] !== 'Default');
  const legendHeight = (chartState.settings.legendVisible && hasMultipleGroups) 
    ? calculateLegendHeight(groups, width) 
    : 0;

  // Set up dimensions based on legend position
  const margin = { 
    top: chartState.settings.legendPosition === 'top' ? 40 + legendHeight : 40, 
    right: 30, 
    bottom: chartState.settings.legendPosition === 'bottom' ? 60 + legendHeight : 60, 
    left: 120 
  };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // Render chart with existing data
  renderChart(
    chartContainer,
    tasks,
    width,
    height,
    margin,
    innerWidth,
    innerHeight,
    themeContext
  );

  // Maintain state for future resizes
  (container as any).__chartData = tasks;
  (container as any).__chartDimensions = { width, height };
};
