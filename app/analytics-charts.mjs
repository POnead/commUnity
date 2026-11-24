"use strict";

let chartLibraryPromise;
const chartInstances = new Map();
const chartBlue = "#1e5aa8";
const chartMuted = "#64748b";

function loadChartLibrary() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (!chartLibraryPromise) {
    chartLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("../node_modules/chart.js/dist/chart.umd.min.js", import.meta.url).href;
      script.onload = () => {
        if (window.Chart) resolve(window.Chart);
        else reject(new Error("Chart.js loaded without exposing its browser API."));
      };
      script.onerror = () => {
        chartLibraryPromise = null;
        reject(new Error("Chart.js could not be loaded from the local application."));
      };
      document.head.append(script);
    });
  }
  return chartLibraryPromise;
}

function chartConfiguration(canvas, data) {
  const kind = canvas.dataset.analyticsChart;
  const chartType = canvas.dataset.chartType;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const total = data.values.reduce((sum, value) => sum + value, 0);
  const tooltipLabel = (context) => {
    const value = Number(context.raw ?? context.parsed) || 0;
    const reports = `${value} ${value === 1 ? "report" : "reports"}`;
    if (kind === "category" && total) return `${reports} · ${Math.round((value / total) * 100)}%`;
    return reports;
  };
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: reducedMotion ? 0 : 650, easing: "easeOutQuart" },
    interaction: { mode: "nearest", intersect: true },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#123b70",
        titleColor: "#ffffff",
        bodyColor: "#ffffff",
        padding: 10,
        displayColors: chartType === "doughnut",
        callbacks: {
          title: (items) => data.fullLabels[items[0]?.dataIndex] || "",
          label: tooltipLabel,
        },
      },
    },
    onClick: (_event, elements, chart) => {
      const point = elements[0];
      if (point) canvas.dispatchEvent(new CustomEvent("analytics-chart-select", { detail: point.index }));
      chart.canvas.style.cursor = "default";
    },
    onHover: (_event, elements, chart) => {
      chart.canvas.style.cursor = elements.length ? "pointer" : "default";
    },
  };

  if (chartType === "doughnut") {
    return {
      type: chartType,
      data: {
        labels: data.labels,
        datasets: [
          {
            data: data.values,
            backgroundColor: data.colors,
            borderColor: "#ffffff",
            borderWidth: 3,
            hoverOffset: 6,
            spacing: 2,
          },
        ],
      },
      options: { ...baseOptions, cutout: "68%" },
    };
  }

  if (chartType === "bar") {
    const max = Math.max(1, ...data.values);
    return {
      type: chartType,
      data: {
        labels: data.labels,
        datasets: [
          {
            label: "Reports",
            data: data.values,
            backgroundColor: chartBlue,
            hoverBackgroundColor: "#3486d1",
            borderRadius: 4,
            barPercentage: 0.68,
            categoryPercentage: 0.78,
          },
        ],
      },
      options: {
        ...baseOptions,
        indexAxis: "y",
        scales: {
          x: {
            beginAtZero: true,
            suggestedMax: max,
            ticks: { precision: 0, color: chartMuted },
            grid: { color: "#e5ebf3" },
            border: { display: false },
          },
          y: {
            ticks: { autoSkip: false, color: chartMuted },
            grid: { display: false },
            border: { display: false },
          },
        },
      },
    };
  }

  const max = Math.max(1, ...data.values);
  const stepSize = max <= 2 ? 1 : Math.ceil(max / 2);
  return {
    type: chartType,
    data: {
      labels: data.labels,
      datasets: [
        {
          label: "Reports",
          data: data.values,
          borderColor: chartBlue,
          backgroundColor: "rgba(30, 90, 168, 0.1)",
          borderWidth: 3,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointHitRadius: 12,
          pointBackgroundColor: "#ffffff",
          pointBorderColor: chartBlue,
          pointBorderWidth: 2,
          tension: 0.28,
          fill: true,
        },
      ],
    },
    options: {
      ...baseOptions,
      scales: {
        x: {
          ticks: { maxTicksLimit: data.labels.length > 8 ? 6 : data.labels.length, color: chartMuted },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          beginAtZero: true,
          suggestedMax: max,
          ticks: { precision: 0, stepSize, color: chartMuted },
          grid: { color: "#e5ebf3" },
          border: { display: false },
        },
      },
    },
  };
}

function selectedDescription(kind, data, index) {
  const value = data.values[index];
  const reports = `${value} ${value === 1 ? "report" : "reports"}`;
  if (kind === "category") {
    const total = data.values.reduce((sum, count) => sum + count, 0);
    return `${data.fullLabels[index]}: ${reports} (${total ? Math.round((value / total) * 100) : 0}% of reports).`;
  }
  return `${data.fullLabels[index]}: ${reports}.`;
}

export async function initializeAnalyticsCharts(root) {
  const canvases = [...root.querySelectorAll("canvas[data-analytics-chart]")];
  if (!canvases.length) return;

  const Chart = await loadChartLibrary();
  for (const canvas of canvases) {
    if (!canvas.isConnected || chartInstances.has(canvas)) continue;

    const data = JSON.parse(canvas.dataset.chartData);
    const kind = canvas.dataset.analyticsChart;
    const status = root.querySelector(`#${kind}-chart-status`);
    const chart = new Chart(canvas, chartConfiguration(canvas, data));
    const selectIndex = (index) => {
      const activeElement = chart.getDatasetMeta(0).data[index];
      if (!activeElement) return;
      const active = [{ datasetIndex: 0, index }];
      const { x, y } = activeElement.getCenterPoint();
      chart.setActiveElements(active);
      chart.tooltip.setActiveElements(active, { x, y });
      chart.update("none");
      status.textContent = selectedDescription(kind, data, index);
    };
    const onSelect = (event) => selectIndex(event.detail);
    const onKeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      const selected = chart.getActiveElements()[0]?.index ?? (step > 0 ? -1 : 0);
      selectIndex((selected + step + data.values.length) % data.values.length);
    };

    canvas.addEventListener("analytics-chart-select", onSelect);
    canvas.addEventListener("keydown", onKeydown);
    chartInstances.set(canvas, { chart, onKeydown, onSelect });
    canvas.dataset.chartReady = "true";
  }
}

export function destroyAnalyticsCharts() {
  for (const [canvas, instance] of chartInstances) {
    canvas.removeEventListener("keydown", instance.onKeydown);
    canvas.removeEventListener("analytics-chart-select", instance.onSelect);
    instance.chart.destroy();
  }
  chartInstances.clear();
}
