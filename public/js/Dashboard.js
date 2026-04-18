import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
    import { collection, query, orderBy, limit, where, doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
    import { initLogoutModal } from "./logout-modal.js";
    import { db, auth, storage } from "./firebase.js";


    // --- GLOBALS ---
    let barChartInstance = null;
    let pieChartInstance = null;
    let dashboardStage = {};
    const CACHE_KEY = 'dashboard_cache';

    // ================================================
    // CACHE HELPERS
    // ================================================
    function saveCache(data) {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
    }

    function loadCache() {
        try {
            const raw = sessionStorage.getItem(CACHE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function clearCache() {
        sessionStorage.removeItem(CACHE_KEY);
    }

    async function getCachedUserData(uid) {
        const CACHE_KEY_USER = `user_data_${uid}`;
        const cached = sessionStorage.getItem(CACHE_KEY_USER);
        if (cached) return JSON.parse(cached);
        try {
            const docSnap = await getDoc(doc(db, "users", uid));
            if (docSnap.exists()) {
                const data = docSnap.data();
                sessionStorage.setItem(CACHE_KEY_USER, JSON.stringify(data));
                return data;
            }
        } catch (err) {
            console.error("Error fetching user data:", err);
        }
        return null;
    }

    // ================================================
    // AUTH LISTENER — parallel: user data + dashboard load fire at the same time
    // ================================================
    onAuthStateChanged(auth, async (user) => {
        if (!user) { window.location.href = "index.html"; return; }

        // 🔥 Fire user data fetch AND dashboard load simultaneously
        const [userData] = await Promise.all([
            getCachedUserData(user.uid),
            loadDashboard()
        ]);

        // Apply UI that depends on role — data is already rendering in background
        const isAdmin = userData?.role?.toLowerCase() === 'admin';
        const nameEl  = document.getElementById('userNameDisplay');
        if (nameEl) nameEl.textContent = userData?.name || "User";

        const addBtn = document.getElementById('addProductBtn');
        if (addBtn) addBtn.style.display = isAdmin ? 'flex' : 'none';

        // Logout modal
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

    // ================================================
    // CORE LOAD FUNCTION
    // ================================================
    async function loadDashboard(forceRefresh = false) {
        const cached = loadCache();

        if (!forceRefresh && cached) {
            updateStat("statTotalProducts", cached.totalProducts);
            updateStat("statLowStock",      cached.lowStockCount);
            updateStat("statCategories",    cached.categoryCount);
            updateStat("statTotalValue",    cached.totalValue);
            initCharts(cached.categoryMap);
            renderLowStockTable(cached.lowStockItems);
            renderActivities(cached.activities);
            return;
        }

        await fetchAndCache();
    }

    async function fetchAndCache() {
        dashboardStage = {};
        setRefreshLoading(true);

        try {
            await Promise.all([
                loadStats(),
                loadRecentActivities(),
                loadCategoryCount()
            ]);
            saveCache(dashboardStage);
        } catch (err) {
            console.error("Dashboard load error:", err);
        } finally {
            setRefreshLoading(false);
        }
    }

    function setRefreshLoading(isLoading) {
        const btn = document.getElementById('refreshBtn');
        if (!btn) return;
        btn.disabled = isLoading;
        btn.classList.toggle('loading', isLoading);
    }

    // ================================================
    // DATA LOADERS
    // ================================================
    async function loadStats() {
        // 🔥 Filter archived server-side — don't fetch docs you'll discard
        const q = query(
            collection(db, "products"),
            where("archived", "==", false)
        );
        const snapshot = await getDocs(q);

        const products      = [];
        const lowStockItems = [];
        const categoryMap   = {};

        snapshot.forEach((docSnap) => {
            const p = docSnap.data();

            products.push(p);

            const stock     = Number(p.stock) || 0;
            const price     = Number(p.price) || 0;
            const threshold = Number(p.lowStockThreshold) || 10;
            const cat       = p.category || "Uncategorized";

            if (!categoryMap[cat]) categoryMap[cat] = { count: 0, value: 0 };
            categoryMap[cat].count += 1;
            categoryMap[cat].value += stock * price;

            if (stock <= threshold) {
                lowStockItems.push({ name: p.name, stock, imageUrl: p.imageUrl || null, threshold });
            }
        });

        const totalValue = products.reduce((sum, p) =>
            sum + ((Number(p.price) || 0) * (Number(p.stock) || 0)), 0);

        const formattedValue = totalValue.toLocaleString('en-PH', {
            style: 'currency', currency: 'PHP', minimumFractionDigits: 2
        });

        updateStat("statTotalProducts", products.length);
        updateStat("statLowStock",      lowStockItems.length);
        updateStat("statTotalValue",    formattedValue);
        initCharts(categoryMap);
        renderLowStockTable(lowStockItems);

        dashboardStage.totalProducts = products.length;
        dashboardStage.lowStockCount = lowStockItems.length;
        dashboardStage.totalValue    = formattedValue;
        dashboardStage.categoryMap   = categoryMap;
        dashboardStage.lowStockItems = lowStockItems;
    }

    async function loadRecentActivities() {
        const q = query(
            collection(db, "activities"),
            orderBy("timestamp", "desc"),
            limit(5)
        );
        const snapshot = await getDocs(q);

        const activities = [];
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            activities.push({
                user:      data.user   || 'Admin',
                action:    data.action || '',
                target:    data.target || '',
                timestamp: data.timestamp ? data.timestamp.toDate().toISOString() : null
            });
        });

        dashboardStage.activities = activities;
        renderActivities(activities);
    }

    async function loadCategoryCount() {
        // 🔥 Filter archived server-side
        const q = query(
            collection(db, "categories"),
            where("archived", "==", false)
        );
        const snapshot = await getDocs(q);
        updateStat("statCategories", snapshot.size);
        dashboardStage.categoryCount = snapshot.size;
    }

    // ================================================
    // RENDER HELPERS
    // ================================================
    function renderLowStockTable(items) {
        const tableBody = document.querySelector('#lowStockTable tbody');
        if (!tableBody) return;

        if (items.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="3" style="text-align:center; padding:20px; color:#9ca3af;">
                        All products are well stocked!
                    </td>
                </tr>`;
            return;
        }

        items.sort((a, b) => a.stock - b.stock);
        const displayItems = items.slice(0, 5);

        let html = '';
        displayItems.forEach(item => {
            const pillClass  = item.stock === 0 ? "pill-red"    : "pill-orange";
            const statusText = item.stock === 0 ? "Out of Stock" : "Low Stock";

            const imgTag = item.imageUrl
                ? `<img src="${item.imageUrl}" class="sm-product-img" alt="img">`
                : `<div style="display:inline-block; width:32px; height:32px; background:#f3f4f6; border-radius:6px; margin-right:10px; vertical-align:middle; text-align:center; line-height:32px;">
                    <i class="fas fa-box" style="font-size:12px; color:#9ca3af;"></i>
                </div>`;

            html += `
                <tr>
                    <td>${imgTag}<span style="font-weight:500;">${item.name}</span></td>
                    <td style="font-family:monospace; font-size:14px;">${item.stock}</td>
                    <td><span class="pill ${pillClass}">${statusText}</span></td>
                </tr>`;
        });

        tableBody.innerHTML = html;
    }

    function renderActivities(activities) {
        const container = document.querySelector('.activity-content');
        if (!container) return;

        if (!activities || activities.length === 0) {
            container.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:#9ca3af;">
                    <i class="fas fa-history" style="font-size:24px; margin-bottom:10px;"></i>
                    <span>No recent activities found.</span>
                </div>`;
            return;
        }

        let html = '<ul class="activity-list">';

        activities.forEach((data) => {
            const timeString  = data.timestamp ? formatTimeAgo(new Date(data.timestamp)) : "Just now";
            const actionLower = data.action.toLowerCase();

            let iconClass  = "fa-info";
            let colorClass = "";

            if (actionLower.includes("add")) {
                iconClass = "fa-plus";  colorClass = "act-add";
            } else if (actionLower.includes("edit") || actionLower.includes("update")) {
                iconClass = "fa-pen";   colorClass = "act-edit";
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
                            <strong>${data.user}</strong> ${data.action}: ${data.target}
                        </p>
                        <p class="activity-meta">${timeString}</p>
                    </div>
                </li>`;
        });

        html += '</ul>';
        container.innerHTML = html;
    }

    // ================================================
    // CHARTS
    // ================================================
    function initCharts(dataMap) {
        const labels = Object.keys(dataMap);
        const counts = labels.map(cat => dataMap[cat].count);
        const values = labels.map(cat => dataMap[cat].value);

        const isDark    = document.documentElement.getAttribute('data-theme') === 'dark';
        const barColor  = isDark ? '#3b82f6' : '#0f172a';
        const textColor = isDark ? '#e5e7eb' : '#374151';
        const gridColor = isDark ? '#374151' : '#e5e7eb';
        const chartColors = ['#0f172a','#3b82f6','#64748b','#cbd5e1','#f59e0b','#10b981','#ef4444'];

        const ctxBar = document.getElementById('barChart');
        if (ctxBar) {
            if (barChartInstance) barChartInstance.destroy();
            barChartInstance = new Chart(ctxBar.getContext('2d'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Number of Products',
                        data: counts,
                        backgroundColor: barColor,
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: { stepSize: 1, color: textColor },
                            grid: { color: gridColor }
                        },
                        x: {
                            ticks: { color: textColor },
                            grid: { display: false }
                        }
                    }
                }
            });
        }

        const ctxPie = document.getElementById('pieChart');
        if (ctxPie) {
            if (pieChartInstance) pieChartInstance.destroy();
            pieChartInstance = new Chart(ctxPie.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels,
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
                                label(context) {
                                    let label = context.label ? context.label + ': ' : '';
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
            legendContainer.innerHTML = labels.map((label, i) => {
                const color = chartColors[i % chartColors.length];
                const formattedValue = new Intl.NumberFormat('en-PH', {
                    style: 'currency', currency: 'PHP'
                }).format(values[i]);

                return `
                    <div class="legend-item">
                        <div class="legend-left">
                            <span class="legend-color" style="background-color:${color};"></span>
                            <span>${label}</span>
                        </div>
                        <span class="legend-value">${formattedValue}</span>
                    </div>`;
            }).join('');
        }
    }

    // ================================================
    // UTILITIES
    // ================================================
    function updateStat(id, value) {
        const el = document.getElementById(id);
        if (el) el.innerText = value;
    }

    function formatTimeAgo(date) {
        const now = new Date();
        const diffInSeconds = Math.floor((now - date) / 1000);

        if (diffInSeconds < 60) return "Just now";

        const diffInMinutes = Math.floor(diffInSeconds / 60);
        if (diffInMinutes < 60) return `${diffInMinutes} minute${diffInMinutes !== 1 ? 's' : ''} ago`;

        const diffInHours = Math.floor(diffInMinutes / 60);
        if (diffInHours < 24) return `${diffInHours} hour${diffInHours !== 1 ? 's' : ''} ago`;

        return date.toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    }

    // ================================================
    // UI EVENT LISTENERS
    // ================================================
    document.addEventListener("DOMContentLoaded", () => {
        const hamburgerBtn = document.getElementById('hamburgerBtn');
        const closeBtn     = document.getElementById('closeBtn');
        const sidebar      = document.getElementById('sidebar');
        const overlay      = document.getElementById('overlay');
        const refreshBtn   = document.getElementById('refreshBtn');

        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => loadDashboard(true));
        }

        function toggleSidebar() {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('show');
        }
        function closeSidebar() {
            sidebar.classList.remove('open');
            overlay.classList.remove('show');
        }

        if (hamburgerBtn) hamburgerBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleSidebar(); });
        if (closeBtn)     closeBtn.addEventListener('click', closeSidebar);
        if (overlay)      overlay.addEventListener('click', closeSidebar);
    });