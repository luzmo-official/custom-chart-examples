import { formatter } from '@luzmo/analytics-components-kit/utils';
import type {
  ItemData,
  ItemFilter,
  ItemThemeConfig,
  Slot,
  SlotConfig
} from '@luzmo/dashboard-contents-types';
import * as d3 from 'd3';

interface ChartDataItem {
  x: number; // X-axis value (from x-axis slot)
  y: number; // Y-axis value (aggregated from y-axis slot)
  category: string; // Category for grouping and coloring
  value: number | string; // Allow string values for formatted numbers
  rawValue: number; // Store the raw numeric value for calculations
  columnId?: string; // Add columnId to track which column this data point belongs to
  datasetId?: string; // Add datasetId to track which dataset this data point belongs to
}

// Define custom event data interface
interface CustomEventData {
  type: string;
  data: {
    x: number;
    y: number;
    category: string;
    value: string | number;
    rawValue: number;
  };
}

interface FilterEventData {
  type: string;
  filters: ItemFilter[];
}

// State management for selected points
interface ChartState {
  selectedPoints: Set<string>; // Store unique identifiers for selected points
  xAxisSlot?: Slot;
  yAxisSlot?: Slot;
  categorySlot?: Slot;
  language?: string;
}

// Initialize chart state
const chartState: ChartState = {
  selectedPoints: new Set()
};

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
    type: 'customEvent',
    data
  };

  // Post message to parent window
  window.parent.postMessage(eventData, '*');
}

/**
 * Helper function to send filter events to the parent window
 * @param filters Array of filters to send
 *
 * NOTE: This is a helper method for internal use. You can implement your own filter handling
 * directly in the render/resize methods if needed.
 */
function sendFilterEvent(filters: ItemFilter[]): void {
  const eventData: FilterEventData = {
    type: 'setFilter',
    filters
  };

  // Post message to parent window
  window.parent.postMessage(eventData, '*');
}

// Define parameter types for render and resize functions
interface ChartParams {
  container: HTMLElement;
  data: ItemData['data'];
  slots: Slot[];
  slotConfigurations: SlotConfig[];
  options: Record<string, any> & { theme?: ItemThemeConfig };
  language: string;
  dimensions: { width: number; height: number };
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
  language = 'en',
  dimensions: { width, height } = { width: 0, height: 0 }
}: ChartParams): void => {
  const chartContainer = setupContainer(container);

  // Store slots in chart state
  chartState.xAxisSlot = slots.find((s) => s.name === 'x-axis');
  chartState.yAxisSlot = slots.find((s) => s.name === 'y-axis');
  chartState.categorySlot = slots.find((s) => s.name === 'category');
  chartState.language = language;

  const hasXAxis = chartState.xAxisSlot?.content?.length! > 0;
  const hasYAxis = chartState.yAxisSlot?.content?.length! > 0;
  const hasCategory = chartState.categorySlot?.content?.length! > 0;

  // Prepare data for visualization
  let chartData: ChartDataItem[] = [];

  // Check if we have actual data or need sample data
  if (!data.length || !hasXAxis || !hasYAxis) {
    // Generate sample data for empty state
    const categories = ['Category A', 'Category B', 'Category C', 'Category D', 'Category E'];
    const sampleData = [];

    for (let i = 0; i < categories.length; i++) {
      const xValue = Math.random() * 100; // Random x value
      const yValue = Math.random() * 1000 + 100; // Random y value
      sampleData.push({
        x: xValue,
        y: yValue,
        category: categories[i],
        value: yValue.toString(), // Convert to string for sample data
        rawValue: yValue, // Store the raw value
        columnId: `column_${i}`,
        datasetId: `dataset_${i}`
      });
    }

    chartData = sampleData;
  }
  else {
    // Process real data
    chartData = preProcessData(
      data,
      chartState.xAxisSlot!,
      chartState.yAxisSlot!,
      chartState.categorySlot!
    );
  }

  // Set up dimensions
  const margin = { top: 40, right: 30, bottom: 60, left: 60 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // Render the chart
  renderChart(
    chartContainer,
    chartData,
    width,
    height,
    margin,
    innerWidth,
    innerHeight
  );

  // Store the chart data on the container for reference during resize
  (container as any).__chartData = chartData;
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
  language = 'en',
  dimensions: { width, height } = { width: 0, height: 0 }
}: ChartParams): void => {
  // Get the existing state
  const chartData = (container as any).__chartData || [];
  const newChartContainer = setupContainer(container);

  // Set up dimensions
  const margin = { top: 40, right: 30, bottom: 60, left: 60 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // Render chart with existing data
  renderChart(
    newChartContainer,
    chartData,
    width,
    height,
    margin,
    innerWidth,
    innerHeight
  );

  // Maintain state for future resizes
  (container as any).__chartData = chartData;
};

/**
 * Build query for data retrieval
 * NOTE: This method is OPTIONAL to implement. If not implemented, Luzmo will automatically build a query based on the slot configurations. For more advanced use cases, you can implement this method to build a custom query (e.g. if you need your query to return row-level data instead of aggregated data).
 * @param params Object containing slots and slot configurations
 * @returns Query object for data retrieval
 */
/*
export const buildQuery = ({
  slots,
  slotConfigurations
}: {
  slots: Slot[];
  slotConfigurations: SlotConfig[];
}): ItemQuery => {
  return {
    dimensions: [],
    measures: [],
    limit: { by: 100000 },
    options: {
      locale_id: 'en',
      timezone_id: 'UTC'
    }
  };
};
*/

/**
 * Helper function to render chart with given data and dimensions
 *
 * NOTE: This is a helper method for internal use. You can implement your own chart rendering
 * logic directly in the render/resize methods if needed.
 */
function renderChart(
  chartContainer: HTMLElement,
  chartData: ChartDataItem[],
  width: number,
  height: number,
  margin: { top: number; right: number; bottom: number; left: number },
  innerWidth: number,
  innerHeight: number
): void {
  // Create SVG
  const svg: d3.Selection<SVGSVGElement, unknown, null, undefined> = d3
    .select(chartContainer)
    .append('svg')
    .attr('width', width)
    .attr('height', height);

  // Create chart area
  const chart = svg
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Get unique categories for coloring and sort them alphabetically
  const categories: string[] = Array.from(new Set(chartData.map((d) => d.category))).sort();

  // Create color scale
  const colorScale: d3.ScaleOrdinal<string, string> = d3
    .scaleOrdinal<string>()
    .domain(categories)
    .range(d3.schemeCategory10);

  // Create X scale - numeric scale for x-axis values (include 0 in domain)
  const xExtent = d3.extent(chartData, (d) => d.x) as [number, number];
  const xScale: d3.ScaleLinear<number, number> = d3
    .scaleLinear()
    .domain([Math.min(0, xExtent[0]), xExtent[1]])
    .range([0, innerWidth])
    .nice();

  // Create Y scale - numeric scale for y-axis values (include 0 in domain)
  const yExtent = d3.extent(chartData, (d) => d.y) as [number, number];
  const yScale: d3.ScaleLinear<number, number> = d3
    .scaleLinear()
    .domain([Math.min(0, yExtent[0]), yExtent[1]])
    .range([innerHeight, 0])
    .nice();

  // Create X axis
  chart
    .append('g')
    .attr('class', 'axis x-axis')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(xScale).ticks(Math.ceil(innerWidth / 80)))
    .style('color', 'black');

  // Create Y axis
  chart
    .append('g')
    .attr('class', 'axis y-axis')
    .call(d3.axisLeft(yScale).ticks(5))
    .style('color', 'black');

  // Create tooltip
  const tooltip: d3.Selection<HTMLDivElement, unknown, null, undefined> = d3
    .select(chartContainer)
    .append('div')
    .attr('class', 'tooltip')
    .style('opacity', 0);

  // Create scatter plot points
  chart
    .selectAll('.point')
    .data(chartData)
    .enter()
    .append('circle')
    .attr('class', 'point')
    .attr('cx', (d) => xScale(d.x))
    .attr('cy', (d) => yScale(d.y))
    .attr('r', 6)
    .attr('fill', (d) => colorScale(d.category))
    .attr('stroke', '#fff')
    .attr('stroke-width', 2)
    .on('mouseover', function (event: MouseEvent, d) {
      d3.select(this).transition().duration(200).attr('r', 8);
      tooltip.transition().duration(200).style('opacity', 0.9);
      
      // Get column names from slots using label[language]
      const currentLanguage = chartState.language || 'en';
      const xAxisName = chartState.xAxisSlot?.content?.[0]?.label?.[currentLanguage] || 
                       chartState.xAxisSlot?.content?.[0]?.label?.en || 
                       'X-axis';
      const yAxisName = chartState.yAxisSlot?.content?.[0]?.label?.[currentLanguage] || 
                       chartState.yAxisSlot?.content?.[0]?.label?.en || 
                       'Y-axis';
      const categoryName = chartState.categorySlot?.content?.[0]?.label?.[currentLanguage] || 
                          chartState.categorySlot?.content?.[0]?.label?.en || 
                          'Category';
      
      tooltip
        .html(`<strong>${xAxisName}:</strong> ${d.x.toFixed(2)}<br><strong>${yAxisName}:</strong> ${d.y.toFixed(2)}<br><strong>${categoryName}:</strong> ${d.category}`)
        .style('left', event.offsetX + 10 + 'px')
        .style('top', event.offsetY - 28 + 'px');
    })
    .on('mouseout', function () {
      d3.select(this).transition().duration(200).attr('r', 6);
      tooltip.transition().duration(500).style('opacity', 0);
    })
    .on('click', function (event: MouseEvent, d) {
      // Create unique identifier for this point
      const pointId = `${d.x}-${d.y}-${d.category}`;

      // Toggle selection state
      if (chartState.selectedPoints.has(pointId)) {
        // Remove selection
        chartState.selectedPoints.delete(pointId);
        d3.select(this).classed('point-selected', false);
      } else {
        // Add selection
        chartState.selectedPoints.add(pointId);
        d3.select(this).classed('point-selected', true);
      }

      // Show/hide clear filter button based on selection state
      const clearFilterBtn = d3
        .select(chartContainer)
        .select('.clear-filter-btn');
      clearFilterBtn.classed('visible', chartState.selectedPoints.size > 0);

      // Create filters array based on selected points
      const filters: ItemFilter[] = [];

      // Group selected points by category
      const selectedCategories = new Set<string>();
      Array.from(chartState.selectedPoints).forEach((pointId) => {
        const parts = pointId.split('-');
        const category = parts.slice(2).join('-'); // Handle categories with hyphens
        selectedCategories.add(category);
      });

      if (selectedCategories.size > 0 && chartState.categorySlot?.content?.[0]) {
        const categoryContent = chartState.categorySlot.content[0];
        const uniqueValues = Array.from(selectedCategories);

        filters.push({
          expression: uniqueValues.length > 1 ? '? in ?' : '? = ?',
          parameters: [
            {
              column_id: categoryContent.columnId || categoryContent.column,
              dataset_id: categoryContent.datasetId || categoryContent.set,
              level: categoryContent.level || undefined
            },
            uniqueValues.length > 1 ? uniqueValues : uniqueValues[0]
          ],
          properties: {
            origin: 'filterFromVizItem',
            type: 'where'
          }
        });
      }

      // Send setFilter event
      sendFilterEvent(filters);

      sendCustomEvent({
        x: d.x,
        y: d.y,
        category: d.category,
        value: d.value,
        rawValue: d.rawValue
      });
    });

  // Add Legend
  const legend = svg
    .append('g')
    .attr('class', 'legend')
    .attr('transform', `translate(${margin.left}, ${height - 25})`);

  categories.forEach((category, i) => {
    const legendItem = legend
      .append('g')
      .attr('class', 'legend-item')
      .attr('transform', `translate(${i * 100}, 0)`);

    legendItem
      .append('circle')
      .attr('class', 'legend-color')
      .attr('cx', 6)
      .attr('cy', 6)
      .attr('r', 6)
      .attr('fill', colorScale(category));

    legendItem
      .append('text')
      .attr('x', 18)
      .attr('y', 10)
      .text(category)
      .style('font-size', '12px');
  });
}

/**
 * Helper function to set up chart container
 * @param container Container element
 *
 * NOTE: This is a helper method for internal use. You can implement your own container setup
 * directly in the render/resize methods if needed.
 */
function setupContainer(container: HTMLElement): HTMLElement {
  // Clear container
  container.innerHTML = '';

  // Create chart container
  const chartContainer = document.createElement('div');
  chartContainer.className = 'scatter-plot-container';
  container.appendChild(chartContainer);

  // Add clear filter button
  const clearFilterBtn = document.createElement('button');
  clearFilterBtn.className = 'clear-filter-btn';
  clearFilterBtn.textContent = 'Clear Filters';
  clearFilterBtn.onclick = () => {
    // Clear all selected points
    chartState.selectedPoints.clear();
    // Remove selected class from all points
    d3.selectAll('.point').classed('point-selected', false);
    // Hide clear filter button
    clearFilterBtn.classList.remove('visible');
    // Send empty filters array to clear filters
    sendFilterEvent([]);
  };
  chartContainer.appendChild(clearFilterBtn);

  return chartContainer;
}

/**
 * Helper function to preprocess data for visualization
 * @param data Raw data array
 * @param xAxisSlot X-axis slot configuration
 * @param yAxisSlot Y-axis slot configuration
 * @param categorySlot Category slot configuration
 * @returns Processed data array
 *
 * NOTE: This is a helper method for internal use. You can implement your own data processing
 * directly in the render method if needed.
 */
function preProcessData(
  data: ItemData['data'],
  xAxisSlot: Slot,
  yAxisSlot: Slot,
  categorySlot: Slot
): ChartDataItem[] {
  // Create formatters for each slot
  const formatters = {
    xAxis: xAxisSlot?.content[0]
      ? formatter(xAxisSlot.content[0])
      : (val: any) => Number(val) || 0,
    yAxis: yAxisSlot?.content[0]
      ? formatter(yAxisSlot.content[0])
      : (val: any) => Number(val) || 0,
    category: categorySlot?.content[0]
      ? formatter(categorySlot.content[0], {
        level: categorySlot.content[0].level || 9
      })
      : (val: any) => String(val)
  };

  const hasCategory = categorySlot?.content?.length! > 0;
  const indices = {
    xAxis: 1, // X-axis is the second element (index 1)
    yAxis: 2, // Y-axis is the third element (index 2)
    category: 0 // Category is the first element (index 0)
  };

  // Group data by category to aggregate y-axis values
  const groupedData = new Map<string, { xValues: number[], yValues: number[], row: any }>();
  
  (data ?? []).forEach((row) => {
    // Extract x-axis value (second element)
    const xValue = Number(row[indices.xAxis]) || 0;
    
    // Extract y-axis value (third element)
    const yValue = Number(row[indices.yAxis]) || 0;
    
    // Extract category value (first element) with language-specific name
    const categoryValue = hasCategory 
      ? (row[indices.category]?.name?.en || row[indices.category] || 'Unknown')
      : 'Default';
    
    const category = hasCategory
      ? formatters.category(
        categorySlot.content[0].type === 'datetime'
          ? new Date(categoryValue)
          : categoryValue
      )
      : 'Default';

    if (!groupedData.has(category)) {
      groupedData.set(category, { xValues: [], yValues: [], row });
    }
    
    const groupData = groupedData.get(category)!;
    groupData.xValues.push(xValue);
    groupData.yValues.push(yValue);
  });

  // Convert grouped data to scatter plot points
  return Array.from(groupedData.entries()).map(([category, groupData]) => {
    // Calculate aggregated values
    const avgX = groupData.xValues.reduce((sum, val) => sum + val, 0) / groupData.xValues.length;
    const sumY = groupData.yValues.reduce((sum, val) => sum + val, 0);
    
    return {
      x: avgX,
      y: sumY, // Sum of y-axis values as requested
      category: String(category),
      value: formatters.yAxis(sumY),
      rawValue: sumY,
      columnId: groupData.row[indices.yAxis]?.columnId,
      datasetId: groupData.row[indices.yAxis]?.datasetId
    };
  });
}
