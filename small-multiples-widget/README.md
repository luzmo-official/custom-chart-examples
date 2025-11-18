# Custom Chart – Small Multiples Widget

The **Small Multiples widget** lets you compare many similar charts side by side, making it easy to spot patterns, trends, and outliers across different categories. Instead of cramming all your data into a single dense visualization or having to configure multiple individual visualizations, small multiples break it into a grid of lightweight, repeated charts that share the same structure and scales. This makes comparisons intuitive and visually clean.

### How it works

* **Category-based splits:** You choose a field (such as region, product line, or segment), and the widget creates one miniature chart — called a “multiple” — per value in that field.
* **Automatic grid layout:** The widget arranges each multiple into a responsive grid. As the number of categories grows, the layout adapts so each chart stays legible.
* **Independent scales:** By default, all multiples use independent scales to ensure different sizes of aggregated measures stay readable for eaech chart tile.

### When to use it

Use the Small Multiples widget when:

* **You want to compare the same metric across multiple categories.**
  Example: monthly sales by region, response times by service team, or traffic trends by channel.
* **A single chart becomes too cluttered with lines, bars, or colors.**
  Small multiples replace clutter with clarity, without having to build each individual chart.
* **You want to highlight similarities and differences in shape or pattern.**
  Because the chart designs are identical, differences stand out immediately.

https://github.com/user-attachments/assets/5745cdbf-4bba-4e14-89d8-88c0bb9e40c9

## Using in Luzmo

Upload `bundle.zip` in the Luzmo app in [your Profile settings -> Custom charts](https://app.luzmo.com/settings/custom-charts)

## Development

See Custom Chart Builder repository [luzmo-official/custom-chart-builder](https://github.com/luzmo-official/custom-chart-builder). 

You'll want to copy-paste the `package.json` file and the `src` directory from here into `/projects/custom-chart` of that repository (replacing all existing files).
