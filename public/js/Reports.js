// ============================================================
// Reports.js
// Handles all data fetching, chart rendering, date filtering,
// and CSV/Excel export logic for the Reports page.
// Only accessible to admin users — non-admins see an
// "Access Denied" message instead of the report content.
// ============================================================

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection, getDocs, query,
  orderBy, limit, doc, getDoc, where
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { initLogoutModal } from "./logout-modal.js";
import { applyRoleBasedNavigation, isAdminUser, renderAccessDenied } from "./access-control.js";
import { db, auth, storage } from "./firebase.js";


// ============================================================
// GLOBALS
// chartInstances  — registry of active Chart.js instances keyed
//   by canvas ID. Used by destroyChart() to tear down a chart
//   before re-rendering it, preventing "canvas already in use" errors.
// activeDateRange — the currently selected date filter window
//   ({ from: Date|null, to: Date|null }). All chart and export
//   functions check this range before including a data point.
// ============================================================
const chartInstances = {};


// ============================================================
// SECTION 1 — DATE RANGE STATE
// Stores the active date filter and exposes helpers for setting,
// checking, and formatting it. All chart renderers call
// isInRange() to decide whether to include each data point.
// ============================================================

/** Module-level date range state. Null values mean "no boundary". */
let activeDateRange = { from: null, to: null };

/**
 * Updates the active date range used by all chart and export functions.
 *
 * @param {Date|null} from — start of the range (inclusive), or null for no lower bound
 * @param {Date|null} to   — end of the range (inclusive), or null for no upper bound
 */
function setDateRange(from, to) {
  activeDateRange = { from, to };
}

/**
 * Returns true if a given timestamp falls within the active date range.
 * Accepts both Firestore Timestamps ({ seconds }) and ISO strings / Date objects.
 * If no range is set (both null), every timestamp passes.
 *
 * @param {Object|string|null} timestamp — the timestamp to test
 * @returns {boolean}
 */
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

/**
 * Returns a human-readable string describing the current date range.
 * Examples: "All time", "Jan 1, 2024 – Apr 22, 2025", "Mar 1, 2025 – Today"
 *
 * @param {Date|null} from
 * @param {Date|null} to
 * @returns {string}
 */
function formatRangeLabel(from, to) {
  if (!from && !to) return "All time";
  const opts = { month: "short", day: "numeric", year: "numeric" };
  return `${from ? from.toLocaleDateString("en-US", opts) : "—"} – ${to ? to.toLocaleDateString("en-US", opts) : "Today"}`;
}

/**
 * Initialises the date-filter UI — pill buttons (30d, 3m, 1y, All, Custom)
 * and the custom date range picker. Each selection updates activeDateRange
 * and triggers a full chart reload via loadAllCharts().
 *
 * Pill buttons compute their "from" date relative to now.
 * The custom range requires both a start and end date before applying.
 */
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

      // Show the custom date picker only for the "custom" pill.
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

  // Apply button for the custom date picker.
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


// ============================================================
// SECTION 2 — AUTH & USER DATA
// Checks authentication on page load. Non-admin users are shown
// an access-denied message. Admin users proceed to full report
// functionality. User data is cached in sessionStorage to avoid
// repeat Firestore reads on subsequent visits.
// ============================================================

/**
 * Fetches the current user's Firestore document (name, role, etc.).
 * Caches the result per-UID in sessionStorage so repeat visits
 * don't cost an extra read.
 *
 * @param {string} uid — Firebase Auth UID
 * @returns {Object|null} — user data object, or null on failure
 */
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

/**
 * Firebase Auth state listener — runs once on page load.
 * Redirects unauthenticated users to the login page.
 * For authenticated users, fetches user data and loads all charts
 * in parallel (Promise.all). Admins get the full Reports UI;
 * non-admins see an "Access Denied" placeholder instead.
 * Also wires up the sidebar name badge and logout modal.
 */
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }

  const main = document.getElementById('mainContent');

  const userData = await getCachedUserData(user.uid);

  const isAdmin = isAdminUser(userData);
  const nameEl  = document.getElementById('userNameDisplay');
  if (nameEl) {
    const name = userData?.name || "User";
    const role = userData?.role || "user";
    const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
    nameEl.innerHTML = `${name} <span style="font-size:11px; color: #FFA500; font-weight:600; opacity:0.7;">(${roleLabel})</span>`;
  }
  applyRoleBasedNavigation(isAdmin);

  // Replace main content with an access-denied message for non-admins.
  if (!isAdmin) {
    renderAccessDenied(main, "Reports");
  } else {
    await loadAllCharts();
    // Wire up export buttons and date filter only for admins.
    attachReportListeners();
  }

  main.style.visibility = 'visible';

  // Sign-out handler clears all local/session storage before redirecting.
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


// ============================================================
// SECTION 3 — CHART HELPERS
// Lightweight utilities shared by all chart render functions:
// theme detection, colour tokens, and canvas lifecycle management.
// ============================================================

/** Returns true if the page is currently in dark mode. */
function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }

/** Returns the appropriate axis/label text colour for the active theme. */
function chartTextColor() { return isDark() ? '#cbd5e1' : '#475569'; }

/** Returns the appropriate grid-line colour for the active theme. */
function chartGridColor() { return isDark() ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'; }

/**
 * Destroys an existing Chart.js instance by canvas ID and removes
 * it from the registry. Must be called before re-rendering a chart
 * on the same canvas to avoid "canvas already in use" errors.
 *
 * @param {string} id — canvas element ID
 */
function destroyChart(id) {
  if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}

/**
 * Makes a canvas visible and hides its associated loading spinner.
 * Called once a chart has finished rendering.
 *
 * @param {string} canvasId  — ID of the <canvas> element to show
 * @param {string} loadingId — ID of the loading spinner element to hide
 */
function showChart(canvasId, loadingId) {
  const canvas  = document.getElementById(canvasId);
  const loading = document.getElementById(loadingId);
  if (canvas)  canvas.style.display  = 'block';
  if (loading) loading.style.display = 'none';
}

/**
 * Injects a plain-language summary sentence beneath a report card's chart.
 * Looks for an existing .chart-summary element inside the card and creates
 * one if absent. The card is found by walking up from the canvas element.
 *
 * @param {string} canvasId — ID of the chart's canvas element
 * @param {string} html     — summary HTML to inject (may include <strong>, <span>)
 */
function setChartSummary(canvasId, html) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const card = canvas.closest('.report-card');
  if (!card) return;
  let el = card.querySelector('.chart-summary');
  if (!el) {
    el = document.createElement('p');
    el.className = 'chart-summary';
    const footer = card.querySelector('.report-card-footer');
    footer ? card.insertBefore(el, footer) : card.appendChild(el);
  }
  el.innerHTML = html;
}

function safeRenderChart(label, renderFn) {
  try {
    renderFn();
  } catch (err) {
    console.error(`${label} render error:`, err);
  }
}


// ============================================================
// SECTION 4 — MASTER CHART LOADER
// loadAllCharts() is the single entry point for populating every
// chart on the page. It batches all Firestore reads into as few
// round-trips as possible (parallel Promise.all calls), then
// fans out to individual render functions. Called on page load
// and again whenever the date filter changes.
// ============================================================

/**
 * Fetches all data needed for the Reports page and renders every chart.
 *
 * Strategy:
 *   - Determines which transaction years to fetch based on the active
 *     date range (or defaults to current + previous year for "all time").
 *   - Fetches all transaction year sub-collections, products, categories,
 *     and recent activities in parallel to minimise total load time.
 *   - Passes the combined data down to each individual render function.
 */
async function loadAllCharts() {
  try {
    const currentYear = new Date().getFullYear();
    const targetYear  = activeDateRange.from ? activeDateRange.from.getFullYear() : currentYear;
    const prevYear    = targetYear - 1;

    // Build the list of transaction years to fetch.
    // For "all time", always include the current and previous year at minimum.
    const yearsToFetch = [];
    if (!activeDateRange.from) {
      yearsToFetch.push(currentYear, prevYear);
    } else {
      for (let y = activeDateRange.from.getFullYear(); y <= (activeDateRange.to?.getFullYear() || currentYear); y++) {
        yearsToFetch.push(y);
      }
      if (!yearsToFetch.includes(prevYear)) yearsToFetch.push(prevYear);
    }

    // Fetch all transaction years in parallel, then flatten into a single array.
    const txSnaps = await Promise.all(
      yearsToFetch.map(y =>
        getDocs(query(collection(db, "stock_transactions", String(y), "transactions"), orderBy("createdAt", "asc")))
      )
    );
    const allTxDocs = txSnaps.flatMap(snap => snap.docs);

    // Fetch products, categories, and activity log in parallel.
    const [productsSnap, categoriesSnap, activitiesSnap] = await Promise.all([
      getDocs(collection(db, "products")),
      getDocs(collection(db, "categories")),
      getDocs(query(collection(db, "activities"), orderBy("timestamp", "desc"), limit(500)))
    ]);

    // Fan out to each chart renderer.
    safeRenderChart("Inventory Summary", () => renderInventorySummaryBanner(productsSnap, allTxDocs));
    safeRenderChart("Overall Summary", () => renderOverallSummary(productsSnap, allTxDocs));
    safeRenderChart("Inventory", () => renderInventoryChart(productsSnap));
    safeRenderChart("Category", () => renderCategoryChart(productsSnap, categoriesSnap));
    safeRenderChart("Low Stock", () => renderLowStockChart(productsSnap));
    safeRenderChart("Activity Timeline", () => renderActivityTimelineChart(activitiesSnap));
    safeRenderChart("Stock Movement", () => renderStockMovementChart(allTxDocs, yearsToFetch));
    safeRenderChart("Top Moved Products", () => renderTopMovedProductsChart(allTxDocs));
    safeRenderChart("Sales Trend", () => renderSalesTrendChart(allTxDocs));
    safeRenderChart("Dead Stock", () => renderDeadStockChart(productsSnap, allTxDocs));

  } catch (err) {
    console.error("Chart load error:", err);
  }
}


// ============================================================
// SECTION 5 — TREND INDICATOR HELPER
// Used by the Inventory Summary Banner to show month-over-month
// percentage change with directional arrows and colour coding.
// ============================================================

/**
 * Calculates the percentage change between two values and returns
 * a display-ready trend indicator object.
 *
 * @param {number} current  — value for the current period
 * @param {number} previous — value for the comparison period
 * @returns {{ text: string, cls: string, icon: string }}
 *   text — formatted label e.g. "↑ 12.5%" or "New"
 *   cls  — CSS class: "trend-up" | "trend-down" | "trend-neutral"
 *   icon — directional arrow character
 */
function getTrendIndicator(current, previous) {
  if (previous === 0 && current === 0) return { text: "—", cls: "trend-neutral", icon: "" };
  if (previous === 0) return { text: "New", cls: "trend-up", icon: "↑" };
  const pct = ((current - previous) / previous) * 100;
  const abs = Math.abs(pct).toFixed(1);
  if (pct > 0)  return { text: `↑ ${abs}%`, cls: "trend-up",      icon: "↑" };
  if (pct < 0)  return { text: `↓ ${abs}%`, cls: "trend-down",    icon: "↓" };
  return { text: "→ 0%", cls: "trend-neutral", icon: "→" };
}


// ============================================================
// SECTION 6 — INVENTORY SUMMARY BANNER
// Renders the top summary strip showing aggregate inventory
// stats and month-over-month trend comparisons for units sold
// and stock received. Does not use a chart — pure HTML injection.
// ============================================================

/**
 * Builds and injects the Inventory Summary Banner HTML.
 *
 * Computes from raw Firestore data:
 *   - Total active products, stock units, and inventory value
 *   - Units sold this month vs last month (with trend badge)
 *   - Stock received this month vs last month (with trend badge)
 *
 * Cancelled transactions are excluded from all totals.
 *
 * @param {QuerySnapshot} productsSnap — snapshot of the products collection
 * @param {DocumentSnapshot[]} allTxDocs — flattened array of transaction docs
 */
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

  // Tally "Sold" transactions for this month and last month.
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

  // Tally "Stock In" transactions for this month and last month.
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

function renderOverallSummary(productsSnap, allTxDocs) {
  const leadEl = document.getElementById('overallSummaryLead');
  const rangeEl = document.getElementById('overallSummaryRange');
  const metricsEl = document.getElementById('overallSummaryMetrics');
  if (!leadEl || !rangeEl || !metricsEl) return;

  const rangeLabel = formatRangeLabel(activeDateRange.from, activeDateRange.to);
  rangeEl.textContent = rangeLabel;

  let totalProducts = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let deadStockCount = 0;
  let unitsSold = 0;
  let unitsReceived = 0;

  const recentlyMoved = new Set();
  const movedTotals = {};
  const deadStockCutoff = new Date();
  deadStockCutoff.setDate(deadStockCutoff.getDate() - 90);

  allTxDocs.forEach(docSnap => {
    const d = docSnap.data();
    const ts = d.createdAt?.seconds ? new Date(d.createdAt.seconds * 1000) : null;
    if (ts && ts >= deadStockCutoff) {
      if (d.productId) recentlyMoved.add(d.productId);
      if (d.productName) recentlyMoved.add(d.productName);
    }

    if (d.status === "Cancelled" || !isInRange(d.createdAt)) return;

    const qty = Number(d.qty) || 0;
    const name = d.productName || d.productId || "Unknown";
    movedTotals[name] = (movedTotals[name] || 0) + qty;

    if (d.type === "Sold") unitsSold += qty;
    if (d.type === "Stock In") unitsReceived += qty;
  });

  productsSnap.forEach(docSnap => {
    const p = docSnap.data();
    if (p.archived === true) return;

    totalProducts++;
    const stock = Number(p.stock) || 0;
    const threshold = Number(p.lowStockThreshold) || 10;
    if (stock === 0) outOfStockCount++;
    else if (stock <= threshold) lowStockCount++;

    if (stock > 0 && !recentlyMoved.has(docSnap.id) && !recentlyMoved.has(p.name)) {
      deadStockCount++;
    }
  });

  const attentionCount = lowStockCount + outOfStockCount;
  const topMovedEntry = Object.entries(movedTotals).sort((a, b) => b[1] - a[1])[0] || null;

  leadEl.innerHTML =
    `<strong>${totalProducts.toLocaleString()}</strong> active products are included for <strong>${rangeLabel}</strong>. ` +
    `${attentionCount > 0
      ? `<span class="insight-warn">${attentionCount.toLocaleString()} items need replenishment attention</span>`
      : `<span class="insight-ok">No immediate replenishment issues detected</span>`}. ` +
    `${topMovedEntry
      ? `Top movement came from <strong>${topMovedEntry[0]}</strong>.`
      : `No completed stock movement was recorded in the selected period.`}`;

  metricsEl.innerHTML = [
    {
      label: "Units Sold",
      value: unitsSold.toLocaleString(),
      note: unitsReceived > 0
        ? `${unitsReceived.toLocaleString()} units received in the same period`
        : "No inbound stock recorded in this period"
    },
    {
      label: "Stock Attention",
      value: attentionCount.toLocaleString(),
      note: `${outOfStockCount.toLocaleString()} out of stock, ${lowStockCount.toLocaleString()} low stock`
    },
    {
      label: "Top Moved Product",
      value: topMovedEntry ? topMovedEntry[0] : "None",
      note: topMovedEntry
        ? `${topMovedEntry[1].toLocaleString()} total units moved`
        : "No completed transactions in range"
    },
    {
      label: "Dead Stock",
      value: deadStockCount.toLocaleString(),
      note: "Products with stock but no movement in the last 90 days"
    }
  ].map(metric => `
    <div class="overall-summary-metric">
      <span class="overall-summary-metric-label">${metric.label}</span>
      <span class="overall-summary-metric-value">${metric.value}</span>
      <span class="overall-summary-metric-note">${metric.note}</span>
    </div>
  `).join('');
}


// ============================================================
// SECTION 7 — CHART RENDERERS
// Each function receives pre-fetched Firestore data, processes
// it into chart-ready arrays, destroys any previous instance,
// and creates a new Chart.js chart on its designated canvas.
// No Firestore calls are made inside these functions.
// ============================================================

/**
 * Renders the Activity Timeline line chart.
 * Buckets the last 30 days of activity log entries into three
 * daily series: Added, Updated/Status, and Other.
 * The active date range filter does NOT apply here — the chart
 * always shows the most recent 30 days of activity.
 *
 * @param {QuerySnapshot} activitiesSnap — most recent 500 activity logs
 */
function renderActivityTimelineChart(activitiesSnap) {
  const now  = new Date();
  const days = 30;
  const buckets = {};

  // Pre-populate buckets for each of the last 30 days.
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

  // Clear any legacy HTML legend element left from a previous render.
  const legend = document.getElementById('legendActivity');
  if (legend) legend.innerHTML = '';

  const totalActions = addedData.reduce((a,b) => a+b, 0) + updatedData.reduce((a,b) => a+b, 0) + otherData.reduce((a,b) => a+b, 0);
  const peakIdx   = addedData.map((v,i) => v + updatedData[i] + otherData[i]).reduce((best, v, i, arr) => v > arr[best] ? i : best, 0);
  const peakLabel = labels[peakIdx];
  setChartSummary('chartActivity',
    totalActions === 0
      ? 'No activity recorded in the last 30 days.'
      : `<strong>${totalActions}</strong> total actions logged over 30 days. ` +
        `Busiest day was <strong>${peakLabel}</strong>. ` +
        `Most activity was <span class="insight-ok">${addedData.reduce((a,b)=>a+b,0)} additions</span> and ` +
        `<span class="insight-warn">${updatedData.reduce((a,b)=>a+b,0)} updates</span>.`
  );
}

/**
 * Renders the Top 5 Most Moved Products horizontal bar chart.
 * Aggregates total Stock In and Sold quantities per product across
 * all transaction docs, sorted by combined movement volume.
 * Shows an empty state if no qualifying transactions exist.
 * Respects the active date range filter via isInRange().
 *
 * @param {DocumentSnapshot[]} allTxDocs — flattened array of transaction docs
 */
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

  // Sort by total movement descending and take the top 5.
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
            // Truncate long product names to keep the chart readable.
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
  // Add this after chartInstances['chartTopMoved'] = new Chart(...)
  const rangeNote = document.getElementById('chartTopMovedNote');
  if (!rangeNote) {
    const note = document.createElement('div');
    note.id = 'chartTopMovedNote';
    note.style.cssText = 'text-align:center; font-size:11px; color:var(--text-secondary); margin-top:4px;';
    canvas.insertAdjacentElement('afterend', note);
  }
  const noteEl = document.getElementById('chartTopMovedNote');
  if (noteEl) {
    noteEl.textContent = activeDateRange.from || activeDateRange.to
      ? `Showing top 5 for: ${formatRangeLabel(activeDateRange.from, activeDateRange.to)}`
      : 'Showing top 5 across all time — use the date filter above to narrow by period';
  }

  const topProduct = sorted[0];
  setChartSummary('chartTopMoved',
    `<strong>${topProduct[0]}</strong> is your most active product with ` +
    `<strong>${topProduct[1].total.toLocaleString()}</strong> total units moved ` +
    `(${topProduct[1].stockIn.toLocaleString()} in, ${topProduct[1].sold.toLocaleString()} out). ` +
    `These 5 products account for the bulk of your inventory movement.`
  );
}

/**
 * Renders the Sales Trend line chart.
 * Groups "Sold" transaction quantities by calendar month and plots
 * them as a filled line chart with a gradient background.
 * Shows an empty state if no sales data exists for the active range.
 * Respects the active date range filter via isInRange().
 *
 * @param {DocumentSnapshot[]} allTxDocs — flattened array of transaction docs
 */
function renderSalesTrendChart(allTxDocs) {
  const monthlyData = {};

  allTxDocs.forEach(docSnap => {
    const d = docSnap.data();
    if (d.type !== "Sold" || d.status === "Cancelled") return;
    if (!isInRange(d.createdAt)) return;
    const ts = d.createdAt?.seconds ? new Date(d.createdAt.seconds * 1000) : null;
    if (!ts) return;
    // Key format: "YYYY-MM" for reliable chronological sorting.
    const key = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}`;
    monthlyData[key] = (monthlyData[key] || 0) + (Number(d.qty) || 0);
  });

  const sorted = Object.entries(monthlyData).sort((a, b) => a[0].localeCompare(b[0]));
  const labels = sorted.map(([k]) => {
    const [yr, mo] = k.split('-');
    return new Date(Number(yr), Number(mo) - 1).toLocaleDateString("en-US", { month: "short" });
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

  // Gradient fill fades from a semi-transparent blue at the top to transparent at the bottom.
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
  const years = [...new Set(sorted.map(([k]) => k.split('-')[0]))];
  const yearLabel = years.join(' – ');
  
  let yearSubtitle = document.getElementById('chartSalesTrendYear');
  if (!yearSubtitle) {
    yearSubtitle = document.createElement('div');
    yearSubtitle.id = 'chartSalesTrendYear';
    yearSubtitle.style.cssText = 'text-align:center; font-size:11px; color:var(--text-secondary); margin-top:4px;';
    canvas.insertAdjacentElement('afterend', yearSubtitle);
  }
  yearSubtitle.textContent = yearLabel;

  const peakMonth = sorted.reduce((best, cur) => cur[1] > best[1] ? cur : best, sorted[0]);
  const [peakYr, peakMo] = peakMonth[0].split('-');
  const peakLabel = new Date(Number(peakYr), Number(peakMo) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const totalSold = values.reduce((a, b) => a + b, 0);
  setChartSummary('chartSalesTrend',
    `<strong>${totalSold.toLocaleString()}</strong> total units sold across the selected period. ` +
    `Peak sales month was <strong>${peakLabel}</strong> with <strong>${peakMonth[1].toLocaleString()}</strong> units. ` +
    (values.length >= 2 && values[values.length - 1] > values[values.length - 2]
      ? '<span class="insight-ok">Sales are trending upward.</span>'
      : values.length >= 2
      ? '<span class="insight-warn">Sales dipped in the most recent month.</span>'
      : '')
  );
}

/**
 * Renders the Dead Stock bar chart.
 * Identifies active products with non-zero stock that have had no
 * transactions in the past 90 days, then plots the top 8 by
 * tied-up inventory value. Uses a dual Y-axis: left for units,
 * right for peso value. Shows a count badge and empty state when
 * no dead stock is detected.
 *
 * @param {QuerySnapshot}      productsSnap — snapshot of the products collection
 * @param {DocumentSnapshot[]} allTxDocs    — flattened array of transaction docs
 */
function renderDeadStockChart(productsSnap, allTxDocs) {
  const DEAD_DAYS = 90;
  const cutoff    = new Date();
  cutoff.setDate(cutoff.getDate() - DEAD_DAYS);

  // Build a set of product IDs and names that had any recent transaction.
  const recentlyMoved = new Set();
  allTxDocs.forEach(docSnap => {
    const d  = docSnap.data();
    const ts = d.createdAt?.seconds ? new Date(d.createdAt.seconds * 1000) : null;
    if (ts && ts >= cutoff) {
      if (d.productId)   recentlyMoved.add(d.productId);
      if (d.productName) recentlyMoved.add(d.productName);
    }
  });

  // Any active product not in recentlyMoved with stock > 0 is considered dead stock.
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

  // Sort by tied-up value descending; only chart the top 8.
  deadItems.sort((a, b) => b.value - a.value);
  const top = deadItems.slice(0, 8);

  const canvas    = document.getElementById('chartDeadStock');
  const loadingEl = document.getElementById('chartLoadingDeadStock');
  const emptyEl   = document.getElementById('chartDeadStockEmpty');
  const countEl   = document.getElementById('deadStockCount');

  if (loadingEl) loadingEl.style.display = 'none';
  if (countEl)   countEl.textContent = `${deadItems.length} product${deadItems.length !== 1 ? 's' : ''} with no movement in ${DEAD_DAYS}+ days`;

  if (top.length === 0) {
    if (emptyEl) emptyEl.style.display = 'flex';
    if (canvas)  canvas.style.display  = 'none';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  if (canvas)  canvas.style.display  = 'block';

  const totalTiedValue = deadItems.reduce((sum, item) => sum + item.value, 0);
  setChartSummary('chartDeadStock',
    `<span class="insight-warn">${deadItems.length}</span> product${deadItems.length !== 1 ? 's' : ''} haven't moved in 90+ days, ` +
    `tying up an estimated <strong>₱${totalTiedValue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong> in idle inventory. ` +
    `Consider promotions, bundling, or write-offs for these items.`
  );

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
        // Left Y-axis: stock units (amber ticks)
        y: {
          beginAtZero: true, position: 'left',
          ticks: { color: '#f59e0b', font: { size: 11 } },
          grid: { color: chartGridColor() },
          title: { display: true, text: 'Units', color: chartTextColor(), font: { size: 11 } }
        },
        // Right Y-axis: peso value (red ticks) — grid lines suppressed to avoid clutter
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

/**
 * Renders the Stock Movement grouped bar chart (current year)
 * and a side-by-side Year-over-Year comparison chart (previous year).
 * Groups Stock In and Sold quantities by calendar month.
 * Cancelled transactions are excluded from both datasets.
 *
 * @param {DocumentSnapshot[]} txDocs     — flattened array of transaction docs
 * @param {number}             targetYear — the primary year to display
 * @param {number}             prevYear   — the comparison year (targetYear - 1)
 */
function renderStockMovementChart(txDocs, yearsToFetch) {
  // Determine the display range from the active filter or fall back to current + prev year.
  const currentYear = new Date().getFullYear();
  let displayYears;

  if (activeDateRange.from || activeDateRange.to) {
    const fromYear = activeDateRange.from ? activeDateRange.from.getFullYear() : currentYear - 1;
    const toYear   = activeDateRange.to   ? activeDateRange.to.getFullYear()   : currentYear;
    displayYears = [];
    for (let y = fromYear; y <= toYear; y++) displayYears.push(y);
  } else {
    displayYears = [currentYear];
  }

  // The "previous year" for comparison is one before the earliest display year.
  const prevYear    = Math.min(...displayYears) - 1;
  const targetYear  = displayYears[displayYears.length - 1]; // used only for summary label

  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // Build per-year buckets for the primary range.
  const yearData = {};
  displayYears.forEach(y => {
    yearData[y] = Array(12).fill(null).map(() => ({ stockIn: 0, sold: 0 }));
  });
  const lastYearData = Array(12).fill(null).map(() => ({ stockIn: 0, sold: 0 }));

  txDocs.forEach(docSnap => {
    const d  = docSnap.data();
    if (d.status === "Cancelled") return;
    const ts = d.createdAt?.seconds ? new Date(d.createdAt.seconds * 1000) : null;
    if (!ts) return;
    const yr  = ts.getFullYear();
    const mo  = ts.getMonth();
    const qty = Number(d.qty) || 0;
    if (yearData[yr]) {
      if (d.type === "Stock In") yearData[yr][mo].stockIn += qty;
      else                       yearData[yr][mo].sold    += qty;
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

  // Colour palette — cycles if more years than colours.
  const stockInColors  = ["#22c55e","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899"];
  const stockOutColors = ["#16a34a","#1d4ed8","#6d28d9","#b45309","#0e7490","#be185d"];

  // Build one dataset pair per year in the primary range.
  const primaryDatasets = displayYears.flatMap((yr, i) => [
    {
      label: `Stock In (${yr})`,
      data: yearData[yr].map(m => m.stockIn),
      backgroundColor: stockInColors[i % stockInColors.length],
      borderRadius: 4, borderSkipped: false
    },
    {
      label: `Stock Out (${yr})`,
      data: yearData[yr].map(m => m.sold),
      backgroundColor: stockOutColors[i % stockOutColors.length],
      borderRadius: 4, borderSkipped: false
    }
  ]);

  const baseOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true, position: "top",
        labels: { color: textColor, font: { size: 11 }, boxWidth: 12, padding: 10 }
      },
      tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw.toLocaleString()} units` } }
    },
    scales: {
      x: { ticks: { color: textColor, font: { size: 11 }, autoSkip: false, maxRotation: 0 }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { color: textColor, font: { size: 11 }, stepSize: 1 }, grid: { color: gridColor } }
    }
  };

  // Primary chart — all selected years side by side.
  const ctx = document.getElementById("chartStock").getContext("2d");
  chartInstances["chartStock"] = new Chart(ctx, {
    type: "bar",
    data: { labels: monthNames, datasets: primaryDatasets },
    options: baseOpts
  });

  // Comparison chart — always the year before the earliest selected year.
  showChart("chartStockCompare", null);
  const ctxCmp = document.getElementById("chartStockCompare").getContext("2d");
  chartInstances["chartStockCompare"] = new Chart(ctxCmp, {
    type: "bar",
    data: {
      labels: monthNames,
      datasets: [
        {
          label: `Stock In (${prevYear})`,
          data: lastYearData.map(m => m.stockIn),
          backgroundColor: "rgba(34,197,94,0.4)", borderColor: "#22c55e",
          borderWidth: 1, borderRadius: 4, borderSkipped: false
        },
        {
          label: `Stock Out (${prevYear})`,
          data: lastYearData.map(m => m.sold),
          backgroundColor: "rgba(59,130,246,0.4)", borderColor: "#3b82f6",
          borderWidth: 1, borderRadius: 4, borderSkipped: false
        }
      ]
    },
    options: baseOpts
  });

  // Summary — totals for the latest year in range vs prev year.
  const latestData   = yearData[targetYear];
  const totalStockIn = latestData.reduce((s, m) => s + m.stockIn, 0);
  const totalSold    = latestData.reduce((s, m) => s + m.sold,    0);
  const lastStockIn  = lastYearData.reduce((s, m) => s + m.stockIn, 0);
  const lastSold     = lastYearData.reduce((s, m) => s + m.sold,    0);

  const peakInMonth  = latestData.reduce((best, m, i) => m.stockIn > latestData[best].stockIn ? i : best, 0);
  const peakOutMonth = latestData.reduce((best, m, i) => m.sold    > latestData[best].sold    ? i : best, 0);

  const stockInTrend = getTrendIndicator(totalStockIn, lastStockIn);
  const soldTrend    = getTrendIndicator(totalSold,    lastSold);

  const rangeStr = displayYears.length > 1
    ? `${displayYears[0]}–${targetYear}`
    : String(targetYear);

  setChartSummary('chartStock',
    `Showing <strong>${rangeStr}</strong>. In <strong>${targetYear}</strong>, ` +
    `<strong>${totalStockIn.toLocaleString()}</strong> units were received ` +
    `<span class="trend-badge ${stockInTrend.cls}">${stockInTrend.text} vs ${prevYear}</span> ` +
    `and <strong>${totalSold.toLocaleString()}</strong> units went out ` +
    `<span class="trend-badge ${soldTrend.cls}">${soldTrend.text} vs ${prevYear}</span>. ` +
    `Peak receiving was <strong>${monthNames[peakInMonth]} ${targetYear}</strong>, ` +
    `peak sales <strong>${monthNames[peakOutMonth]} ${targetYear}</strong>.`
  );
}

/**
 * Renders the Inventory Status doughnut chart.
 * Classifies each active product as In Stock, Low Stock, or Out of
 * Stock based on its current stock level vs. its low-stock threshold.
 * Also injects a custom HTML legend below the chart.
 * Respects the active date range filter via isInRange().
 *
 * @param {QuerySnapshot} productsSnap — snapshot of the products collection
 */
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

  // Inject a custom HTML legend since Chart.js's built-in legend is hidden.
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

  const total = inStock + lowStock + outOfStock;
  const pctOk = total ? Math.round((inStock / total) * 100) : 0;
  const cls = outOfStock > 0 ? 'insight-danger' : lowStock > 0 ? 'insight-warn' : 'insight-ok';
  setChartSummary('chartInventory',
    `<span class="${cls}">${pctOk}% of products</span> are well-stocked. ` +
    (outOfStock > 0 ? `<strong>${outOfStock}</strong> product${outOfStock !== 1 ? 's' : ''} are completely out of stock and need immediate restocking. ` : '') +
    (lowStock > 0 ? `<strong>${lowStock}</strong> are running low and approaching their threshold.` : outOfStock === 0 ? 'No urgent stock issues detected.' : '')
  );
}

/**
 * Renders the Products by Category horizontal bar chart.
 * Merges the categories collection (to include empty categories)
 * with the products collection, counts products per category,
 * then plots the top 8 by count.
 * Respects the active date range filter via isInRange().
 *
 * @param {QuerySnapshot} productsSnap   — snapshot of the products collection
 * @param {QuerySnapshot} categoriesSnap — snapshot of the categories collection
 */
function renderCategoryChart(productsSnap, categoriesSnap) {
  const categoryCount = {};

  // Seed the map with all non-archived categories so empty ones show as 0.
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

  const topCat = sorted[0];
  const topName = topCat ? topCat[0] : null;
  const topVal  = topCat ? topCat[1] : 0;
  setChartSummary('chartCategory',
    topName
      ? `<strong>${topName}</strong> is your largest category with <strong>${topVal}</strong> product${topVal !== 1 ? 's' : ''}. ` +
        `You have <strong>${sorted.length}</strong> active ${sorted.length === 1 ? 'category' : 'categories'} with at least one product.`
      : 'No category data to display yet.'
  );
}

/**
 * Renders the Low Stock Alert bar chart.
 * Plots the top 8 lowest-stock products alongside their thresholds
 * so reorder urgency is immediately visible. Out-of-stock bars are
 * rendered in red; low-stock bars in amber.
 * Shows an empty state when all products are well stocked.
 * Respects the active date range filter via isInRange().
 *
 * @param {QuerySnapshot} productsSnap — snapshot of the products collection
 */
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

  // Sort ascending by stock level so the most urgent items appear first.
  lowItems.sort((a, b) => a.stock - b.stock);
  const top = lowItems.slice(0, 8);

  const loadingEl = document.getElementById('chartLoadingLowStock');
  const emptyEl   = document.getElementById('chartLowStockEmpty');
  const canvas    = document.getElementById('chartLowStock');

  if (loadingEl) loadingEl.style.display = 'none';

  // Show the empty state and hide the canvas if nothing is low stock.
  if (top.length === 0) {
    if (emptyEl) emptyEl.style.display = 'flex';
    if (canvas)  canvas.style.display  = 'none';
    setChartSummary('chartLowStock', 'All active products are above their low-stock thresholds.');
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
        // Bar colour: red for out-of-stock, amber for low stock.
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

  const outCount = top.filter(i => i.stock === 0).length;
  const cls = outCount > 0 ? 'insight-danger' : 'insight-warn';
  setChartSummary('chartLowStock',
    `<span class="${cls}">${top.length}</span> product${top.length !== 1 ? 's' : ''} need attention. ` +
    (outCount > 0 ? `<strong>${outCount}</strong> ${outCount === 1 ? 'is' : 'are'} completely out of stock. ` : '') +
    `The most urgent is <strong>${top[0].name}</strong> with only <strong>${top[0].stock}</strong> unit${top[0].stock !== 1 ? 's' : ''} remaining.`
  );
}


// ============================================================
// SECTION 8 — EXPORT HELPERS
// Utility functions for generating and downloading CSV and Excel
// files. All report generators call exportData() which routes
// to the correct format based on the user's dropdown selection.
// ============================================================

/**
 * Reads the currently selected export format from the format dropdown.
 *
 * @returns {"csv"|"xlsx"}
 */
function getSelectedFormat() { return document.getElementById("exportFormat")?.value || "csv"; }

/**
 * Converts an array of plain objects to a CSV string.
 * Values containing commas, double-quotes, or newlines are wrapped
 * in double-quotes and internal quotes are escaped (RFC 4180).
 *
 * @param {Object[]} data — array of flat objects (all the same keys)
 * @returns {string} — CSV text
 */
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

/**
 * Triggers a browser file download for the given CSV string.
 * Creates a temporary <a> element, assigns a Blob URL, clicks it,
 * then immediately revokes the URL to release memory.
 *
 * @param {string} filename — desired file name (including .csv extension)
 * @param {string} data     — CSV content string
 */
function downloadCSV(filename, data) {
  const blob = new Blob([data], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * Triggers a browser file download for the given data as an Excel
 * workbook using the SheetJS (XLSX) library.
 *
 * @param {string}   filename — desired file name (including .xlsx extension)
 * @param {Object[]} data     — array of flat objects to write as a worksheet
 */
function downloadExcel(filename, data) {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook  = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
  XLSX.writeFile(workbook, filename);
}

/**
 * Routes a report dataset to the correct download function based on
 * the user's selected export format (CSV or Excel).
 * Shows an alert if the dataset is empty.
 *
 * @param {string}   filename — base file name without extension
 * @param {Object[]} data     — report rows to export
 */
function exportData(filename, data) {
  if (!data || data.length === 0) { alert("No data found to export for this report."); return; }
  const format = getSelectedFormat();
  if (format === "csv") downloadCSV(filename + ".csv", convertToCSV(data));
  else downloadExcel(filename + ".xlsx", data);
}

/**
 * Toggles the loading state of a report generation button.
 * Saves the original button HTML so it can be restored after the
 * async operation completes.
 *
 * @param {Element} btn     — the button element to update
 * @param {boolean} loading — true to show spinner, false to restore
 */
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


// ============================================================
// SECTION 9 — REPORT GENERATORS
// Each function fetches a focused slice of Firestore data,
// shapes it into a flat array of row objects, appends summary
// rows where applicable, and hands it to exportData().
// All functions manage their own button loading state.
// ============================================================

/**
 * Generates and exports the full Inventory Report.
 * Includes all active products with their status, value, and a
 * grand-total summary row at the bottom.
 * Sorted in fetch order (unsorted); status is derived on the fly.
 *
 * @param {Element} btn — the triggering button element
 */
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

    // Append a totals row for quick reference in the exported file.
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

/**
 * Generates and exports the Category Summary Report.
 * Merges the categories collection with products to produce one
 * row per category, including total products, stock, value, and
 * status breakdowns. Sorted by total products descending.
 *
 * @param {Element} btn — the triggering button element
 */
async function loadCategoryReport(btn) {
  setButtonLoading(btn, true);
  try {
    const [productsSnap, categoriesSnap] = await Promise.all([
      getDocs(collection(db, "products")),
      getDocs(collection(db, "categories"))
    ]);

    // Seed the map with all active categories (including empty ones).
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

/**
 * Generates and exports the Low Stock Report.
 * Includes only products at or below their threshold, sorted with
 * out-of-stock items first, then by ascending stock level.
 * Alerts the user if all products are well stocked (no rows to export).
 *
 * @param {Element} btn — the triggering button element
 */
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

    // Sort: out-of-stock first, then by ascending stock level.
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

/**
 * Generates and exports the Activity Log Report.
 * Fetches the most recent 500 activity log entries, filters them
 * by the active date range, and classifies each action into a
 * human-readable Action Type (Added, Updated, Deleted, etc.).
 *
 * @param {Element} btn — the triggering button element
 */
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

/**
 * Generates and exports the Stock Movement Report.
 * Fetches all transaction sub-collections within the active date
 * range's year span, filters by the active date range, excludes
 * cancelled transactions, and exports one row per transaction.
 *
 * @param {Element} btn — the triggering button element
 */
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

/**
 * Returns the current date as a YYYY-MM-DD string.
 * Used to append a datestamp to exported file names
 * (e.g. "InventoryReport_2025-04-22.csv").
 *
 * @returns {string}
 */
function getDateStamp() { return new Date().toISOString().split('T')[0]; }


// ============================================================
// SECTION 10 — EVENT LISTENER SETUP
// attachReportListeners() is called once the user is confirmed
// as an admin. It wires up all export buttons and initialises
// the date filter. Kept separate from the Auth listener so
// non-admin users never attach these listeners at all.
// ============================================================

/**
 * Attaches click listeners to all report export buttons and
 * initialises the date filter UI. Called only for admin users.
 */
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


// ============================================================
// EXPORTS
// Named exports allow other modules or unit tests to reuse
// individual helpers without importing the entire module.
// ============================================================
export { getCachedUserData, setDateRange, isInRange, formatRangeLabel, getTrendIndicator, convertToCSV, getDateStamp };
