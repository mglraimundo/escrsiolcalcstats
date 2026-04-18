// Shared export helpers: CSV / high-res PNG / SVG.

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function rowsToCsv(rows, columns) {
  const header = columns.map(c => csvEscape(c.label ?? c.key)).join(',');
  const body = rows.map(r =>
    columns.map(c => csvEscape(c.format ? c.format(r[c.key], r) : r[c.key])).join(',')
  ).join('\n');
  return header + '\n' + body + '\n';
}

export function downloadCsv(filename, rows, columns) {
  const csv = rowsToCsv(rows, columns);
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
}

// Re-render a Chart.js chart at a high resolution onto a detached canvas, return a PNG blob.
// Uses the chart's current config/data so exports match the current filtered view.
export async function chartToHiResPngBlob(chart, { targetWidth = 2400, background = '#ffffff' } = {}) {
  const srcCanvas = chart.canvas;
  const ratio = targetWidth / srcCanvas.clientWidth;
  const h = Math.round(srcCanvas.clientHeight * ratio);
  const w = Math.round(srcCanvas.clientWidth * ratio);

  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  off.style.width = srcCanvas.clientWidth + 'px';
  off.style.height = srcCanvas.clientHeight + 'px';

  // Build a transient container so Chart.js renders with the same layout.
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:fixed;left:-99999px;top:0;width:${srcCanvas.clientWidth}px;height:${srcCanvas.clientHeight}px;`;
  wrap.appendChild(off);
  document.body.appendChild(wrap);

  const { default: Chart } = await import('chart.js/auto');
  const cfg = {
    type: chart.config.type,
    data: JSON.parse(JSON.stringify(chart.config.data)),
    options: {
      ...JSON.parse(JSON.stringify(chart.config.options ?? {})),
      responsive: false,
      animation: false,
      devicePixelRatio: ratio,
    },
  };
  // Paint background first
  const ctx = off.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);

  const clone = new Chart(off, cfg);
  clone.resize(srcCanvas.clientWidth, srcCanvas.clientHeight);
  clone.render();
  // Chart.js paints synchronously here; give it one frame to be safe.
  await new Promise(r => requestAnimationFrame(r));

  const blob = await new Promise(res => off.toBlob(res, 'image/png'));
  clone.destroy();
  wrap.remove();
  return blob;
}

export async function downloadChartPng(chart, filename, opts) {
  const blob = await chartToHiResPngBlob(chart, opts);
  downloadBlob(blob, filename);
}

// Serialize an inline SVG to a standalone SVG file blob.
// Inlines computed styles for the nodes so colors survive outside the page.
function inlineSvgStyles(svg) {
  const clone = svg.cloneNode(true);
  const srcNodes = svg.querySelectorAll('*');
  const dstNodes = clone.querySelectorAll('*');
  const props = ['fill', 'stroke', 'stroke-width', 'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor'];
  srcNodes.forEach((src, i) => {
    const dst = dstNodes[i];
    const cs = window.getComputedStyle(src);
    let inline = dst.getAttribute('style') || '';
    props.forEach(p => {
      const v = cs.getPropertyValue(p);
      if (v && v !== 'none' && v !== 'normal') inline += `${p}:${v};`;
    });
    if (inline) dst.setAttribute('style', inline);
  });
  // Ensure xmlns on the root
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  return clone;
}

export function svgToBlob(svg) {
  const clone = inlineSvgStyles(svg);
  const xml = new XMLSerializer().serializeToString(clone);
  const doc = '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
  return new Blob([doc], { type: 'image/svg+xml;charset=utf-8' });
}

export function downloadSvg(svg, filename) {
  downloadBlob(svgToBlob(svg), filename);
}

export async function svgToPngBlob(svg, { targetWidth = 3000, background = '#ffffff' } = {}) {
  const blob = svgToBlob(svg);
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = url;
    });
    const bbox = svg.getBoundingClientRect();
    const ratio = targetWidth / (bbox.width || svg.viewBox.baseVal.width || 800);
    const w = Math.round((bbox.width || 800) * ratio);
    const h = Math.round((bbox.height || 600) * ratio);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise(res => canvas.toBlob(res, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadSvgAsPng(svg, filename, opts) {
  const blob = await svgToPngBlob(svg, opts);
  downloadBlob(blob, filename);
}

export function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
