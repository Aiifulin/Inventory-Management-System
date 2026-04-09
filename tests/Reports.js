// Reports.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, getDocs, query,
  orderBy, limit, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

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

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

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

async function checkAdminRole(uid) {
  const data = await getCachedUserData(uid);
  return data?.role?.toLowerCase() === 'admin';
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
      const userData = await getCachedUserData(user.uid);
      const isAdmin  = userData?.role?.toLowerCase() === 'admin';

      // Display role
      const roleEl = document.getElementById('userRoleDisplay');
      if (roleEl && userData?.role) {
          roleEl.textContent = userData.role.charAt(0).toUpperCase() + userData.role.slice(1);
      }

      const main = document.getElementById('mainContent');

      if (!isAdmin) {
          // Replace content BEFORE revealing so non-admins never see the reports UI
          main.innerHTML = `
          <div style="display:flex; flex-direction:column; align-items:center; 
                      justify-content:center; height:60vh; text-align:center; 
                      color:var(--text-secondary);">
              <i class="fas fa-lock" style="font-size:48px; margin-bottom:16px;"></i>
              <h2 style="margin:0 0 8px; color:var(--text-main); font-size:20px;">Access Denied</h2>
              <p style="margin:0; font-size:14px;">You do not have permission to view Settings.</p>
              
          </div>`;
      main.style.visibility = 'visible';
      } else {
          attachReportListeners();
      }

      // Reveal only after content is ready — no flicker either way
      main.style.visibility = 'visible';
      // =======================================================
      // Logout Confirmation Modal (shared pattern with Dashboard)
      // =======================================================
      const doSignOut = () => {
          localStorage.removeItem("user_session"); localStorage.removeItem("user_uid"); localStorage.removeItem("user_role");
          sessionStorage.clear();
          signOut(auth).then(() => window.location.replace("index.html")).catch(() => window.location.replace("index.html"));
      };
      
      const openLogoutModal = initLogoutModal(doSignOut);
      window.logout = function () { if (openLogoutModal) openLogoutModal(); }; 

  } else {
      window.location.href = "index.html";
  }
});

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
  const worksheet  = XLSX.utils.json_to_sheet(data);
  const workbook   = XLSX.utils.book_new();
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
    btn.innerHTML = '<i class="fa-solid fa-spinner"></i> Generating...';
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

    snapshot.forEach(docSnap => {
      const p = docSnap.data();
      if (p.archived === true) return; // skip archived
      const stock = Number(p.stock) || 0;
      const price = Number(p.price) || 0;
      const threshold = Number(p.lowStockThreshold) || 10;

      let status = "In Stock";
      if (stock === 0)          status = "Out of Stock";
      else if (stock <= threshold) status = "Low Stock";

      reportData.push({
        "Product ID":       docSnap.id,
        "Product Name":     p.name || "",
        "Category":         p.category || "",
        "Price (₱)":        price.toFixed(2),
        "Stock":            stock,
        "Low Stock Threshold": threshold,
        "Status":           status,
        "Inventory Value (₱)": (stock * price).toFixed(2),
        "Date Added":       p.createdAt ? new Date(p.createdAt.seconds * 1000).toLocaleDateString() : "N/A"
      });
    });

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

    // Build a map of all active categories
    const categoryMap = {};
    categoriesSnap.forEach(docSnap => {
      const c = docSnap.data();
      if (c.archived !== true && c.name) {
        categoryMap[c.name] = {
          "Category Name": c.name,
          "Total Products": 0,
          "Total Stock":    0,
          "Total Value (₱)": 0,
          "Out of Stock":   0,
          "Low Stock":      0,
          "In Stock":       0,
          "Date Created":   c.createdAt ? new Date(c.createdAt.seconds * 1000).toLocaleDateString() : "N/A"
        };
      }
    });

    // Tally products per category
    productsSnap.forEach(docSnap => {
      const p = docSnap.data();
      if (p.archived === true) return;
      const cat       = p.category || "Uncategorized";
      const stock     = Number(p.stock)  || 0;
      const price     = Number(p.price)  || 0;
      const threshold = Number(p.lowStockThreshold) || 10;

      if (!categoryMap[cat]) {
        categoryMap[cat] = {
          "Category Name": cat,
          "Total Products": 0,
          "Total Stock":    0,
          "Total Value (₱)": 0,
          "Out of Stock":   0,
          "Low Stock":      0,
          "In Stock":       0,
          "Date Created":   "N/A"
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

    // Sort by total products descending
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
          "Product ID":       docSnap.id,
          "Product Name":     p.name || "",
          "Category":         p.category || "",
          "Current Stock":    stock,
          "Threshold":        threshold,
          "Units Needed":     Math.max(0, threshold - stock + 1),
          "Price (₱)":        price.toFixed(2),
          "Status":           stock === 0 ? "Out of Stock" : "Low Stock",
          "Date Added":       p.createdAt ? new Date(p.createdAt.seconds * 1000).toLocaleDateString() : "N/A"
        });
      }
    });

    // Sort: out of stock first, then by stock ascending
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
      const log = docSnap.data();

      // Determine action category
      const action = (log.action || "").toLowerCase();
      let actionType = "Other";
      if (action.includes("add"))                                   actionType = "Added";
      else if (action.includes("edit") || action.includes("update")) actionType = "Updated";
      else if (action.includes("delete"))                            actionType = "Deleted";
      else if (action.includes("archive"))                           actionType = "Archived";
      else if (action.includes("restore"))                           actionType = "Restored";

      reportData.push({
        "Date":        log.timestamp ? new Date(log.timestamp.seconds * 1000).toLocaleString() : "N/A",
        "Action":      log.action || "",
        "Action Type": actionType,
        "Item":        log.target || "",
        "Performed By": log.user  || "Admin"
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
  const btnInventory    = document.getElementById("btnInventory");
  const btnCategory     = document.getElementById("btnCategory");
  const btnLowStock     = document.getElementById("btnLowStock");
  const btnStockMovement = document.getElementById("btnStockMovement");

  if (btnInventory)     btnInventory.addEventListener("click",     () => loadInventoryReport(btnInventory));
  if (btnCategory)      btnCategory.addEventListener("click",      () => loadCategoryReport(btnCategory));
  if (btnLowStock)      btnLowStock.addEventListener("click",      () => loadLowStockReport(btnLowStock));
  if (btnStockMovement) btnStockMovement.addEventListener("click", () => loadActivityReport(btnStockMovement));
}

// ===============================
// PURE HELPERS (EXPORT THESE)
// ===============================

export function convertToCSV(data) {
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

export function processInventoryData(products) {
  const reportData = [];

  products.forEach(({ id, data }) => {
    if (data.archived === true) return;

    const stock = Number(data.stock) || 0;
    const price = Number(data.price) || 0;
    const threshold = Number(data.lowStockThreshold) || 10;

    let status = "In Stock";
    if (stock === 0) status = "Out of Stock";
    else if (stock <= threshold) status = "Low Stock";

    reportData.push({
      "Product ID": id,
      "Product Name": data.name || "",
      "Category": data.category || "",
      "Stock": stock,
      "Status": status,
      "Inventory Value (₱)": (stock * price).toFixed(2)
    });
  });

  return reportData;
}

export function processLowStockData(products) {
  const reportData = [];

  products.forEach(({ id, data }) => {
    if (data.archived === true) return;

    const stock = Number(data.stock) || 0;
    const threshold = Number(data.lowStockThreshold) || 10;

    if (stock <= threshold) {
      reportData.push({
        "Product ID": id,
        "Stock": stock,
        "Threshold": threshold
      });
    }
  });

  return reportData.sort((a, b) => a["Stock"] - b["Stock"]);
}

export function getActionType(action = "") {
  const a = action.toLowerCase();

  if (a.includes("add")) return "Added";
  if (a.includes("edit") || a.includes("update")) return "Updated";
  if (a.includes("delete")) return "Deleted";
  if (a.includes("archive")) return "Archived";
  if (a.includes("restore")) return "Restored";

  return "Other";
}

// ✅ ADD THESE
export async function getCachedUserData(uid, dbInstance = db) {
  const key = `user_data_${uid}`;
  const cached = sessionStorage.getItem(key);
  if (cached) return JSON.parse(cached);

  try {
    const snap = await getDoc(doc(dbInstance, "users", uid));
    if (snap.exists()) {
      sessionStorage.setItem(key, JSON.stringify(snap.data()));
      return snap.data();
    }
  } catch (e) {
    console.error(e);
  }
  return null;
}

export async function checkAdminRole(uid, dbInstance = db) {
  const data = await getCachedUserData(uid, dbInstance);
  return data?.role?.toLowerCase() === 'admin';
}

export function getDateStamp() {
  return new Date().toISOString().split('T')[0];
}

export function doSignOut(authInstance) {
  localStorage.removeItem("user_session");
  localStorage.removeItem("user_uid");
  localStorage.removeItem("user_role");
  sessionStorage.clear();
  return signOut(authInstance);
}