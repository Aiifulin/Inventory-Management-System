// Reports.js

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection, getDocs, query,
  orderBy, limit, doc, getDoc, where
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { initLogoutModal } from "./logout-modal.js";
import { db, auth, storage } from "./firebase.js";


const chartInstances = {};

// ===============================
// DATE RANGE STATE
// ===============================
let activeDateRange = { from: null, to: null };

function setDateRange(from, to) {
  activeDateRange = { from, to };
}

function isInRange(timestamp) {
  if (!activeDateRange.from && !activeDateRange.to) return true;
  if (!timestamp) return false;
  const date = timestamp.seconds
    ? new Date(timestamp.seconds * 1000)
    : new Date(timestamp);
  if (activeDateRange.from && date < activeDateRange.from) return false;
  if (activeDateRange.to   && date > activeDateRange.to)   return false;
  return true;
}

function formatRangeLabel(from, to) {
  if (!from && !to) return "All time";
  const opts = { month: "short", day: "numeric", year: "numeric" };
  return `${from ? from.toLocaleDateString("en-US", opts) : "—"} – ${to ? to.toLocaleDateString("en-US", opts) : "Today"}`;
}

function initDateFilter() {
  const pills      = document.querySelectorAll(".date-pill");
  const customWrap = document.getElementById("customDateWrap");
  const badge      = document.getElementById("activeRangeBadge");
  const btnApply   = document.getElementById("btnApplyDate");

  pills.forEach(pill => {
    pill.addEventListener("click", () => {
      pills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");

      const range = pill.dataset.range;
      const now   = new Date();
      now.setHours(23, 59, 59, 999);

      if (range === "custom") { customWrap.classList.add("visible"); return; }
      customWrap.classList.remove("visible");

      if (range === "all") {
        setDateRange(null, null);
        if (badge) badge.textContent = "All time";
      } else {
        const from = new Date();
        if (range === "30d") from.setDate(from.getDate() - 30);
        else if (range === "3m") from.setMonth(from.getMonth() - 3);
        else if (range === "1y") from.setFullYear(from.getFullYear() - 1);
        from.setHours(0, 0, 0, 0);
        setDateRange(from, now);
        if (badge) badge.textContent = formatRangeLabel(from, now);
      }
      loadAllCharts();
    });
  });

  if (btnApply) {
    btnApply.addEventListener("click", () => {
      const fromVal = document.getElementById("dateFrom").value;
      const toVal   = document.getElementById("dateTo").value;
      if (!fromVal || !toVal) { alert("Please select both a start and end date."); return; }
      const from = new Date(fromVal); from.setHours(0, 0, 0, 0);
      const to   = new Date(toVal);   to.setHours(23, 59, 59, 999);
      if (from > to) { alert("Start date must be before end date."); return; }
      setDateRange(from, to);
      if (badge) badge.textContent = formatRangeLabel(from, to);
      loadAllCharts();
    });
  }
}

// ===============================
// USER / AUTH
// ===============================
async function getCachedUserData(uid) {
  const key    = `user_data_${uid}`;
  const cached = sessionStorage.getItem(key);
  if (cached) return JSON.parse(cached);
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      sessionStorage.setItem(key, JSON.stringify(snap.data()));
      return snap.data();
    }
  } catch (e) { console.error(e); }
  return null;
}

// ================================================
// AUTH
// ================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }

  const main = document.getElementById('mainContent');

  const [userData] = await Promise.all([
    getCachedUserData(user.uid),
    loadAllCharts()
  ]);

  const isAdmin = userData?.role?.toLowerCase() === 'admin';
  const nameEl  = document.getElementById('userNameDisplay');
  if (nameEl) nameEl.textContent = userData?.name || "User";

  if (!isAdmin) {
    main.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;
                  justify-content:center;height:60vh;text-align:center;
                  color:var(--text-secondary);">
        <i class="fas fa-lock" style="font-size:48px;margin-bottom:16px;"></i>
        <h2 style="margin:0 0 8px;color:var(--text-main);font-size:20px;">Access Denied</h2>
        <p style="margin:0;font-size:14px;">You do not have permission to view Reports.</p>
      </div>`;
  } else {
    attachReportListeners();
  }

  main.style.visibility = 'visible';

  const doSignOut = () => {
    localStorage.removeItem("user_session");
    localStorage.removeItem("user_uid");
    localStorage.removeItem("user_role");
    sessionStorage.clear();
    signOut(auth).then(() => window.location.replace("index.html")).catch(() => window.location.replace("index.html"));
  };
  const openLogoutModal = initLogoutModal(doSignOut);
  window.logout = function () { if (openLogoutModal) openLogoutModal(); };
});

// ===============================
// CHART HELPERS
// ===============================
function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
function chartTextColor() { return isDark() ? '#cbd5e1' : '#475569'; }
function chartGridColor() { return isDark() ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'; }

function destroyChart(id) {
  if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}

function showChart(canvasId, loadingId) {
  const canvas  = document.getElementById(canvasId);
  const loading = document.getElementById(loadingId);
  if (canvas)  canvas.style.display  = 'block';
  if (loading) loading.style.display = 'none';
}

// ===============================
// LOAD ALL CHARTS
// ===============================
async function loadAllCharts() {
  try {
    const currentYear = new Date().getFullYear();
    const targetYear  = activeDateRange.from ? activeDateRange.from.getFullYear() : currentYear;
    const prevYear    = targetYear - 1;

    // Fetch years range for tx — cover all years if "all time"
    const yearsToFetch = [];
    if (!activeDateRange.from) {
      // All time: fetch current and previous year minimum
      yearsToFetch.push(currentYear, prevYear);
    } else {
      for (let y = activeDateRange.from.getFullYear(); y <= (activeDateRange.to?.getFullYear() || currentYear); y++) {
        yearsToFetch.push(y);
      }
      if (!yearsToFetch.includes(prevYear)) yearsToFetch.push(prevYear);
    }

    const txSnaps = await Promise.all(
      yearsToFetch.map(y =>
        getDocs(query(collection(db, "stock_transactions", String(y), "transactions"), orderBy("createdAt", "asc")))
      )
    );
    const allTxDocs = txSnaps.flatMap(snap => snap.docs);

    const [productsSnap, categoriesSnap, activitiesSnap] = await Promise.all([
      getDocs(collection(db, "products")),
      getDocs(collection(db, "categories")),
      getDocs(query(collection(db, "activities"), orderBy("timestamp", "desc"), limit(500)))
    ]);

    renderInventoryChart(productsSnap);
    renderCategoryChart(productsSnap, categoriesSnap);
    renderLowStockChart(productsSnap);
    renderActivityTimelineChart(activitiesSnap);       // ✅ NEW: replaces old activity donut
    renderInventorySummaryBanner(productsSnap, allTxDocs); // ✅ IMPROVED: with trend indicators
    renderStockMovementChart(allTxDocs, targetYear, prevYear);
    renderTopMovedProductsChart(allTxDocs);            // ✅ NEW
    renderSalesTrendChart(allTxDocs);                  // ✅ NEW
    renderDeadStockChart(productsSnap, allTxDocs);     // ✅ NEW

  } catch (err) {
    console.error("Chart load error:", err);
  }
}

// ===============================
// CHART HELPERS — TREND
// ===============================
function getTrendIndicator(current, previous) {
  if (previous === 0 && current === 0) return { text: "—", cls: "trend-neutral", icon: "" };
  if (previous === 0) return { text: "New", cls: "trend-up", icon: "↑" };
  const pct = ((current - previous) / previous) * 100;
  const abs = Math.abs(pct).toFixed(1);
  if (pct > 0)  return { text: `↑ ${abs}%`, cls: "trend-up",      icon: "↑" };
  if (pct < 0)  return { text: `↓ ${abs}%`, cls: "trend-down",    icon: "↓" };
  return { text: "→ 0%", cls: "trend-neutral", icon: "→" };
}

// ===============================
// IMPROVED: INVENTORY SUMMARY BANNER with trend indicators
// ===============================
function renderInventorySummaryBanner(productsSnap, allTxDocs) {
  const now   = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  let totalProducts = 0, totalStock = 0, totalValue = 0;
  productsSnap.forEach(docSnap => {
    const p = docSnap.data();
    if (p.archived === true) return;
    totalProducts++;
    totalStock += Number(p.stock) || 0;
    totalValue += (Number(p.stock) || 0) * (Number(p.price) || 0);
  });

  // Count units sold this month vs last month from tx docs
  let soldThisMonth = 0, soldLastMonth = 0;
  allTxDocs.forEach(docSnap => {
    const d = docSnap.data();
    if (d.type !== "Sold" || d.status === "Cancelled") return;
    const ts = d.createdAt?.seconds ? new Date(d.createdAt.seconds * 1000) : null;
    if (!ts) return;
    const qty = Number(d.qty) || 0;
    if (ts >= thisMonthStart) soldThisMonth += qty;
    else if (ts >= lastMonthStart && ts <= lastMonthEnd) soldLastMonth += qty;
  });

  // Stock ins this month vs last
  let stockInThis = 0, stockInLast = 0;
  allTxDocs.forEach(docSnap => {
    const d = docSnap.data();
    if (d.type !== "Stock In" || d.status === "Cancelled") return;
    const ts = d.createdAt?.seconds ? new Date(d.createdAt.seconds * 1000) : null;
    if (!ts) return;
    const qty = Number(d.qty) || 0;
    if (ts >= thisMonthStart) stockInThis += qty;
    else if (ts >= lastMonthStart && ts <= lastMonthEnd) stockInLast += qty;
  });

  const soldTrend    = getTrendIndicator(soldThisMonth, soldLastMonth);
  const stockInTrend = getTrendIndicator(stockInThis, stockInLast);

  const banner = document.getElementById('inventorySummaryBanner');
  if (banner) {
    banner.style.display = 'flex';
    banner.innerHTML = `
      <div class="summary-stat">
        <i class="fas fa-boxes-stacked"></i>
        <div>
          <span class="summary-label">Total Products</span>
          <span class="summary-value">${totalProducts.toLocaleString()}</span>
        </div>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-stat">
        <i class="fas fa-cubes"></i>
        <div>
          <span class="summary-label">Total Stock Units</span>
          <span class="summary-value">${totalStock.toLocaleString()}</span>
        </div>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-stat highlight">
        <i class="fas fa-peso-sign"></i>
        <div>
          <span class="summary-label">Total Inventory Value</span>
          <span class="summary-value">₱${totalValue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-stat">
        <i class="fas fa-tag"></i>
        <div>
          <span class="summary-label">Units Sold This Month</span>
          <span class="summary-value">${soldThisMonth.toLocaleString()} <span class="trend-badge ${soldTrend.cls}">${soldTrend.text}</span></span>
          <span class="summary-sublabel">vs last month (${soldLastMonth})</span>
        </div>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-stat">
        <i class="fas fa-arrow-down"></i>
        <div>
          <span class="summary-label">Stock In This Month</span>
          <span class="summary-value">${stockInThis.toLocaleString()} <span class="trend-badge ${stockInTrend.cls}">${stockInTrend.text}</span></span>
          <span class="summary-sublabel">vs last month (${stockInLast})</span>
        </div>
      </div>
    `;
  }
}

// ===============================
// NEW CHART: ACTIVITY TIMELINE (replaces donut)
// ===============================
function renderActivityTimelineChart(activitiesSnap) {
  // Build daily counts for last 30 days
  const now = new Date();
  const days = 30;
  const buckets = {};

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    buckets[key] = { added: 0, updated: 0, other: 0 };
  }

  activitiesSnap.forEach(docSnap => {
    const log = docSnap.data();
    if (!log.timestamp?.seconds) return;
    const date = new Date(log.timestamp.seconds * 1000);
    const key  = date.toISOString().split('T')[0];
    if (!buckets[key]) return;
    const action = (log.action || "").toLowerCase();
    if (action.includes("add"))                               buckets[key].added++;
    else if (action.includes("edit") || action.includes("update") || action.includes("status")) buckets[key].updated++;
    else                                                      buckets[key].other++;
  });

  const labels  = Object.keys(buckets).map(k => {
    const d = new Date(k);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });
  const addedData   = Object.values(buckets).map(b => b.added);
  const updatedData = Object.values(buckets).map(b => b.updated);
  const otherData   = Object.values(buckets).map(b => b.other);

  destroyChart('chartActivity');
  showChart('chartActivity', 'chartLoadingActivity');

  const ctx = document.getElementById('chartActivity').getContext('2d');
  chartInstances['chartActivity'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Added',
          data: addedData,
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34,197,94,0.08)',
          tension: 0.4, fill: true, pointRadius: 2, borderWidth: 2
        },
        {
          label: 'Updated/Status',
          data: updatedData,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.06)',
          tension: 0.4, fill: true, pointRadius: 2, borderWidth: 2
        },
        {
          label: 'Other',
          data: otherData,
          borderColor: '#94a3b8',
          backgroundColor: 'rgba(148,163,184,0.04)',
          tension: 0.4, fill: true, pointRadius: 2, borderWidth: 1.5
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true, position: 'top',
          labels: { color: chartTextColor(), font: { size: 11 }, boxWidth: 10, padding: 10 }
        },
        tooltip: {
          callbacks: {
            title: (items) => `${items[0].label}`,
            label: ctx => ` ${ctx.dataset.label}: ${ctx.raw} action(s)`
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: chartTextColor(), font: { size: 10 },
            maxRotation: 0, autoSkip: true, maxTicksLimit: 10
          },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: { color: chartTextColor(), font: { size: 11 }, stepSize: 1 },
          grid: { color: chartGridColor() }
        }
      }
    }
  });

  // Clear old legend
  const legend = document.getElementById('legendActivity');
  if (legend) legend.innerHTML = '';
}

// ===============================
// NEW CHART: TOP 5 MOST MOVED PRODUCTS
// ===============================
function renderTopMovedProductsChart(allTxDocs) {
  const productTotals = {};

  allTxDocs.forEach(docSnap => {
    const d = docSnap.data();
    if (d.status === "Cancelled") return;
    if (!isInRange(d.createdAt)) return;
    const name = d.productName || d.productId || "Unknown";
    const qty  = Number(d.qty) || 0;
    if (!productTotals[name]) productTotals[name] = { stockIn: 0, sold: 0, total: 0 };
    if (d.type === "Stock In") productTotals[name].stockIn += qty;
    else                       productTotals[name].sold    += qty;
    productTotals[name].total += qty;
  });

  const sorted = Object.entries(productTotals)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5);

  const labels   = sorted.map(([name]) => name);
  const stockIn  = sorted.map(([, v]) => v.stockIn);
  const sold     = sorted.map(([, v]) => v.sold);

  destroyChart('chartTopMoved');
  showChart('chartTopMoved', 'chartLoadingTopMoved');

  const canvas = document.getElementById('chartTopMoved');
  if (!canvas) return;

  if (sorted.length === 0) {
    canvas.style.display = 'none';
    const empty = document.getElementById('chartTopMovedEmpty');
    if (empty) empty.style.display = 'flex';
    return;
  }

  const ctx = canvas.getContext('2d');
  chartInstances['chartTopMoved'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Stock In',  data: stockIn, backgroundColor: '#22c55e', borderRadius: 4, borderSkipped: false },
        { label: 'Stock Out', data: sold,    backgroundColor: '#3b82f6', borderRadius: 4, borderSkipped: false }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true, position: 'top',
          labels: { color: chartTextColor(), font: { size: 11 }, boxWidth: 10, padding: 10 }
        },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw.toLocaleString()} units` } }
      },
      scales: {
        x: {
          beginAtZero: true, stacked: false,
          ticks: { color: chartTextColor(), font: { size: 11 } },
          grid: { color: chartGridColor() }
        },
        y: {
          ticks: {
            color: chartTextColor(), font: { size: 11 },
            callback: (val, idx) => {
              const label = labels[idx];
              return label.length > 18 ? label.substring(0, 18) + '…' : label;
            }
          },
          grid: { display: false }
        }
      }
    }
  });
}

// ===============================
// NEW CHART: SALES TREND (units sold over time)
// ===============================
function renderSalesTrendChart(allTxDocs) {
  // Group sold qty by month
  const monthlyData = {};

  allTxDocs.forEach(docSnap => {
    const d = docSnap.data();
    if (d.type !== "Sold" || d.status === "Cancelled") return;
    if (!isInRange(d.createdAt)) return;
    const ts = d.createdAt?.seconds ? new Date(d.createdAt.seconds * 1000) : null;
    if (!ts) return;
    const key = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}`;
    monthlyData[key] = (monthlyData[key] || 0) + (Number(d.qty) || 0);
  });

  const sorted = Object.entries(monthlyData).sort((a, b) => a[0].localeCompare(b[0]));
  const labels = sorted.map(([k]) => {
    const [yr, mo] = k.split('-');
    return new Date(Number(yr), Number(mo) - 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  });
  const values = sorted.map(([, v]) => v);

  destroyChart('chartSalesTrend');
  showChart('chartSalesTrend', 'chartLoadingSalesTrend');

  const canvas = document.getElementById('chartSalesTrend');
  if (!canvas) return;

  if (sorted.length === 0) {
    canvas.style.display = 'none';
    const empty = document.getElementById('chartSalesTrendEmpty');
    if (empty) empty.style.display = 'flex';
    return;
  }

  const ctx = canvas.getContext('2d');

  // Gradient fill
  const gradient = ctx.createLinearGradient(0, 0, 0, 260);
  gradient.addColorStop(0, isDark() ? 'rgba(59,130,246,0.25)' : 'rgba(59,130,246,0.15)');
  gradient.addColorStop(1, 'rgba(59,130,246,0)');

  chartInstances['chartSalesTrend'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Units Sold',
        data: values,
        borderColor: '#3b82f6',
        backgroundColor: gradient,
        tension: 0.4, fill: true,
        pointRadius: 4, pointBackgroundColor: '#3b82f6',
        pointHoverRadius: 6, borderWidth: 2.5
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` Units sold: ${ctx.raw.toLocaleString()}`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: chartTextColor(), font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: { color: chartTextColor(), font: { size: 11 }, stepSize: 1 },
          grid: { color: chartGridColor() }
        }
      }
    }
  });
}

// ===============================
// NEW CHART: DEAD STOCK
// ===============================
function renderDeadStockChart(productsSnap, allTxDocs) {
  const DEAD_DAYS = 90;
  const cutoff    = new Date();
  cutoff.setDate(cutoff.getDate() - DEAD_DAYS);

  // Build set of productIds/names that had a transaction recently
  const recentlyMoved = new Set();
  allTxDocs.forEach(docSnap => {
    const d  = docSnap.data();
    const ts = d.createdAt?.seconds ? new Date(d.createdAt.seconds * 1000) : null;
    if (ts && ts >= cutoff) {
      if (d.productId)   recentlyMoved.add(d.productId);
      if (d.productName) recentlyMoved.add(d.productName);
    }
  });

  const deadItems = [];
  productsSnap.forEach(docSnap => {
    const p     = docSnap.data();
    const id    = docSnap.id;
    const stock = Number(p.stock) || 0;
    if (p.archived === true || stock === 0) return;
    if (!recentlyMoved.has(id) && !recentlyMoved.has(p.name)) {
      deadItems.push({ name: p.name || id, stock, value: stock * (Number(p.price) || 0) });
    }
  });

  deadItems.sort((a, b) => b.value - a.value);
  const top = deadItems.slice(0, 8);

  const canvas   = document.getElementById('chartDeadStock');
  const loadingEl = document.getElementById('chartLoadingDeadStock');
  const emptyEl  = document.getElementById('chartDeadStockEmpty');
  const countEl  = document.getElementById('deadStockCount');

  if (loadingEl) loadingEl.style.display = 'none';
  if (countEl)   countEl.textContent = `${deadItems.length} product${deadItems.length !== 1 ? 's' : ''} with no movement in ${DEAD_DAYS}+ days`;

  if (top.length === 0) {
    if (emptyEl) emptyEl.style.display = 'flex';
    if (canvas)  canvas.style.display  = 'none';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  if (canvas)  canvas.style.display  = 'block';

  destroyChart('chartDeadStock');
  const ctx = canvas.getContext('2d');
  chartInstances['chartDeadStock'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top.map(i => i.name.length > 18 ? i.name.substring(0, 18) + '…' : i.name),
      datasets: [
        {
          label: 'Stock Units',
          data: top.map(i => i.stock),
          backgroundColor: 'rgba(245,158,11,0.7)',
          borderColor: '#f59e0b', borderWidth: 1,
          borderRadius: 4, borderSkipped: false,
          yAxisID: 'y'
        },
        {
          label: 'Tied-up Value (₱)',
          data: top.map(i => i.value),
          backgroundColor: 'rgba(239,68,68,0.15)',
          borderColor: '#ef4444', borderWidth: 1.5,
          borderRadius: 4, borderSkipped: false,
          type: 'bar', yAxisID: 'y2'
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true, position: 'top',
          labels: { color: chartTextColor(), font: { size: 11 }, boxWidth: 10, padding: 10 }
        },
        tooltip: {
          callbacks: {
            label: ctx => ctx.datasetIndex === 0
              ? ` Stock: ${ctx.raw.toLocaleString()} units`
              : ` Value: ₱${Number(ctx.raw).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: chartTextColor(), font: { size: 10 }, maxRotation: 30 },
          grid: { display: false }
        },
        y: {
          beginAtZero: true, position: 'left',
          ticks: { color: '#f59e0b', font: { size: 11 } },
          grid: { color: chartGridColor() },
          title: { display: true, text: 'Units', color: chartTextColor(), font: { size: 11 } }
        },
        y2: {
          beginAtZero: true, position: 'right',
          ticks: {
            color: '#ef4444', font: { size: 11 },
            callback: v => `₱${Number(v).toLocaleString()}`
          },
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'Value (₱)', color: chartTextColor(), font: { size: 11 } }
        }
      }
    }
  });
}

// ===============================
// CHART: STOCK MOVEMENT (existing, improved)
// ===============================
function renderStockMovementChart(txDocs, targetYear, prevYear) {
  const monthNames   = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const thisYearData = Array(12).fill(0).map(() => ({ stockIn: 0, sold: 0 }));
  const lastYearData = Array(12).fill(0).map(() => ({ stockIn: 0, sold: 0 }));

  txDocs.forEach(docSnap => {
    const d  = docSnap.data();
    if (d.status === "Cancelled") return;
    const ts = d.createdAt?.seconds ? new Date(d.createdAt.seconds * 1000) : null;
    if (!ts) return;
    const yr  = ts.getFullYear();
    const mo  = ts.getMonth();
    const qty = Number(d.qty) || 0;
    if (yr === targetYear) {
      if (d.type === "Stock In") thisYearData[mo].stockIn += qty;
      else                       thisYearData[mo].sold    += qty;
    } else if (yr === prevYear) {
      if (d.type === "Stock In") lastYearData[mo].stockIn += qty;
      else                       lastYearData[mo].sold    += qty;
    }
  });

  destroyChart("chartStock");
  destroyChart("chartStockCompare");
  showChart("chartStock", "chartLoadingStock");

  const textColor = chartTextColor();
  const gridColor = chartGridColor();

  const baseOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: "top", labels: { color: textColor, font: { size: 11 }, boxWidth: 12, padding: 10 } },
      tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw.toLocaleString()} units` } }
    },
    scales: {
      x: { ticks: { color: textColor, font: { size: 11 }, autoSkip: false, maxRotation: 0 }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { color: textColor, font: { size: 11 }, stepSize: 1 }, grid: { color: gridColor } }
    }
  };

  const ctx = document.getElementById("chartStock").getContext("2d");
  chartInstances["chartStock"] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: monthNames,
      datasets: [
        { label: `Stock In (${targetYear})`,  data: thisYearData.map(m => m.stockIn), backgroundColor: "#22c55e", borderRadius: 4, borderSkipped: false },
        { label: `Stock Out (${targetYear})`, data: thisYearData.map(m => m.sold),    backgroundColor: "#3b82f6", borderRadius: 4, borderSkipped: false }
      ]
    },
    options: baseOpts
  });

  const ctxCmp = document.getElementById("chartStockCompare").getContext("2d");
  showChart("chartStockCompare", null);
  chartInstances["chartStockCompare"] = new Chart(ctxCmp, {
    type: "bar",
    data: {
      labels: monthNames,
      datasets: [
        { label: `Stock In (${prevYear})`,  data: lastYearData.map(m => m.stockIn), backgroundColor: "rgba(34,197,94,0.4)",  borderColor: "#22c55e", borderWidth: 1, borderRadius: 4, borderSkipped: false },
        { label: `Stock Out (${prevYear})`, data: lastYearData.map(m => m.sold),    backgroundColor: "rgba(59,130,246,0.4)", borderColor: "#3b82f6", borderWidth: 1, borderRadius: 4, borderSkipped: false }
      ]
    },
    options: baseOpts
  });
}

// ===============================
// CHART 1: INVENTORY DONUT
// ===============================
function renderInventoryChart(productsSnap) {
  let inStock = 0, lowStock = 0, outOfStock = 0;
  productsSnap.forEach(docSnap => {
    const p = docSnap.data();
    if (p.archived === true) return;
    if (!isInRange(p.createdAt)) return;
    const stock = Number(p.stock) || 0;
    const threshold = Number(p.lowStockThreshold) || 10;
    if (stock === 0) outOfStock++;
    else if (stock <= threshold) lowStock++;
    else inStock++;
  });

  destroyChart('chartInventory');
  showChart('chartInventory', 'chartLoadingInventory');

  const ctx = document.getElementById('chartInventory').getContext('2d');
  chartInstances['chartInventory'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['In Stock', 'Low Stock', 'Out of Stock'],
      datasets: [{ data: [inStock, lowStock, outOfStock], backgroundColor: ['#22c55e', '#f59e0b', '#ef4444'], borderWidth: 0, hoverOffset: 6 }]
    },
    options: {
      cutout: '68%', responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} product(s)` } } }
    }
  });

  const legend = document.getElementById('legendInventory');
  if (legend) {
    const colors = ['#22c55e', '#f59e0b', '#ef4444'];
    const labels = ['In Stock', 'Low Stock', 'Out of Stock'];
    const values = [inStock, lowStock, outOfStock];
    legend.innerHTML = labels.map((l, i) => `
      <div class="legend-item">
        <span class="legend-dot" style="background:${colors[i]}"></span>
        <span class="legend-label">${l}</span>
        <span class="legend-count">${values[i]}</span>
      </div>`).join('');
  }
}

// ===============================
// CHART 2: CATEGORY BAR
// ===============================
function renderCategoryChart(productsSnap, categoriesSnap) {
  const categoryCount = {};
  categoriesSnap.forEach(docSnap => {
    const c = docSnap.data();
    if (c.archived !== true && c.name) categoryCount[c.name] = 0;
  });
  productsSnap.forEach(docSnap => {
    const p = docSnap.data();
    if (p.archived === true) return;
    if (!isInRange(p.createdAt)) return;
    const cat = p.category || 'Uncategorized';
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  });

  const sorted  = Object.entries(categoryCount).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const labels  = sorted.map(([k]) => k);
  const values  = sorted.map(([, v]) => v);
  const palette = ['#3b82f6','#06b6d4','#8b5cf6','#f59e0b','#22c55e','#ef4444','#ec4899','#f97316'];

  destroyChart('chartCategory');
  showChart('chartCategory', 'chartLoadingCategory');

  const ctx = document.getElementById('chartCategory').getContext('2d');
  chartInstances['chartCategory'] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Products', data: values, backgroundColor: labels.map((_, i) => palette[i % palette.length]), borderRadius: 6, borderSkipped: false }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.raw} product(s)` } } },
      scales: {
        x: { beginAtZero: true, ticks: { color: chartTextColor(), stepSize: 1, font: { size: 11 } }, grid: { color: chartGridColor() } },
        y: { ticks: { color: chartTextColor(), font: { size: 11 } }, grid: { display: false } }
      }
    }
  });
}

// ===============================
// CHART 3: LOW STOCK BAR
// ===============================
function renderLowStockChart(productsSnap) {
  const lowItems = [];
  productsSnap.forEach(docSnap => {
    const p = docSnap.data();
    if (p.archived === true) return;
    if (!isInRange(p.createdAt)) return;
    const stock = Number(p.stock) || 0;
    const threshold = Number(p.lowStockThreshold) || 10;
    if (stock <= threshold) lowItems.push({ name: p.name || 'Unknown', stock, threshold });
  });
  lowItems.sort((a, b) => a.stock - b.stock);
  const top = lowItems.slice(0, 8);

  const loadingEl = document.getElementById('chartLoadingLowStock');
  const emptyEl   = document.getElementById('chartLowStockEmpty');
  const canvas    = document.getElementById('chartLowStock');

  if (loadingEl) loadingEl.style.display = 'none';
  if (top.length === 0) {
    if (emptyEl) emptyEl.style.display = 'flex';
    if (canvas)  canvas.style.display  = 'none';
    return;
  }
  if (canvas)  canvas.style.display  = 'block';
  if (emptyEl) emptyEl.style.display = 'none';

  destroyChart('chartLowStock');
  const ctx = canvas.getContext('2d');
  chartInstances['chartLowStock'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top.map(i => i.name),
      datasets: [
        { label: 'Current Stock', data: top.map(i => i.stock), backgroundColor: top.map(i => i.stock === 0 ? '#ef4444' : '#f59e0b'), borderRadius: 4, borderSkipped: false },
        { label: 'Threshold', data: top.map(i => i.threshold), backgroundColor: 'rgba(148,163,184,0.25)', borderColor: 'rgba(148,163,184,0.6)', borderWidth: 1, borderRadius: 4, borderSkipped: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: {
        legend: { display: true, position: 'top', labels: { color: chartTextColor(), font: { size: 11 }, boxWidth: 12, padding: 10 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw}` } }
      },
      scales: {
        x: { ticks: { color: chartTextColor(), font: { size: 10 }, maxRotation: 30 }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: chartTextColor(), font: { size: 11 }, stepSize: 1 }, grid: { color: chartGridColor() } }
      }
    }
  });
}

// ===============================
// EXPORT HELPERS
// ===============================
function getSelectedFormat() { return document.getElementById("exportFormat")?.value || "csv"; }

function convertToCSV(data) {
  if (!data.length) return "";
  const escape = (val) => {
    const str = String(val ?? "");
    return str.includes(",") || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const headers = Object.keys(data[0]).map(escape).join(",");
  const rows    = data.map(obj => Object.values(obj).map(escape).join(","));
  return [headers, ...rows].join("\n");
}

function downloadCSV(filename, data) {
  const blob = new Blob([data], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function downloadExcel(filename, data) {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook  = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
  XLSX.writeFile(workbook, filename);
}

function exportData(filename, data) {
  if (!data || data.length === 0) { alert("No data found to export for this report."); return; }
  const format = getSelectedFormat();
  if (format === "csv") downloadCSV(filename + ".csv", convertToCSV(data));
  else downloadExcel(filename + ".xlsx", data);
}

function setButtonLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn.dataset.originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';
  } else {
    btn.disabled  = false;
    btn.innerHTML = btn.dataset.originalHtml || '<i class="fa-solid fa-download"></i> Generate Report';
  }
}

// ===============================
// REPORT GENERATORS
// ===============================
async function loadInventoryReport(btn) {
  setButtonLoading(btn, true);
  try {
    const snapshot   = await getDocs(collection(db, "products"));
    const reportData = [];
    let grandTotalValue = 0;

    snapshot.forEach(docSnap => {
      const p = docSnap.data();
      if (p.archived === true) return;
      const stock = Number(p.stock) || 0, price = Number(p.price) || 0, threshold = Number(p.lowStockThreshold) || 10;
      const itemValue = stock * price;
      grandTotalValue += itemValue;
      let status = stock === 0 ? "Out of Stock" : stock <= threshold ? "Low Stock" : "In Stock";
      reportData.push({
        "Product ID": docSnap.id, "Product Name": p.name || "", "Category": p.category || "",
        "Price (₱)": price.toFixed(2), "Stock": stock, "Low Stock Threshold": threshold,
        "Status": status, "Inventory Value (₱)": itemValue.toFixed(2),
        "Date Added": p.createdAt ? new Date(p.createdAt.seconds * 1000).toLocaleDateString() : "N/A"
      });
    });

    if (reportData.length > 0) {
      reportData.push({
        "Product ID": "—", "Product Name": "TOTAL", "Category": "—", "Price (₱)": "—",
        "Stock": reportData.reduce((s, r) => s + Number(r["Stock"]), 0), "Low Stock Threshold": "—",
        "Status": "—", "Inventory Value (₱)": grandTotalValue.toFixed(2), "Date Added": "—"
      });
    }
    exportData(`InventoryReport_${getDateStamp()}`, reportData);
  } catch (err) {
    console.error("Inventory report error:", err);
    alert("Error generating report: " + err.message);
  } finally { setButtonLoading(btn, false); }
}

async function loadCategoryReport(btn) {
  setButtonLoading(btn, true);
  try {
    const [productsSnap, categoriesSnap] = await Promise.all([
      getDocs(collection(db, "products")),
      getDocs(collection(db, "categories"))
    ]);

    const categoryMap = {};
    categoriesSnap.forEach(docSnap => {
      const c = docSnap.data();
      if (c.archived !== true && c.name) {
        categoryMap[c.name] = {
          "Category Name": c.name, "Total Products": 0, "Total Stock": 0, "Total Value (₱)": 0,
          "Out of Stock": 0, "Low Stock": 0, "In Stock": 0,
          "Date Created": c.createdAt ? new Date(c.createdAt.seconds * 1000).toLocaleDateString() : "N/A"
        };
      }
    });

    productsSnap.forEach(docSnap => {
      const p = docSnap.data();
      if (p.archived === true) return;
      const cat = p.category || "Uncategorized";
      const stock = Number(p.stock) || 0, price = Number(p.price) || 0, threshold = Number(p.lowStockThreshold) || 10;
      if (!categoryMap[cat]) categoryMap[cat] = { "Category Name": cat, "Total Products": 0, "Total Stock": 0, "Total Value (₱)": 0, "Out of Stock": 0, "Low Stock": 0, "In Stock": 0, "Date Created": "N/A" };
      categoryMap[cat]["Total Products"]++;
      categoryMap[cat]["Total Stock"]      += stock;
      categoryMap[cat]["Total Value (₱)"] += stock * price;
      if (stock === 0) categoryMap[cat]["Out of Stock"]++;
      else if (stock <= threshold) categoryMap[cat]["Low Stock"]++;
      else categoryMap[cat]["In Stock"]++;
    });

    const reportData = Object.values(categoryMap).map(c => ({ ...c, "Total Value (₱)": Number(c["Total Value (₱)"]).toFixed(2) }));
    reportData.sort((a, b) => b["Total Products"] - a["Total Products"]);
    exportData(`CategoryReport_${getDateStamp()}`, reportData);
  } catch (err) {
    console.error("Category report error:", err);
    alert("Error generating report: " + err.message);
  } finally { setButtonLoading(btn, false); }
}

async function loadLowStockReport(btn) {
  setButtonLoading(btn, true);
  try {
    const snapshot   = await getDocs(collection(db, "products"));
    const reportData = [];
    snapshot.forEach(docSnap => {
      const p = docSnap.data();
      if (p.archived === true) return;
      const stock = Number(p.stock) || 0, price = Number(p.price) || 0, threshold = Number(p.lowStockThreshold) || 10;
      if (stock <= threshold) {
        reportData.push({
          "Product ID": docSnap.id, "Product Name": p.name || "", "Category": p.category || "",
          "Current Stock": stock, "Threshold": threshold, "Units Needed": Math.max(0, threshold - stock + 1),
          "Price (₱)": price.toFixed(2), "Status": stock === 0 ? "Out of Stock" : "Low Stock",
          "Date Added": p.createdAt ? new Date(p.createdAt.seconds * 1000).toLocaleDateString() : "N/A"
        });
      }
    });
    reportData.sort((a, b) => {
      if (a["Current Stock"] === 0 && b["Current Stock"] !== 0) return -1;
      if (a["Current Stock"] !== 0 && b["Current Stock"] === 0) return  1;
      return a["Current Stock"] - b["Current Stock"];
    });
    if (reportData.length === 0) { alert("Great news! All products are well stocked — no low stock items to report."); return; }
    exportData(`LowStockReport_${getDateStamp()}`, reportData);
  } catch (err) {
    console.error("Low stock report error:", err);
    alert("Error generating report: " + err.message);
  } finally { setButtonLoading(btn, false); }
}

async function loadActivityReport(btn) {
  setButtonLoading(btn, true);
  try {
    const q        = query(collection(db, "activities"), orderBy("timestamp", "desc"), limit(500));
    const snapshot = await getDocs(q);
    const reportData = [];
    snapshot.forEach(docSnap => {
      const log    = docSnap.data();
      if (!isInRange(log.timestamp)) return;
      const action = (log.action || "").toLowerCase();
      let actionType = "Other";
      if      (action.includes("add"))                               actionType = "Added";
      else if (action.includes("edit") || action.includes("update")) actionType = "Updated";
      else if (action.includes("delete"))                            actionType = "Deleted";
      else if (action.includes("archive"))                           actionType = "Archived";
      else if (action.includes("restore"))                           actionType = "Restored";
      reportData.push({
        "Date": log.timestamp ? new Date(log.timestamp.seconds * 1000).toLocaleString() : "N/A",
        "Action": log.action || "", "Action Type": actionType,
        "Item": log.target || "", "Performed By": log.user || "Admin"
      });
    });
    exportData(`ActivityReport_${getDateStamp()}`, reportData);
  } catch (err) {
    console.error("Activity report error:", err);
    alert("Error generating report: " + err.message);
  } finally { setButtonLoading(btn, false); }
}

async function loadStockMovementReport(btn) {
  setButtonLoading(btn, true);
  try {
    const currentYear = new Date().getFullYear();
    const fromYear    = activeDateRange.from ? activeDateRange.from.getFullYear() : 2020;
    const toYear      = activeDateRange.to   ? activeDateRange.to.getFullYear()   : currentYear;
    const yearRange   = [];
    for (let y = fromYear; y <= toYear; y++) yearRange.push(y);

    const snaps = await Promise.all(
      yearRange.map(y => getDocs(query(collection(db, "stock_transactions", String(y), "transactions"), orderBy("createdAt", "desc"))))
    );

    const reportData = [];
    snaps.forEach(snap => {
      snap.forEach(docSnap => {
        const d = docSnap.data();
        if (!isInRange(d.createdAt)) return;
        if (d.status === "Cancelled") return;
        reportData.push({
          "Date":         d.createdAt ? new Date(d.createdAt.seconds * 1000).toLocaleString() : "N/A",
          "Product Name": d.productName || "", "Type": d.type || "", "Status": d.status || "Completed",
          "Qty":          Number(d.qty) || 0, "Stock Before": Number(d.stockBefore) || 0,
          "Stock After":  Number(d.stockAfter) || 0, "Note": d.note || "", "Created By": d.createdBy || ""
        });
      });
    });
    exportData(`StockMovementReport_${getDateStamp()}`, reportData);
  } catch (err) {
    console.error("Stock movement report error:", err);
    alert("Error generating report: " + err.message);
  } finally { setButtonLoading(btn, false); }
}

function getDateStamp() { return new Date().toISOString().split('T')[0]; }

function attachReportListeners() {
  const btnInventory           = document.getElementById("btnInventory");
  const btnCategory            = document.getElementById("btnCategory");
  const btnLowStock            = document.getElementById("btnLowStock");
  const btnStockMovement       = document.getElementById("btnStockMovement");
  const btnStockMovementExport = document.getElementById("btnStockMovementExport");

  if (btnInventory)           btnInventory.addEventListener("click",           () => loadInventoryReport(btnInventory));
  if (btnCategory)            btnCategory.addEventListener("click",             () => loadCategoryReport(btnCategory));
  if (btnLowStock)            btnLowStock.addEventListener("click",             () => loadLowStockReport(btnLowStock));
  if (btnStockMovement)       btnStockMovement.addEventListener("click",        () => loadActivityReport(btnStockMovement));
  if (btnStockMovementExport) btnStockMovementExport.addEventListener("click",  () => loadStockMovementReport(btnStockMovementExport));
  initDateFilter();
}