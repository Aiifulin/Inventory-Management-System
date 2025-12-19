import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

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

// --- HARDCODED ADMIN ID ---
const ADMIN_UID = "eisTKTAY9LfdMpXZ7ebo0spRDAN2";

// Global Chart Instances (so we can destroy them before re-rendering)
let barChartInstance = null;
let pieChartInstance = null;

// --- AUTH LISTENER ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log("User Logged In:", user.uid);

        if (user.uid !== ADMIN_UID) {
            const addBtn = document.querySelector('.btn-add'); 
            if (addBtn) addBtn.style.display = 'none';
        }

        loadDashboardStats();

    } else {
        window.location.href = "Login.html";
    }
});

// --- LOAD STATS LOGIC ---
async function loadDashboardStats() {
    try {
        const querySnapshot = await getDocs(collection(db, "products"));
        const products = [];
        
        // 1. Process Data for Charts
        const categoryMap = {}; // Will store { "Furniture": { count: 0, value: 0 } }

        querySnapshot.forEach((doc) => {
            const p = doc.data();
            products.push(p);

            // Calculate for Stats
            const stock = Number(p.stock) || 0;
            const price = Number(p.price) || 0;
            const cat = p.category || "Uncategorized";
            const itemValue = stock * price;

            // Aggregate for Charts
            if (!categoryMap[cat]) {
                categoryMap[cat] = { count: 0, value: 0 };
            }
            categoryMap[cat].count += 1;       // Count products
            categoryMap[cat].value += itemValue; // Sum Value
        });

        // 2. Calculate Dashboard Top Cards
        const totalProducts = products.length;
        const categoriesCount = Object.keys(categoryMap).length;
        
        const lowStock = products.filter(p => {
            const stock = Number(p.stock) || 0;
            const threshold = Number(p.lowStockThreshold) || 10;
            return stock <= threshold;
        }).length;
        
        const totalValue = products.reduce((sum, p) => {
            return sum + ((Number(p.price) || 0) * (Number(p.stock) || 0));
        }, 0);

        // 3. Update HTML Text
        updateStat("statTotalProducts", totalProducts);
        updateStat("statCategories", categoriesCount);
        updateStat("statLowStock", lowStock);
        
        const formattedValue = totalValue.toLocaleString('en-PH', {
            style: 'currency',
            currency: 'PHP',
            minimumFractionDigits: 2
        });
        updateStat("statTotalValue", formattedValue);

        // 4. RENDER CHARTS
        initCharts(categoryMap);

    } catch (error) {
        console.error("Error loading stats:", error);
    }
}

// --- CHART RENDERING FUNCTION ---
function initCharts(dataMap) {
    const labels = Object.keys(dataMap);
    const counts = labels.map(cat => dataMap[cat].count);
    const values = labels.map(cat => dataMap[cat].value);

    // 1. Define Colors (Shared between Chart and Legend)
    const chartColors = [
        '#0f172a', // Dark Blue
        '#3b82f6', // Bright Blue
        '#64748b', // Slate Gray
        '#cbd5e1', // Light Gray
        '#f59e0b', // Orange
        '#10b981', // Green
        '#ef4444'  // Red
    ];

    // --- BAR CHART (Products per Category) ---
    const ctxBar = document.getElementById('barChart').getContext('2d');
    if (barChartInstance) barChartInstance.destroy();

    barChartInstance = new Chart(ctxBar, {
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

    // --- PIE CHART (Value Distribution) ---
    const ctxPie = document.getElementById('pieChart').getContext('2d');
    if (pieChartInstance) pieChartInstance.destroy();

    pieChartInstance = new Chart(ctxPie, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: chartColors, // Use the variable
                hoverOffset: 4,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }, // HIDE default Chart.js legend
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

    // --- GENERATE CUSTOM HTML LEGEND ---
    const legendContainer = document.getElementById('pieLegend');
    if (legendContainer) {
        legendContainer.innerHTML = labels.map((label, index) => {
            const color = chartColors[index % chartColors.length]; // Cycle colors if more cats than colors
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