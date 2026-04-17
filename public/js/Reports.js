// Reports.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, getDocs, query,
  orderBy, limit, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { initLogoutModal } from "./logout-modal.js";
import { initializeFirestore, persistentLocalCache } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// --- CONFIG ---
const firebaseConfig = {
  apiKey: "AIzaSyBeaF2VKovHASuzhvZHzOoE0yB7QnBDej0",
  authDomain: "inventory-management-sys-baccc.firebaseapp.com",
  projectId: "inventory-management-sys-baccc",
  storageBucket: "inventory-management-sys-baccc.firebasestorage.app",
  messagingSenderId: "304433839568",
  appId: "1:304433839568:web:50dafae1296e6bb0d30dd5",
  measurementId: "G-68CR9JCJV8"
};

const app = initializeApp(firebaseConfig);
const db  = initializeFirestore(app, { localCache: persistentLocalCache() });
const auth = getAuth(app);

// Track chart instances so we can destroy before re-rendering
const chartInstances = {};

// ===============================
// DATE RANGE STATE
// ===============================
let activeDateRange = { from: null, to: null }; // null = no filter (All time)

function setDateRange(from, to) {
  activeDateRange = { from, to };
}

function isInRange(timestamp) {
  if (!activeDateRange.from && !activeDateRange.to) return true; // All time
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
  const pills    = document.querySelectorAll(".date-pill");
  const customWrap = document.getElementById("customDateWrap");
  const badge    = document.getElementById("activeRangeBadge");
  const btnApply = document.getElementById("btnApplyDate");

  pills.forEach(pill => {
    pill.addEventListener("click", () => {
      pills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");

      const range = pill.dataset.range;
      const now   = new Date();
      now.setHours(23, 59, 59, 999);

      if (range === "custom") {
        customWrap.classList.add("visible");
        return;
      }

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

      // Re-render charts + banner with new range
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

async function displayUserName(uid) {
  const nameEl = document.getElementById('userNameDisplay');
  if (!nameEl) return;
  const userData = await getCachedUserData(uid);
  nameEl.textContent = userData?.name || "User";
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    const userData = await getCachedUserData(user.uid);
    const isAdmin  = userData?.role?.toLowerCase() === 'admin';

    await displayUserName(user.uid);

    const main = document.getElementById('mainContent');

    if (!isAdmin) {
      main.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;
                    justify-content:center;height:60vh;text-align:center;
                    color:var(--text-secondary);">
          <i class="fas fa-lock" style="font-size:48px;margin-bottom:16px;"></i>
          <h2 style="margin:0 0 8px;color:var(--text-main);font-size:20px;">Access Denied</h2>
          <p style="margin:0;font-size:14px;">You do not have permission to view Reports.</p>
        </div>`;
      main.style.visibility = 'visible';
    } else {
      attachReportListeners();
      loadAllCharts(); // Load charts on page open
    }

    main.style.visibility = 'visible';

    const doSignOut = () => {
      localStorage.removeItem("user_session");
      localStorage.removeItem("user_uid");
      localStorage.removeItem("user_role");
      sessionStorage.clear();
      signOut(auth)
        .then(() => window.location.replace("index.html"))
        .catch(() => window.location.replace("index.html"));
    };
    const openLogoutModal = initLogoutModal(doSignOut);
    window.logout = function () { if (openLogoutModal) openLogoutModal(); };

  } else {
    window.location.href = "index.html";
  }
});

// ===============================
// CHART HELPERS
// ===============================

// Detect dark mode for chart colors
function isDark() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

function chartTextColor() {
  return isDark() ? '#cbd5e1' : '#475569';
}

function chartGridColor() {
  return isDark() ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
}

function destroyChart(id) {
  if (chartInstances[id]) {
    chartInstances[id].destroy();
    delete chartInstances[id];
  }
}

function showChart(canvasId, loadingId) {
  const canvas  = document.getElementById(canvasId);
  const loading = document.getElementById(loadingId);
  if (canvas)  canvas.style.display  = 'block';
  if (loading) loading.style.display = 'none';
}

// ===============================
// LOAD ALL CHARTS ON PAGE OPEN
// ===============================
async function loadAllCharts() {
  try {
    const [productsSnap, categoriesSnap, activitiesSnap] = await Promise.all([
      getDocs(collection(db, "products")),
      getDocs(collection(db, "categories")),
      getDocs(query(collection(db, "activities"), orderBy("timestamp", "desc"), limit(200)))
    ]);

    renderInventoryChart(productsSnap);
    renderCategoryChart(productsSnap, categoriesSnap);
    renderLowStockChart(productsSnap);
    renderActivityChart(activitiesSnap);
    renderInventorySummaryBanner(productsSnap);

  } catch (err) {
    console.error("Chart load error:", err);
  }
}

// ===============================
// CHART 1: INVENTORY — Donut (In Stock / Low Stock / Out of Stock)
// ===============================
function renderInventoryChart(productsSnap) {
  let inStock = 0, lowStock = 0, outOfStock = 0;

  productsSnap.forEach(docSnap => {
    const p = docSnap.data();
    if (p.archived === true) return;
    if (!isInRange(p.createdAt)) return;
    const stock     = Number(p.stock) || 0;
    const threshold = Number(p.lowStockThreshold) || 10;
    if (stock === 0)             outOfStock++;
    else if (stock <= threshold) lowStock++;
    else                         inStock++;
  });

  destroyChart('chartInventory');
  showChart('chartInventory', 'chartLoadingInventory');

  const ctx = document.getElementById('chartInventory').getContext('2d');
  chartInstances['chartInventory'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['In Stock', 'Low Stock', 'Out of Stock'],
      datasets: [{
        data: [inStock, lowStock, outOfStock],
        backgroundColor: ['#22c55e', '#f59e0b', '#ef4444'],
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      cutout: '68%',
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.raw} product(s)`
          }
        }
      }
    }
  });

  // Custom legend
  const legend = document.getElementById('legendInventory');
  if (legend) {
    const colors  = ['#22c55e', '#f59e0b', '#ef4444'];
    const labels  = ['In Stock', 'Low Stock', 'Out of Stock'];
    const values  = [inStock, lowStock, outOfStock];
    legend.innerHTML = labels.map((l, i) => `
      <div class="legend-item">
        <span class="legend-dot" style="background:${colors[i]}"></span>
        <span class="legend-label">${l}</span>
        <span class="legend-count">${values[i]}</span>
      </div>`).join('');
  }
}

// ===============================
// CHART 2: CATEGORY — Horizontal Bar (Products per category)
// ===============================
function renderCategoryChart(productsSnap, categoriesSnap) {
  const categoryCount = {};

  // Seed from active categories
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

  // Filter to categories that have at least 1 product, sort desc, top 8
  const sorted = Object.entries(categoryCount)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const labels = sorted.map(([k]) => k);
  const values = sorted.map(([, v]) => v);

  const palette = [
    '#3b82f6','#06b6d4','#8b5cf6','#f59e0b',
    '#22c55e','#ef4444','#ec4899','#f97316'
  ];

  destroyChart('chartCategory');
  showChart('chartCategory', 'chartLoadingCategory');

  const ctx = document.getElementById('chartCategory').getContext('2d');
  chartInstances['chartCategory'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Products',
        data: values,
        backgroundColor: labels.map((_, i) => palette[i % palette.length]),
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.raw} product(s)` }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            color: chartTextColor(),
            stepSize: 1,
            font: { size: 11 }
          },
          grid: { color: chartGridColor() }
        },
        y: {
          ticks: {
            color: chartTextColor(),
            font: { size: 11 }
          },
          grid: { display: false }
        }
      }
    }
  });
}

// ===============================
// CHART 3: LOW STOCK — Bar (current stock vs threshold, top 8 worst)
// ===============================
function renderLowStockChart(productsSnap) {
  const lowItems = [];

  productsSnap.forEach(docSnap => {
    const p = docSnap.data();
    if (p.archived === true) return;
    if (!isInRange(p.createdAt)) return;
    const stock     = Number(p.stock) || 0;
    const threshold = Number(p.lowStockThreshold) || 10;
    if (stock <= threshold) {
      lowItems.push({ name: p.name || 'Unknown', stock, threshold });
    }
  });

  // Sort: out-of-stock first, then by stock asc, top 8
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
        {
          label: 'Current Stock',
          data: top.map(i => i.stock),
          backgroundColor: top.map(i => i.stock === 0 ? '#ef4444' : '#f59e0b'),
          borderRadius: 4,
          borderSkipped: false
        },
        {
          label: 'Threshold',
          data: top.map(i => i.threshold),
          backgroundColor: 'rgba(148,163,184,0.25)',
          borderColor: 'rgba(148,163,184,0.6)',
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: chartTextColor(),
            font: { size: 11 },
            boxWidth: 12,
            padding: 10
          }
        },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw}` }
        }
      },
      scales: {
        x: {
          ticks: {
            color: chartTextColor(),
            font: { size: 10 },
            maxRotation: 30
          },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: chartTextColor(),
            font: { size: 11 },
            stepSize: 1
          },
          grid: { color: chartGridColor() }
        }
      }
    }
  });
}

// ===============================
// CHART 4: ACTIVITY — Doughnut (action type breakdown)
// ===============================
function renderActivityChart(activitiesSnap) {
  const counts = { Added: 0, Updated: 0, Deleted: 0, Archived: 0, Restored: 0, Other: 0 };

  activitiesSnap.forEach(docSnap => {
    const log    = docSnap.data();
    if (!isInRange(log.timestamp)) return;
    const action = (log.action || "").toLowerCase();
    if      (action.includes("add"))                                    counts.Added++;
    else if (action.includes("edit") || action.includes("update"))      counts.Updated++;
    else if (action.includes("delete"))                                 counts.Deleted++;
    else if (action.includes("archive"))                                counts.Archived++;
    else if (action.includes("restore"))                                counts.Restored++;
    else                                                                counts.Other++;
  });

  // Filter out zeros
  const entries = Object.entries(counts).filter(([, v]) => v > 0);
  const labels  = entries.map(([k]) => k);
  const values  = entries.map(([, v]) => v);
  const colors  = {
    Added:    '#22c55e',
    Updated:  '#3b82f6',
    Deleted:  '#ef4444',
    Archived: '#f59e0b',
    Restored: '#06b6d4',
    Other:    '#94a3b8'
  };

  destroyChart('chartActivity');
  showChart('chartActivity', 'chartLoadingActivity');

  const ctx = document.getElementById('chartActivity').getContext('2d');
  chartInstances['chartActivity'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: labels.map(l => colors[l] || '#94a3b8'),
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      cutout: '68%',
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} action(s)` }
        }
      }
    }
  });

  // Custom legend
  const legend = document.getElementById('legendActivity');
  if (legend) {
    legend.innerHTML = labels.map((l, i) => `
      <div class="legend-item">
        <span class="legend-dot" style="background:${colors[l]}"></span>
        <span class="legend-label">${l}</span>
        <span class="legend-count">${values[i]}</span>
      </div>`).join('');
  }
}

// ===============================
// INVENTORY SUMMARY BANNER
// ===============================
function renderInventorySummaryBanner(productsSnap) {
  let totalProducts = 0;
  let totalStock    = 0;
  let totalValue    = 0;

  productsSnap.forEach(docSnap => {
    const p = docSnap.data();
    if (p.archived === true) return;
    const stock = Number(p.stock) || 0;
    const price = Number(p.price) || 0;
    totalProducts++;
    totalStock += stock;
    totalValue += stock * price;
  });

  const banner = document.getElementById('inventorySummaryBanner');
  if (banner) banner.style.display = 'flex';

  const elProducts = document.getElementById('summaryTotalProducts');
  const elStock    = document.getElementById('summaryTotalStock');
  const elValue    = document.getElementById('summaryTotalValue');

  if (elProducts) elProducts.textContent = totalProducts.toLocaleString();
  if (elStock)    elStock.textContent    = totalStock.toLocaleString();
  if (elValue)    elValue.textContent    = `₱${totalValue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ===============================
// EXPORT HELPERS
// ===============================
function getSelectedFormat() {
  return document.getElementById("exportFormat")?.value || "csv";
}

function convertToCSV(data) {
  if (!data.length) return "";
  const escape = (val) => {
    const str = String(val ?? "");
    return str.includes(",") || str.includes('"') || str.includes('\n')
      ? `"${str.replace(/"/g, '""')}"`
      : str;
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
  if (!data || data.length === 0) {
    alert("No data found to export for this report.");
    return;
  }
  const format = getSelectedFormat();
  if (format === "csv") {
    downloadCSV(filename + ".csv", convertToCSV(data));
  } else {
    downloadExcel(filename + ".xlsx", data);
  }
}

function setButtonLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn.dataset.originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalHtml || '<i class="fa-solid fa-download"></i> Generate Report';
  }
}

// ===============================
// REPORT 1: INVENTORY REPORT
// ===============================
async function loadInventoryReport(btn) {
  setButtonLoading(btn, true);
  try {
    const snapshot = await getDocs(collection(db, "products"));
    const reportData = [];
    let grandTotalValue = 0;

    snapshot.forEach(docSnap => {
      const p = docSnap.data();
      if (p.archived === true) return;
      const stock     = Number(p.stock) || 0;
      const price     = Number(p.price) || 0;
      const threshold = Number(p.lowStockThreshold) || 10;
      const itemValue = stock * price;
      grandTotalValue += itemValue;

      let status = "In Stock";
      if (stock === 0)             status = "Out of Stock";
      else if (stock <= threshold) status = "Low Stock";

      reportData.push({
        "Product ID":            docSnap.id,
        "Product Name":          p.name || "",
        "Category":              p.category || "",
        "Price (₱)":             price.toFixed(2),
        "Stock":                 stock,
        "Low Stock Threshold":   threshold,
        "Status":                status,
        "Inventory Value (₱)":   itemValue.toFixed(2),
        "Date Added":            p.createdAt ? new Date(p.createdAt.seconds * 1000).toLocaleDateString() : "N/A"
      });
    });

    // Append a total row at the bottom
    if (reportData.length > 0) {
      reportData.push({
        "Product ID":          "—",
        "Product Name":        "TOTAL",
        "Category":            "—",
        "Price (₱)":           "—",
        "Stock":               reportData.reduce((s, r) => s + Number(r["Stock"]), 0),
        "Low Stock Threshold": "—",
        "Status":              "—",
        "Inventory Value (₱)": grandTotalValue.toFixed(2),
        "Date Added":          "—"
      });
    }

    exportData(`InventoryReport_${getDateStamp()}`, reportData);
  } catch (err) {
    console.error("Inventory report error:", err);
    alert("Error generating report: " + err.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

// ===============================
// REPORT 2: CATEGORY REPORT
// ===============================
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
          "Category Name":   c.name,
          "Total Products":  0,
          "Total Stock":     0,
          "Total Value (₱)": 0,
          "Out of Stock":    0,
          "Low Stock":       0,
          "In Stock":        0,
          "Date Created":    c.createdAt ? new Date(c.createdAt.seconds * 1000).toLocaleDateString() : "N/A"
        };
      }
    });

    productsSnap.forEach(docSnap => {
      const p = docSnap.data();
      if (p.archived === true) return;
      const cat       = p.category || "Uncategorized";
      const stock     = Number(p.stock)  || 0;
      const price     = Number(p.price)  || 0;
      const threshold = Number(p.lowStockThreshold) || 10;

      if (!categoryMap[cat]) {
        categoryMap[cat] = {
          "Category Name":   cat,
          "Total Products":  0,
          "Total Stock":     0,
          "Total Value (₱)": 0,
          "Out of Stock":    0,
          "Low Stock":       0,
          "In Stock":        0,
          "Date Created":    "N/A"
        };
      }

      categoryMap[cat]["Total Products"]++;
      categoryMap[cat]["Total Stock"] += stock;
      categoryMap[cat]["Total Value (₱)"] += stock * price;

      if (stock === 0)             categoryMap[cat]["Out of Stock"]++;
      else if (stock <= threshold) categoryMap[cat]["Low Stock"]++;
      else                         categoryMap[cat]["In Stock"]++;
    });

    const reportData = Object.values(categoryMap).map(c => ({
      ...c,
      "Total Value (₱)": Number(c["Total Value (₱)"]).toFixed(2)
    }));

    reportData.sort((a, b) => b["Total Products"] - a["Total Products"]);
    exportData(`CategoryReport_${getDateStamp()}`, reportData);
  } catch (err) {
    console.error("Category report error:", err);
    alert("Error generating report: " + err.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

// ===============================
// REPORT 3: LOW STOCK REPORT
// ===============================
async function loadLowStockReport(btn) {
  setButtonLoading(btn, true);
  try {
    const snapshot = await getDocs(collection(db, "products"));
    const reportData = [];

    snapshot.forEach(docSnap => {
      const p = docSnap.data();
      if (p.archived === true) return;
      const stock     = Number(p.stock)  || 0;
      const price     = Number(p.price)  || 0;
      const threshold = Number(p.lowStockThreshold) || 10;

      if (stock <= threshold) {
        reportData.push({
          "Product ID":    docSnap.id,
          "Product Name":  p.name || "",
          "Category":      p.category || "",
          "Current Stock": stock,
          "Threshold":     threshold,
          "Units Needed":  Math.max(0, threshold - stock + 1),
          "Price (₱)":     price.toFixed(2),
          "Status":        stock === 0 ? "Out of Stock" : "Low Stock",
          "Date Added":    p.createdAt ? new Date(p.createdAt.seconds * 1000).toLocaleDateString() : "N/A"
        });
      }
    });

    reportData.sort((a, b) => {
      if (a["Current Stock"] === 0 && b["Current Stock"] !== 0) return -1;
      if (a["Current Stock"] !== 0 && b["Current Stock"] === 0) return  1;
      return a["Current Stock"] - b["Current Stock"];
    });

    if (reportData.length === 0) {
      alert("Great news! All products are well stocked — no low stock items to report.");
      return;
    }

    exportData(`LowStockReport_${getDateStamp()}`, reportData);
  } catch (err) {
    console.error("Low stock report error:", err);
    alert("Error generating report: " + err.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

// ===============================
// REPORT 4: ACTIVITY REPORT
// ===============================
async function loadActivityReport(btn) {
  setButtonLoading(btn, true);
  try {
    const q        = query(collection(db, "activities"), orderBy("timestamp", "desc"), limit(200));
    const snapshot = await getDocs(q);
    const reportData = [];

    snapshot.forEach(docSnap => {
      const log    = docSnap.data();
      if (!isInRange(log.timestamp)) return;
      const action = (log.action || "").toLowerCase();
      let actionType = "Other";
      if      (action.includes("add"))                                    actionType = "Added";
      else if (action.includes("edit") || action.includes("update"))      actionType = "Updated";
      else if (action.includes("delete"))                                 actionType = "Deleted";
      else if (action.includes("archive"))                                actionType = "Archived";
      else if (action.includes("restore"))                                actionType = "Restored";

      reportData.push({
        "Date":         log.timestamp ? new Date(log.timestamp.seconds * 1000).toLocaleString() : "N/A",
        "Action":       log.action || "",
        "Action Type":  actionType,
        "Item":         log.target  || "",
        "Performed By": log.user    || "Admin"
      });
    });

    exportData(`ActivityReport_${getDateStamp()}`, reportData);
  } catch (err) {
    console.error("Activity report error:", err);
    alert("Error generating report: " + err.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

// ===============================
// HELPERS
// ===============================
function getDateStamp() {
  return new Date().toISOString().split('T')[0];
}

// ===============================
// EVENT LISTENERS
// ===============================
function attachReportListeners() {
  const btnInventory     = document.getElementById("btnInventory");
  const btnCategory      = document.getElementById("btnCategory");
  const btnLowStock      = document.getElementById("btnLowStock");
  const btnStockMovement = document.getElementById("btnStockMovement");

  if (btnInventory)     btnInventory.addEventListener("click",     () => loadInventoryReport(btnInventory));
  if (btnCategory)      btnCategory.addEventListener("click",      () => loadCategoryReport(btnCategory));
  if (btnLowStock)      btnLowStock.addEventListener("click",      () => loadLowStockReport(btnLowStock));
  if (btnStockMovement) btnStockMovement.addEventListener("click", () => loadActivityReport(btnStockMovement));
  initDateFilter();
}