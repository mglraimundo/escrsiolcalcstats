import Chart from 'chart.js/auto';
import { fmtInt, fmtFloat } from './util.js';
import { downloadCsv, downloadChartPng, timestamp } from './export.js';

const METRIC_UNITS = {
  AL: 'mm', ACD: 'mm', LT: 'mm', WTW: 'mm',
  K1: 'D', K2: 'D', Kdif: 'D', CCT: 'µm',
  Target: 'D', SIA: 'D', INC: '°',
};

const METRIC_ORDER = ['AL', 'K1', 'K2', 'Kdif', 'ACD', 'LT', 'WTW', 'CCT', 'Target', 'SIA'];

const state = { year: 'all', type: 'all', metric: 'AL', incEye: 'right' };

const LAT_LABELS = { bilateral: 'Bilateral', left_only: 'Left only', right_only: 'Right only' };
const LAT_COLORS = { bilateral: '#0b5cab', left_only: '#1b9e77', right_only: '#d95f02' };
const LAT_KEYS = ['bilateral', 'left_only', 'right_only'];

const GENDER_COLORS = ['#0b5cab', '#d95f02', '#1b9e77', '#7570b3', '#e7298a', '#666666'];

let data = null;
let histChart = null;
let latChart = null;
let genderChart = null;
let incChart = null;

function filteredSummary() {
  return data.summary.filter(r => r.year === state.year && r.type === state.type);
}

function filteredHist() {
  return data.histograms.find(r => r.year === state.year && r.type === state.type && r.metric === state.metric);
}

function filteredSummaryRow() {
  return data.summary.find(r => r.year === state.year && r.type === state.type && r.metric === state.metric);
}

function renderTable(rows) {
  const ordered = METRIC_ORDER
    .map(m => rows.find(r => r.metric === m))
    .filter(Boolean);

  const tbody = document.querySelector('#bio-table tbody');
  tbody.innerHTML = ordered.map(r => `
    <tr class="clickable${r.metric === state.metric ? ' selected' : ''}" data-metric="${r.metric}">
      <td>${r.metric}${METRIC_UNITS[r.metric] ? ' <span class="muted small">(' + METRIC_UNITS[r.metric] + ')</span>' : ''}</td>
      <td class="num">${fmtInt(r.n)}</td>
      <td class="num">${fmtFloat(r.mean, 2)}</td>
      <td class="num">${fmtFloat(r.sd, 2)}</td>
      <td class="num">${fmtFloat(r.min, 2)}</td>
      <td class="num">${fmtFloat(r.p25, 2)}</td>
      <td class="num">${fmtFloat(r.p50, 2)}</td>
      <td class="num">${fmtFloat(r.p75, 2)}</td>
      <td class="num">${fmtFloat(r.max, 2)}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr[data-metric]').forEach(tr => {
    tr.addEventListener('click', () => {
      state.metric = tr.dataset.metric;
      document.getElementById('bio-metric').value = state.metric;
      renderHistogram();
      tbody.querySelectorAll('tr').forEach(r => r.classList.toggle('selected', r === tr));
    });
  });
}

function renderHistogram() {
  const histRow = filteredHist();
  const summaryRow = filteredSummaryRow();
  const edges = data.metric_bins[state.metric];
  if (!histRow || !edges) return;

  const midpoints = edges.slice(0, -1).map((e, i) => +((e + edges[i + 1]) / 2).toFixed(4));
  const labels = midpoints.map(v => v.toFixed(2));
  const counts = histRow.counts;

  const medianIdx = summaryRow
    ? midpoints.findLastIndex(m => m <= summaryRow.p50)
    : -1;

  const medianPlugin = {
    id: 'medianLine',
    afterDraw(chart) {
      if (medianIdx < 0 || !summaryRow) return;
      const { ctx, scales: { x, y } } = chart;
      const xPos = x.getPixelForValue(medianIdx);
      ctx.save();
      ctx.strokeStyle = '#d95f02';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(xPos, y.top);
      ctx.lineTo(xPos, y.bottom);
      ctx.stroke();
      ctx.restore();
    },
  };

  if (histChart) histChart.destroy();
  histChart = new Chart(document.getElementById('bio-hist'), {
    type: 'bar',
    plugins: [medianPlugin],
    data: {
      labels,
      datasets: [{
        label: `${state.metric} (${METRIC_UNITS[state.metric] || ''})`,
        data: counts,
        backgroundColor: '#0b5cab',
        borderWidth: 0,
        categoryPercentage: 1.0,
        barPercentage: 1.0,
      }],
    },
    options: {
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ctx => {
              const i = ctx[0].dataIndex;
              return `${edges[i].toFixed(2)} – ${edges[i + 1].toFixed(2)} ${METRIC_UNITS[state.metric] || ''}`;
            },
            label: ctx => `Count: ${fmtInt(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 12,
            callback(val, i) { return midpoints[i] % 1 === 0 ? midpoints[i] : midpoints[i].toFixed(1); },
          },
          title: { display: true, text: `${state.metric} (${METRIC_UNITS[state.metric] || ''})` },
        },
        y: { beginAtZero: true, ticks: { callback: v => Number(v).toLocaleString() } },
      },
    },
  });
}

function renderDemographics() {
  const dem = data.demographics.find(r => r.year === state.year && r.type === state.type);
  if (!dem) return;

  // Age table
  const age = dem.age;
  const ageTbody = document.querySelector('#bio-age-table tbody');
  const ageRows = [
    ['Valid (18–110)', fmtInt(age.n)],
    ['Missing / excluded', fmtInt(age.null)],
    ['Mean', age.mean != null ? fmtFloat(age.mean, 1) : '—'],
    ['SD',   age.sd   != null ? fmtFloat(age.sd,   1) : '—'],
    ['Min',  age.min  != null ? fmtFloat(age.min,  1) : '—'],
    ['P25',  age.p25  != null ? fmtFloat(age.p25,  1) : '—'],
    ['Median', age.p50 != null ? fmtFloat(age.p50, 1) : '—'],
    ['P75',  age.p75  != null ? fmtFloat(age.p75,  1) : '—'],
    ['Max',  age.max  != null ? fmtFloat(age.max,  1) : '—'],
  ];
  ageTbody.innerHTML = ageRows.map(([label, val]) => `
    <tr><td>${label}</td><td class="num">${val}</td></tr>
  `).join('');

  // Gender chart + table
  const genderEntries = Object.entries(dem.gender).sort((a, b) => b[1] - a[1]);
  const gTotal = genderEntries.reduce((s, [, n]) => s + n, 0);
  const gLabels = genderEntries.map(([k]) => k);
  const gCounts = genderEntries.map(([, n]) => n);

  if (genderChart) genderChart.destroy();
  genderChart = new Chart(document.getElementById('bio-gender-chart'), {
    type: 'doughnut',
    data: {
      labels: gLabels,
      datasets: [{
        data: gCounts,
        backgroundColor: GENDER_COLORS.slice(0, gLabels.length),
        borderColor: '#ffffff',
        borderWidth: 2,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: ctx => `${gLabels[ctx.dataIndex]}: ${fmtInt(gCounts[ctx.dataIndex])} (${(gCounts[ctx.dataIndex] / gTotal * 100).toFixed(1)}%)`,
          },
        },
      },
    },
  });

  const gTbody = document.querySelector('#bio-gender-table tbody');
  gTbody.innerHTML = genderEntries.map(([label, n], i) => `
    <tr>
      <td><span class="swatch" style="background:${GENDER_COLORS[i]}"></span>${label}</td>
      <td class="num">${fmtInt(n)}</td>
      <td class="num">${(n / gTotal * 100).toFixed(1)}%</td>
    </tr>
  `).join('');
}

function renderIncision() {
  const row = data.incision.find(r =>
    r.year === state.year && r.type === state.type && r.eye === state.incEye
  );
  if (!row) return;

  document.getElementById('bio-inc-n').textContent = fmtInt(row.n);

  // Circular histogram chart
  if (incChart) incChart.destroy();
  incChart = new Chart(document.getElementById('bio-inc-chart'), {
    type: 'bar',
    data: {
      labels: row.bin_labels,
      datasets: [{
        label: 'Eyes',
        data: row.bin_counts,
        backgroundColor: '#0b5cab',
        borderWidth: 0,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const pct = row.n ? (ctx.raw / row.n * 100).toFixed(1) : '0.0';
              return `${fmtInt(ctx.raw)} (${pct}%)`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { maxRotation: 45, font: { size: 11 } } },
        y: { beginAtZero: true, ticks: { callback: v => Number(v).toLocaleString() } },
      },
    },
  });

  // Top-10 table
  const topTbody = document.querySelector('#bio-inc-top-table tbody');
  topTbody.innerHTML = row.top.map(r => `
    <tr>
      <td class="num">${r.value}°</td>
      <td class="num">${fmtInt(r.count)}</td>
      <td class="num">${(r.share * 100).toFixed(1)}%</td>
    </tr>
  `).join('');

  // Cluster distribution table — sorted by count desc
  const clusters = row.bin_labels
    .map((label, i) => ({ label, count: row.bin_counts[i] }))
    .sort((a, b) => b.count - a.count);
  const clusterTbody = document.querySelector('#bio-inc-cluster-table tbody');
  clusterTbody.innerHTML = clusters.map(({ label, count }) => {
    const pct = row.n ? (count / row.n * 100).toFixed(1) : '0.0';
    return `<tr>
      <td>${label}</td>
      <td class="num">${fmtInt(count)}</td>
      <td class="num">${pct}%</td>
    </tr>`;
  }).join('');
}

function renderLaterality() {
  const row = data.laterality.find(r => r.year === state.year && r.type === state.type);
  if (!row) return;

  const total = LAT_KEYS.reduce((s, k) => s + row[k], 0);

  if (latChart) latChart.destroy();
  latChart = new Chart(document.getElementById('bio-laterality-chart'), {
    type: 'doughnut',
    data: {
      labels: LAT_KEYS.map(k => LAT_LABELS[k]),
      datasets: [{
        data: LAT_KEYS.map(k => row[k]),
        backgroundColor: LAT_KEYS.map(k => LAT_COLORS[k]),
        borderColor: '#ffffff',
        borderWidth: 2,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: ctx => {
              const k = LAT_KEYS[ctx.dataIndex];
              return `${LAT_LABELS[k]}: ${fmtInt(row[k])} (${(row[k] / total * 100).toFixed(1)}%)`;
            },
          },
        },
      },
    },
  });

  const tbody = document.querySelector('#bio-laterality-table tbody');
  tbody.innerHTML = LAT_KEYS.map(k => `
    <tr>
      <td><span class="swatch" style="background:${LAT_COLORS[k]}"></span>${LAT_LABELS[k]}</td>
      <td class="num">${fmtInt(row[k])}</td>
      <td class="num">${total ? (row[k] / total * 100).toFixed(1) + '%' : '—'}</td>
    </tr>
  `).join('');
}

function render() {
  const rows = filteredSummary();
  renderDemographics();
  renderLaterality();
  renderIncision();
  renderTable(rows);
  renderHistogram();
}

function populateFilters() {
  const years = ['all', ...new Set(data.summary.map(r => r.year).filter(y => y !== 'all'))].sort(
    (a, b) => a === 'all' ? -1 : b === 'all' ? 1 : Number(a) - Number(b)
  );

  const ySel = document.getElementById('bio-year');
  ySel.innerHTML = years.map(y => `<option value="${y}">${y === 'all' ? 'All years' : y}</option>`).join('');
  ySel.addEventListener('change', () => { state.year = ySel.value; render(); });

  const tSel = document.getElementById('bio-type');
  tSel.addEventListener('change', () => { state.type = tSel.value; render(); });

  const incEyeSel = document.getElementById('bio-inc-eye');
  incEyeSel.value = state.incEye;
  incEyeSel.addEventListener('change', e => { state.incEye = e.target.value; renderIncision(); });

  const mSel = document.getElementById('bio-metric');
  mSel.innerHTML = METRIC_ORDER.map(m => `<option value="${m}">${m}</option>`).join('');
  mSel.addEventListener('change', () => {
    state.metric = mSel.value;
    renderTable(filteredSummary());
    renderHistogram();
  });
}

function wireExports() {
  document.getElementById('bio-export-csv').addEventListener('click', () => {
    const rows = filteredSummary();
    const ordered = METRIC_ORDER.map(m => rows.find(r => r.metric === m)).filter(Boolean);
    downloadCsv(`escrs-biometry-${state.year}-${state.type}-${timestamp()}.csv`, ordered, [
      { key: 'metric', label: 'Metric' },
      { key: 'n', label: 'N' },
      { key: 'mean', label: 'Mean' },
      { key: 'sd', label: 'SD' },
      { key: 'min', label: 'Min' },
      { key: 'p25', label: 'P25' },
      { key: 'p50', label: 'Median' },
      { key: 'p75', label: 'P75' },
      { key: 'max', label: 'Max' },
    ]);
  });
}

export function initBiometry(bioData, meta) {
  data = bioData;
  populateFilters();
  wireExports();
  render();
}
