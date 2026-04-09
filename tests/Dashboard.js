// ==========================================
// 1. IMPORTS (Standard NPM)
// ==========================================
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { 
    getFirestore, collection, getDocs, query, 
    orderBy, limit, doc, getDoc, onSnapshot 
} from "firebase/firestore";

// ==========================================
// 2. CONFIGURATION
// ==========================================
export const firebaseConfig = {
    apiKey: "AIzaSyBeaF2VKovHASuzhvZHzOoE0yB7QnBDej0",
    authDomain: "inventory-management-sys-baccc.firebaseapp.com",
    projectId: "inventory-management-sys-baccc",
    storageBucket: "inventory-management-sys-baccc.firebasestorage.app",
    messagingSenderId: "304433839568",
    appId: "1:304433839568:web:50dafae1296e6bb0d30dd5",
    measurementId: "G-68CR9JCJV8"
};

let app, auth, db;
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
} catch (e) {
    // Suppress errors if running in a test environment
}

// Global Chart Instances
let barChartInstance = null;
let pieChartInstance = null;

// ==========================================
// 3. EXPORTED LOGIC (Testable Pure Functions)
// ==========================================

export async function checkAdminRole(uid, dbInstance = db) {
    try {
        const userDocRef = doc(dbInstance, "users", uid);
        const userSnap = await getDoc(userDocRef);
        
        if (userSnap.exists()) {
            const userData = userSnap.data();
            return userData.role?.toLowerCase() === 'admin';
        }
        return false;
    } catch (error) {
        console.error("Error checking role:", error);
        return false; 
    }
}

// Pure function: takes data, returns stats. Used by both Real-time and Test functions.
export function calculateStats(products) {
    let totalValue = 0;
    const lowStockItems = [];
    const categoryMap = {};

    products.forEach(p => {
        const stock = Number(p.stock) || 0;
        const price = Number(p.price) || 0;
        const threshold = Number(p.lowStockThreshold) || 10;
        const cat = p.category || "Uncategorized";
        const itemValue = stock * price;

        if (!categoryMap[cat]) categoryMap[cat] = { count: 0, value: 0 };
        categoryMap[cat].count += 1;        
        categoryMap[cat].value += itemValue; 

        totalValue += itemValue;

        if (stock <= threshold) {
            lowStockItems.push({
                name: p.name,
                stock: stock,
                imageUrl: p.imageUrl,
                threshold: threshold
            });
        }
    });

    return {
        totalProducts: products.length,
        categoriesCount: Object.keys(categoryMap).length,
        lowStockCount: lowStockItems.length,
        totalValue: totalValue,
        categoryMap: categoryMap,
        lowStockItems: lowStockItems
    };
}

// ==========================================
// 4. DATA FETCHING (Dual Strategy)
// ==========================================

/**
 * STRATEGY 1: FETCH ONCE (For Tests)
 */
export async function loadDashboardStats(dbInstance = db) {
    try {
        const querySnapshot = await getDocs(collection(dbInstance, "products"));
        const products = [];
        querySnapshot.forEach((doc) => products.push(doc.data()));

        const stats = calculateStats(products);

        if (typeof document !== 'undefined') {
            updateUI(stats);
        }
        return stats; 
    } catch (error) {
        console.error("Error loading stats:", error);
        return null;
    }
}

/**
 * STRATEGY 2: LISTEN CONTINUOUSLY (For Live App)
 */
function setupDashboardStatsListener(dbInstance = db) {
    if (typeof document === 'undefined') return;

    const productsRef = collection(dbInstance, "products");

    onSnapshot(productsRef, (querySnapshot) => {
        const products = [];
        querySnapshot.forEach((doc) => products.push(doc.data()));

        const stats = calculateStats(products);
        updateUI(stats);

    }, (error) => {
        console.error("Error listening to stats:", error);
    });
}

// Helper to update DOM elements
function updateUI(stats) {
    updateStat("statTotalProducts", stats.totalProducts);
    updateStat("statCategories", stats.categoriesCount);
    updateStat("statLowStock", stats.lowStockCount);
    
    const formattedValue = stats.totalValue.toLocaleString('en-PH', {
        style: 'currency', currency: 'PHP', minimumFractionDigits: 2
    });
    updateStat("statTotalValue", formattedValue);

    if (typeof initCharts === 'function') initCharts(stats.categoryMap);
    if (typeof renderLowStockTable === 'function') renderLowStockTable(stats.lowStockItems);
}

// ==========================================
// 5. BROWSER HELPERS (UI Logic)
// ==========================================

function updateStat(id, value) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(id);
    if(el) el.innerText = value;
}

function renderLowStockTable(items) {
    if (typeof document === 'undefined') return;
    const tableBody = document.querySelector('#lowStockTable tbody');
    if (!tableBody) return;

    if (items.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; color:#9ca3af;">All products are well stocked!</td></tr>';
        return;
    }

    items.sort((a, b) => a.stock - b.stock);
    const displayItems = items.slice(0, 5);

    let html = '';
    displayItems.forEach(item => {
        let pillClass = item.stock === 0 ? "pill-red" : "pill-orange";
        let statusText = item.stock === 0 ? "Out of Stock" : "Low Stock";
        
        let imgTag = '<div style="display:inline-block; width:32px; height:32px; background:#f3f4f6; border-radius:6px; margin-right:10px;"></div>';
        if (item.imageUrl) {
            imgTag = `<img src="${item.imageUrl}" class="sm-product-img" alt="img">`;
        }

        html += `
            <tr>
                <td>${imgTag} <span style="font-weight:500;">${item.name}</span></td>
                <td style="font-family:monospace; font-size:14px;">${item.stock}</td>
                <td><span class="pill ${pillClass}">${statusText}</span></td>
            </tr>`;
    });
    tableBody.innerHTML = html;
}

// --- NEW HELPER: RELATIVE TIME FORMATTER ---
function formatTimeAgo(date) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    // If less than 60 seconds
    if (diffInSeconds < 60) {
        return "Just now";
    }

    // If less than 60 minutes
    if (diffInSeconds < 3600) {
        const minutes = Math.floor(diffInSeconds / 60);
        return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    }

    // If less than 2 hours (7200 seconds), show hours ago
    if (diffInSeconds < 7200) {
        const hours = Math.floor(diffInSeconds / 3600);
        return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    }

    // If more than 2 hours, return the exact date
    return date.toLocaleString('en-US', { 
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
    });
}

function setupRecentActivitiesListener(dbInstance = db) {
    if (typeof document === 'undefined') return;
    const activityContainer = document.querySelector('.activity-content');
    if (!activityContainer) return; 

    const q = query(
        collection(dbInstance, "activities"), 
        orderBy("timestamp", "desc"), 
        limit(5)
    );

    onSnapshot(q, (querySnapshot) => {
        if (querySnapshot.empty) {
            activityContainer.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:#9ca3af;">
                    <i class="fas fa-history" style="font-size: 24px; margin-bottom: 10px;"></i>
                    <span>No recent activities found.</span>
                </div>`;
            return;
        }

        let html = '<ul class="activity-list">';

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            
            // --- UPDATED DATE LOGIC ---
            let timeString = "Just now";
            if (data.timestamp) {
                const date = data.timestamp.toDate(); 
                // Use the new helper function
                timeString = formatTimeAgo(date);
            }
            // --------------------------

            let iconClass = "fa-info";
            let colorClass = "";
            const actionLower = (data.action || "").toLowerCase(); 
            
            if (actionLower.includes("add")) {
                iconClass = "fa-plus"; colorClass = "act-add";
            } else if (actionLower.includes("edit") || actionLower.includes("update")) {
                iconClass = "fa-pen"; colorClass = "act-edit";
            } else if (actionLower.includes("delete") || actionLower.includes("remove")) {
                iconClass = "fa-trash"; colorClass = "act-delete";
            }

            html += `
                <li class="activity-item">
                    <div class="activity-icon-box ${colorClass}">
                        <i class="fas ${iconClass}"></i>
                    </div>
                    <div class="activity-details">
                        <p class="activity-text">
                            <strong>${data.user || 'Admin'}</strong> ${data.action}: ${data.target}
                        </p>
                        <p class="activity-meta">${timeString}</p>
                    </div>
                </li>
            `;
        });

        html += '</ul>';
        activityContainer.innerHTML = html;
    }, (error) => {
        console.error("Error listening to activities:", error);
    });
}

function initCharts(dataMap) {
    if (typeof document === 'undefined' || typeof Chart === 'undefined') return;
    
    const labels = Object.keys(dataMap);
    const counts = labels.map(cat => dataMap[cat].count);
    const values = labels.map(cat => dataMap[cat].value);
    const chartColors = ['#0f172a', '#3b82f6', '#64748b', '#cbd5e1', '#f59e0b', '#10b981', '#ef4444'];

    const ctxBar = document.getElementById('barChart');
    if (ctxBar) {
        if (barChartInstance) barChartInstance.destroy();
        barChartInstance = new Chart(ctxBar.getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{ label: 'Number of Products', data: counts, backgroundColor: '#0f172a', borderRadius: 4 }]
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                plugins: { legend: { display: false } }, 
                scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } 
            }
        });
    }

    const ctxPie = document.getElementById('pieChart');
    if (ctxPie) {
        if (pieChartInstance) pieChartInstance.destroy();
        pieChartInstance = new Chart(ctxPie.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{ data: values, backgroundColor: chartColors, borderWidth: 0 }]
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                plugins: { 
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.label || '';
                                if (label) { label += ': '; }
                                if (context.parsed !== null) {
                                    label += new Intl.NumberFormat('en-PH', { 
                                        style: 'currency', currency: 'PHP' 
                                    }).format(context.parsed);
                                }
                                return label;
                            }
                        }
                    } 
                } 
            }
        });
    }

    const legendContainer = document.getElementById('pieLegend');
    if (legendContainer) {
        legendContainer.innerHTML = labels.map((label, index) => {
            const color = chartColors[index % chartColors.length];
            const value = values[index];
            const formattedValue = new Intl.NumberFormat('en-PH', { 
                style: 'currency', currency: 'PHP' 
            }).format(value);

            return `
                <div class="legend-item">
                    <div class="legend-left">
                        <span class="legend-color" style="background-color: ${color};"></span>
                        <span>${label}</span>
                    </div>
                    <span class="legend-value">${formattedValue}</span>
                </div>
            `;
        }).join('');
    }
}

// ==========================================
// 6. BROWSER INIT LOGIC
// ==========================================
if (typeof window !== 'undefined') {

    // Auth Listener
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            console.log("User Logged In:", user.uid);
            
            // Display Role
            const roleEl = document.getElementById('userRoleDisplay');
            if (roleEl) {
                getDoc(doc(db, "users", user.uid)).then(snap => {
                    if (snap.exists()) {
                        let r = snap.data().role || "User";
                        roleEl.textContent = r.charAt(0).toUpperCase() + r.slice(1);
                    }
                });
            }

            // Check Permission
            const isAdmin = await checkAdminRole(user.uid, db);
            if (!isAdmin) {
                const addBtn = document.querySelector('.btn-add'); 
                if (addBtn) addBtn.style.display = 'none';
            }

            // --- REAL-TIME LISTENERS FOR BROWSER ---
            setupDashboardStatsListener(db);
            setupRecentActivitiesListener(db);

        } else {
            window.location.href = "Login.html";
        }
    });

    // Logout
    window.logout = function() {
        sessionStorage.clear();
        signOut(auth).then(() => window.location.replace("Login.html"));
    };

    // Sidebar
    document.addEventListener("DOMContentLoaded", () => {
        const hamburgerBtn = document.getElementById('hamburgerBtn');
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('overlay');
        const closeBtn = document.getElementById('closeBtn');

        if(hamburgerBtn) hamburgerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('open');
            overlay.classList.toggle('show');
        });

        const close = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };
        if(closeBtn) closeBtn.addEventListener('click', close);
        if(overlay) overlay.addEventListener('click', close);
    });
}

export function doSignOut(authInstance) {
    localStorage.removeItem("user_session");
    localStorage.removeItem("user_uid");
    localStorage.removeItem("user_role");
    sessionStorage.clear();
    return signOut(authInstance);
}