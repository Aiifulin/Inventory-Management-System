// Reports.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { 
  getFirestore, collection, getDocs, query, where, orderBy, limit 
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

// ✅ Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ===============================
//  EXPORT HELPERS
// ===============================
function convertToCSV(data) {
  if (!data.length) return "";
  const headers = Object.keys(data[0]).join(",");
  const rows = data.map(obj => Object.values(obj).join(","));
  return [headers, ...rows].join("\n");
}

function downloadCSV(filename, data) {
  const blob = new Blob([data], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

function downloadExcel(filename, data) {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
  XLSX.writeFile(workbook, filename);
}

function exportData(filename, data) {
  const format = document.getElementById("exportFormat").value;
  if (format === "csv") {
    const csv = convertToCSV(data);
    downloadCSV(filename + ".csv", csv);
  } else {
    downloadExcel(filename + ".xlsx", data);
  }
}

// ===============================
//  ADMIN RESTRICTION
// ===============================
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const isAdmin = await checkAdminRole(user.uid);
    if (!isAdmin) {
      document.querySelector(".main-content").innerHTML = `
        <div class="access-denied">
          <h2>Access Denied</h2>
          <p>You do not have permission to view reports.</p>
        </div>
      `;
    } else {
      attachReportListeners();
    }
  } else {
    window.location.href = "Login.html";
  }
});

// Dummy role checker (replace with Firestore users collection logic)
async function checkAdminRole(uid) {
  // TODO: fetch user doc and check role === 'admin'
  return true; // placeholder
}

// ===============================
//  REPORT FUNCTIONS
// ===============================

// Inventory Report
async function loadInventoryReport() {
  const snapshot = await getDocs(collection(db, "products"));
  const reportData = [];

  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    reportData.push({
      Name: data.name || docSnap.id,
      Stock: data.stock || 0,
      Price: data.price || 0,
      Value: (data.stock || 0) * (data.price || 0)
    });
  });

  exportData("InventoryReport", reportData);
}

// Category Report
async function loadCategoryReport() {
  const snapshot = await getDocs(collection(db, "products"));
  const categoryMap = {};

  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    const cat = data.category || "Uncategorized";
    if (!categoryMap[cat]) categoryMap[cat] = { Count: 0, Stock: 0 };
    categoryMap[cat].Count++;
    categoryMap[cat].Stock += data.stock || 0;
  });

  const reportData = Object.entries(categoryMap).map(([cat, stats]) => ({
    Category: cat,
    Items: stats.Count,
    Stock: stats.Stock
  }));

  exportData("CategoryReport", reportData);
}

// Low Stock Report
async function loadLowStockReport() {
  const snapshot = await getDocs(collection(db, "products"));
  const reportData = [];

  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    const threshold = data.lowStockThreshold || 10;
    if ((data.stock || 0) <= threshold) {
      reportData.push({
        Name: data.name || docSnap.id,
        Stock: data.stock || 0,
        Threshold: threshold
      });
    }
  });

  exportData("LowStockReport", reportData);
}

// Stock Movement Report
async function loadStockMovementReport() {
  const q = query(
    collection(db, "activities"),
    where("action", "in", ["stock-in", "stock-out"]),
    orderBy("timestamp", "desc"),
    limit(20)
  );

  const snapshot = await getDocs(q);
  const reportData = [];

  snapshot.forEach(docSnap => {
    const log = docSnap.data();
    reportData.push({
      Action: log.action,
      Target: log.target,
      User: log.user,
      Timestamp: log.timestamp?.toDate().toLocaleString()
    });
  });

  exportData("StockMovementReport", reportData);
}

// ===============================
//  EVENT LISTENERS
// ===============================
function attachReportListeners() {
  const btnInventory = document.getElementById("btnInventory");
  const btnCategory = document.getElementById("btnCategory");
  const btnLowStock = document.getElementById("btnLowStock");
  const btnStockMovement = document.getElementById("btnStockMovement");

  if (btnInventory) btnInventory.addEventListener("click", loadInventoryReport);
  if (btnCategory) btnCategory.addEventListener("click", loadCategoryReport);
  if (btnLowStock) btnLowStock.addEventListener("click", loadLowStockReport);
  if (btnStockMovement) btnStockMovement.addEventListener("click", loadStockMovementReport);
}