// Small shared helpers.

export const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtInt(n) {
  if (n == null || isNaN(n)) return '—';
  return Math.round(n).toLocaleString();
}

export function fmtFloat(n, digits = 2) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export function ymLabel(year, month) {
  return `${MONTHS[month] || month} ${year}`;
}

// Client-side table sort/filter helpers.
export function makeSorter(sortKey, direction) {
  const sign = direction === 'desc' ? -1 : 1;
  return (a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
    return String(av).localeCompare(String(bv)) * sign;
  };
}

export function attachTableSort(table, state, renderFn) {
  table.querySelectorAll('thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = key;
        state.sortDir = 'asc';
      }
      table.querySelectorAll('thead th').forEach(x => x.classList.remove('sort-asc', 'sort-desc'));
      th.classList.add(state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      renderFn();
    });
  });
}
