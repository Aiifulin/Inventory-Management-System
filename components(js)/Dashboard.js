import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
// FIXED: Merged all Firestore imports into one line
import { getFirestore, collection, getDocs, query, orderBy, limit, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

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
const auth = getAuth(app);
const db = getFirestore(app);

// Global Chart Instances
let barChartInstance = null;
let pieChartInstance = null;

// --- AUTH LISTENER ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log("User Logged In:", user.uid);

        // 1. Update UI with User Role (Visual)
        displayUserRole(user.uid);

        // 2. Check Permission Logic
        const isAdmin = await checkAdminRole(user.uid);

        if (!isAdmin) {
            const addBtn = document.querySelector('.btn-add'); 
            if (addBtn) addBtn.style.display = 'none';
        }

        // 3. Load data
        loadDashboardStats();
        loadRecentActivities();

    } else {
        window.location.href = "Login.html";
    }
});

// --- HELPER: DISPLAY USER ROLE (UI) ---
async function displayUserRole(uid) {
    const roleEl = document.getElementById('userRoleDisplay');
    if (!roleEl) return;

    try {
        const docRef = doc(db, "users", uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            let roleName = data.role || "User";
            // Capitalize first letter (e.g. "admin" -> "Admin")
            roleName = roleName.charAt(0).toUpperCase() + roleName.slice(1);
            roleEl.textContent = roleName;
        } else {
            roleEl.textContent = "User"; // Fallback
        }
    } catch (error) {
        console.error("Error displaying role:", error);
        roleEl.textContent = "User";
    }
}

// --- HELPER: CHECK ADMIN ROLE (Logic) ---
async function checkAdminRole(uid) {
    try {
        const userDocRef = doc(db, "users", uid);
        const userSnap = await getDoc(userDocRef);
        
        if (userSnap.exists()) {
            const userData = userSnap.data();
            return (userData.role && userData.role.toLowerCase() === 'admin');
        }
        return false;
    } catch (error) {
        console.error("Error checking role:", error);
        return false; 
    }
}

// --- LOAD STATS & LOW STOCK LOGIC ---
async function loadDashboardStats() {
    try {
        const querySnapshot = await getDocs(collection(db, "products"));
        const products = [];
        const lowStockItems = []; 
        
        const categoryMap = {}; 

        querySnapshot.forEach((doc) => {
            const p = doc.data();
            products.push(p);

            const stock = Number(p.stock) || 0;
            const price = Number(p.price) || 0;
            const threshold = Number(p.lowStockThreshold) || 10;
            const cat = p.category || "Uncategorized";
            const itemValue = stock * price;

            if (!categoryMap[cat]) {
                categoryMap[cat] = { count: 0, value: 0 };
            }
            categoryMap[cat].count += 1;        
            categoryMap[cat].value += itemValue; 

            if (stock <= threshold) {
                lowStockItems.push({
                    name: p.name,
                    stock: stock,
                    imageUrl: p.imageUrl,
                    threshold: threshold
                });
            }
        });

        const totalProducts = products.length;
        const categoriesCount = Object.keys(categoryMap).length;
        const lowStockCount = lowStockItems.length;
        
        const totalValue = products.reduce((sum, p) => {
            return sum + ((Number(p.price) || 0) * (Number(p.stock) || 0));
        }, 0);

        updateStat("statTotalProducts", totalProducts);
        updateStat("statCategories", categoriesCount);
        updateStat("statLowStock", lowStockCount);
        
        const formattedValue = totalValue.toLocaleString('en-PH', {
            style: 'currency',
            currency: 'PHP',
            minimumFractionDigits: 2
        });
        updateStat("statTotalValue", formattedValue);

        initCharts(categoryMap);
        renderLowStockTable(lowStockItems);

    } catch (error) {
        console.error("Error loading stats:", error);
    }
}

// --- HELPER: RENDER LOW STOCK TABLE ---
function renderLowStockTable(items) {
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
        let pillClass = "pill-orange";
        let statusText = "Low Stock";
        
        if (item.stock === 0) {
            pillClass = "pill-red";
            statusText = "Out of Stock";
        }

        let imgTag = '<div style="display:inline-block; width:32px; height:32px; background:#f3f4f6; border-radius:6px; margin-right:10px; vertical-align:middle; text-align:center; line-height:32px;"><i class="fas fa-box" style="font-size:12px; color:#9ca3af;"></i></div>';
        if (item.imageUrl) {
            imgTag = `<img src="${item.imageUrl}" class="sm-product-img" alt="img">`;
        }

        html += `
            <tr>
                <td>
                    ${imgTag}
                    <span style="font-weight:500;">${item.name}</span>
                </td>
                <td style="font-family:monospace; font-size:14px;">${item.stock}</td>
                <td><span class="pill ${pillClass}">${statusText}</span></td>
            </tr>
        `;
    });

    tableBody.innerHTML = html;
}

// --- LOAD RECENT ACTIVITIES ---
async function loadRecentActivities() {
    const activityContainer = document.querySelector('.activity-content');
    if (!activityContainer) return; 

    try {
        const q = query(
            collection(db, "activities"), 
            orderBy("timestamp", "desc"), 
            limit(5)
        );

        const querySnapshot = await getDocs(q);
        
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
            
            let timeString = "Just now";
            if (data.timestamp) {
                const date = data.timestamp.toDate(); 
                timeString = date.toLocaleString('en-US', { 
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
                });
            }

            let iconClass = "fa-info";
            let colorClass = "";
            const actionLower = (data.action || "").toLowerCase(); 
            
            if (actionLower.includes("add")) {
                iconClass = "fa-plus";
                colorClass = "act-add";
            } else if (actionLower.includes("edit") || actionLower.includes("update")) {
                iconClass = "fa-pen";
                colorClass = "act-edit";
            } else if (actionLower.includes("delete") || actionLower.includes("remove")) {
                iconClass = "fa-trash";
                colorClass = "act-delete";
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

    } catch (error) {
        console.error("Error fetching activities:", error);
        activityContainer.innerHTML = `<div style="color:red; text-align:center; padding:20px;">Error: ${error.message}</div>`;
    }
}

// --- CHART RENDERING FUNCTION ---
function initCharts(dataMap) {
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
                datasets: [{
                    label: 'Number of Products',
                    data: counts,
                    backgroundColor: '#0f172a',
                    borderRadius: 4
                }]
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
                datasets: [{
                    data: values,
                    backgroundColor: chartColors,
                    hoverOffset: 4,
                    borderWidth: 0
                }]
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

function updateStat(id, value) {
    const el = document.getElementById(id);
    if(el) el.innerText = value;
}

// --- UI EVENT LISTENERS ---
document.addEventListener("DOMContentLoaded", () => {
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const closeBtn = document.getElementById('closeBtn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');

    function toggleSidebar() {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('show');
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
    }

    if (hamburgerBtn) {
        hamburgerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSidebar();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', closeSidebar);
    }

    if (overlay) {
        overlay.addEventListener('click', closeSidebar);
    }
});

// --- LOGOUT FUNCTION ---
window.logout = function() {
    sessionStorage.removeItem("user_session");
    sessionStorage.removeItem("user_uid");
    sessionStorage.removeItem("user_role");

    signOut(auth).then(() => {
        window.location.replace("Login.html");
    }).catch((error) => {
        console.error("Logout Error:", error);
        window.location.replace("Login.html");
    });
};