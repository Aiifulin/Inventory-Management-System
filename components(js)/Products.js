import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, collection, getDocs, doc, addDoc, serverTimestamp, getDoc, where, updateDoc    } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

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
const db = getFirestore(app);
const auth = getAuth(app);

// --- GLOBAL STATE ---
let allProducts = [];
let filteredProducts = []; 
let currentSortDir = 'asc';
let currentUser = null;
let isAdmin = false; 

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
    } catch (err) {
        console.error("Error fetching user data:", err);
    }
    return null;
}

// --- HELPER: CHECK ADMIN ROLE (Dynamic) ---
async function checkAdminRole(uid) {
    const data = await getCachedUserData(uid);
    return data?.role?.toLowerCase() === 'admin';
}

// --- HELPER: DISPLAY USER ROLE (UI) ---
async function displayUserRole(uid) {
    const roleEl = document.getElementById('userRoleDisplay');
    if (!roleEl) return;
    const data = await getCachedUserData(uid);
    const role = data?.role || "User";
    roleEl.textContent = role.charAt(0).toUpperCase() + role.slice(1);
}

// --- HELPER: ACTIVITY LOGGING FUNCTION ---
async function logActivity(action, targetName) {
    try {
        const userEmail = auth.currentUser ? auth.currentUser.email : "Admin";
        
        await addDoc(collection(db, "activities"), {
            action: action,          
            target: targetName,      
            user: userEmail,
            timestamp: serverTimestamp()
        });
        console.log("Activity logged successfully");
    } catch (e) {
        console.error("Error logging activity", e);
    }
}

// --- AUTH CHECK & INITIAL LOAD ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;

        // Both calls now share one cached Firestore read
        await displayUserRole(user.uid);
        isAdmin = await checkAdminRole(user.uid);

        localStorage.setItem("user_uid",  user.uid);
        localStorage.setItem("user_role", isAdmin ? "admin" : "user");

        // Reveal admin buttons ONLY after role is confirmed — no flash
        if (isAdmin) {
            const bulkBtn = document.getElementById('bulkUploadBtn');
            const addBtn  = document.getElementById('addProductBtn');
            if (bulkBtn) bulkBtn.style.display = 'flex';
            if (addBtn)  addBtn.style.display  = 'flex';
        }
        // Export is visible to everyone — show it now
        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) exportBtn.style.display = 'flex';

        fetchProducts();

    } else {
        window.location.href = "Login.html";
    }
});

// --- FETCH DATA ---
async function fetchProducts() {
    try {

        const querySnapshot = await getDocs(collection(db, "products"));

        allProducts = [];

        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();

            // Hide archived manually
            if (data.archived === true) return;

            allProducts.push({ id: docSnap.id, ...data });
        });

        applyFilters();

    } catch (error) {
        console.error("Error loading products:", error);
    }
}

// --- FILTER & SORT ---
function applyFilters() {
    const searchVal = document.getElementById("searchInput").value.trim().toLowerCase();
    const catVal = document.getElementById("filterCategory").value;
    const priceRangeVal = document.getElementById("filterPrice").value; 
    const statusVal = document.getElementById("filterStatus").value;
    const sortVal = document.getElementById("filterSort").value;
    

    let result = allProducts.filter(p => {
        const prodName = (p.name || "").toLowerCase();
        const prodCat = (p.category || "").toLowerCase();
        const prodId = (p.id || "").toLowerCase();

        let prodDate = "";
        if (p.createdAt && p.createdAt.toDate) {
            const d = p.createdAt.toDate();
            // Produces strings like "mar 17 2026", "march", "2026" — all searchable
            prodDate = d.toLocaleDateString("en-US", {
                month: 'long', day: 'numeric', year: 'numeric'
            }).toLowerCase();
            // Also add short month so "mar" matches "March"
            prodDate += " " + d.toLocaleDateString("en-US", { month: 'short' }).toLowerCase();
            // Also add numeric format so "3/17" or "17" matches
            prodDate += " " + d.toLocaleDateString("en-US");
        }

        const matchesSearch = prodName.includes(searchVal) || 
                              prodCat.includes(searchVal) || 
                              prodId.includes(searchVal) ||
                              prodDate.includes(searchVal);

        const matchesCategory = catVal === "" || p.category === catVal;
        
        let pStatus = 'in-stock';
        const stock = Number(p.stock) || 0;
        const price = Number(p.price) || 0;
        const threshold = Number(p.lowStockThreshold) || 10;
        
        if (stock === 0) pStatus = 'out-of-stock';
        else if (stock <= threshold) pStatus = 'low-stock';
        
        const matchesStatus = statusVal === "" || pStatus === statusVal;

        let matchesPrice = true;
        if (priceRangeVal) {
            if (priceRangeVal === "1000+") {
                matchesPrice = price >= 1000;
            } else {
                const [min, max] = priceRangeVal.split("-").map(Number);
                matchesPrice = price >= min && price <= max;
            }
        }

        return matchesSearch && matchesCategory && matchesStatus && matchesPrice;
    });

    result.sort((a, b) => {
        let valA, valB;
        if (sortVal === 'price') { valA = Number(a.price) || 0; valB = Number(b.price) || 0; }
        else if (sortVal === 'stock') { valA = Number(a.stock) || 0; valB = Number(b.stock) || 0; }
        else if (sortVal === 'date') { valA = a.createdAt?.seconds || 0; valB = b.createdAt?.seconds || 0; }
        else { valA = (a.name || "").toLowerCase(); valB = (b.name || "").toLowerCase(); }

        if (valA < valB) return currentSortDir === 'asc' ? -1 : 1;
        if (valA > valB) return currentSortDir === 'asc' ? 1 : -1;
        return 0;
    });

    filteredProducts = result;
    // DIRECTLY RENDER ALL ITEMS (No Pagination)
    renderTable(filteredProducts);
}

// --- RENDER TABLE ---
function renderTable(productsToRender) {
    const tableBody = document.getElementById("productTableBody");
    const mobileList = document.getElementById("mobileProductList");
    const tableHead = document.querySelector(".products-table thead tr");

    if (tableHead) {
        tableHead.innerHTML = `
            <th style="width: 80px;">ID</th> <th style="width: 35%;">Product</th>
            <th>Category</th>
            <th>Price</th>
            <th>Stock</th>
            <th>Status</th>
            <th>Added</th>
            <th>Actions</th>
        `;
    }

    if (tableBody) tableBody.innerHTML = "";
    if (mobileList) mobileList.innerHTML = "";

    if (productsToRender.length === 0) {
        if(tableBody) tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:#9ca3af;">No products found.</td></tr>`;
        if(mobileList) mobileList.innerHTML = `<div style="text-align:center; padding:30px; color:#9ca3af;">No products found.</div>`;
        return;
    }

    productsToRender.forEach(p => {
        const docId = p.id;
        const shortId = "#" + docId.slice(0, 6); 

        // UPDATED: Used var(--border-color) for inline borders
        let imageHtml = p.imageUrl 
            ? `<img src="${p.imageUrl}" alt="${p.name}" style="width: 45px; height: 45px; border-radius: 8px; object-fit: cover; border: 1px solid var(--border-color);">`
            : `<div class="product-img-placeholder"><i class="fa-regular fa-image"></i></div>`;

        let mobileImageHtml = p.imageUrl 
            ? `<img src="${p.imageUrl}" alt="${p.name}" style="width: 60px; height: 60px; border-radius: 8px; object-fit: cover; border: 1px solid var(--border-color);">`
            : `<div class="card-img"><i class="fa-regular fa-image"></i></div>`;

        let statusText = "In Stock";
        let statusClass = "in-stock";
        const stock = Number(p.stock) || 0;
        const threshold = Number(p.lowStockThreshold) || 10;
        if (stock === 0) { statusText = "Out of Stock"; statusClass = "out-of-stock"; }
        else if (stock <= threshold) { statusText = "Low Stock"; statusClass = "low-stock"; }

        let dateAdded = "N/A";
        if (p.createdAt && p.createdAt.toDate) {
            dateAdded = p.createdAt.toDate().toLocaleDateString("en-US", { month: 'short', day: 'numeric', year: 'numeric' });
        }

        let tagsHtml = (p.variations || []).map(v => 
            v.size ? `<span class="v-tag">${v.size}</span>` : ''
        ).join('');

        let attributesHtml = (p.attributes || []).map(a => 
            `<span class="v-tag" style="background-color: rgba(224, 242, 254, 0.2); color: #0284c7; border: 1px solid rgba(186, 230, 253, 0.3);">
                ${a.name}: ${a.value}
             </span>`
        ).join('');

        const allTags = tagsHtml + attributesHtml;

        const adminActions = isAdmin ? `
            <i class="fa-regular fa-pen-to-square" title="Edit" onclick="editProduct('${docId}')" style="cursor: pointer;"></i>
            <i class="fa-regular fa-trash-can delete-btn" data-id="${docId}" title="Delete" style="cursor: pointer;"></i>
        ` : '';

        const mobileAdminActions = isAdmin ? `
            <button class="btn-card-action" onclick="editProduct('${docId}')"><i class="fa-regular fa-pen-to-square"></i> Edit</button>
            <button class="btn-card-action btn-card-delete delete-btn" data-id="${docId}"><i class="fa-regular fa-trash-can"></i></button>
        ` : '';

        if (tableBody) {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td><span class="id-badge" title="${docId}">${shortId}</span></td>
                <td>
                    <div class="product-cell">
                        ${imageHtml}
                        <div class="product-info">
                            <h4>${p.name}</h4>
                            <div class="variation-tags" style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px;">
                                ${allTags} 
                            </div>
                        </div>
                    </div>
                </td>
                <td>${p.category}</td>
                <td>₱${Number(p.price).toFixed(2)}</td>
                <td>${p.stock}</td>
                <td><span class="status-pill ${statusClass}">${statusText}</span></td>
                <td>${dateAdded}</td>
                <td class="actions">
                    ${adminActions} 
                </td>
            `;
            tableBody.appendChild(row);
        }

        if (mobileList) {
            const card = document.createElement("div");
            card.className = "mobile-card";
            card.innerHTML = `
                <div class="mobile-id-header">ID: <span class="id-badge">${shortId}</span></div>
                <div class="card-top">
                    ${mobileImageHtml}
                    <div class="card-header-text">
                        <h3 class="card-title">${p.name}</h3>
                        <div class="mobile-tags" style="display: flex; gap: 4px; flex-wrap: wrap;">
                            ${allTags}
                        </div>
                    </div>
                    <div class="card-badge"><span class="status-pill ${statusClass}">${statusText}</span></div>
                </div>
                <div class="card-details-grid">
                    <div class="detail-item"><label>Price:</label> <span>₱${Number(p.price).toFixed(2)}</span></div>
                    <div class="detail-item"><label>Stock:</label> <span>${p.stock}</span></div>
                </div>
                <div class="card-actions">
                    ${mobileAdminActions} 
                </div>
            `;
            mobileList.appendChild(card);
        }
    });

    if(isAdmin) attachDeleteListeners();
}

// --- EDIT FUNCTION ---
window.editProduct = function(id) {
    if (isAdmin) {
        window.location.href = `Edit_Product.html?id=${id}`;
    } else {
        alert("Access Denied: Only Admin can edit products.");
    }
}

function confirmAction(productName) {
    const modal = document.getElementById('confirmModal');
    const nameSpan = document.getElementById('archive-product-name');
    const confirmBtn = document.getElementById('confirm-archive-btn');
    const cancelBtn = document.getElementById('cancel-archive-btn');
    
    nameSpan.innerText = productName;
    modal.style.display = 'flex';

    return new Promise((resolve) => {
        confirmBtn.onclick = () => {
            modal.style.display = 'none';
            resolve(true); // User clicked Yes
        };
        cancelBtn.onclick = () => {
            modal.style.display = 'none';
            resolve(false); // User clicked No
        };
    });
}

// --- DELETE FUNCTION WITH LOGGING ---
function attachDeleteListeners() {

    if (!isAdmin) return;

    document.querySelectorAll('.delete-btn').forEach(btn => {

        btn.addEventListener('click', async (e) => {

            const target = e.target.closest('.delete-btn');
            if (!target) return;

            const idToArchive = target.getAttribute('data-id');
            const productToArchive = allProducts.find(p => p.id === idToArchive);
            const nameToLog = productToArchive ? productToArchive.name : "Unknown Product";

            const isConfirmed = await confirmAction(nameToLog);
            if (!isConfirmed) return; // Exit if user cancels

            try {

                await updateDoc(doc(db, "products", idToArchive), {
                    archived: true,
                    archivedAt: serverTimestamp()
                });

                await logActivity("Archived Product", nameToLog);

                // Remove locally so no reload needed
                allProducts = allProducts.filter(p => p.id !== idToArchive);
                applyFilters();

                showToast("Product moved to Archive", "success");

            } catch (err) {
                console.error("Error archiving:", err);
                showToast("Error: " + err.message, "error");
            }
        });
    });
}

// --- EVENT LISTENERS ---
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("searchInput").addEventListener("input", applyFilters);
    document.getElementById("filterCategory").addEventListener("change", applyFilters);
    document.getElementById("filterPrice").addEventListener("change", applyFilters); 
    document.getElementById("filterStatus").addEventListener("change", applyFilters);
    document.getElementById("filterSort").addEventListener("change", applyFilters);
    
    const sortBtn = document.getElementById("sortDirBtn");
    if(sortBtn) {
        sortBtn.addEventListener("click", () => {
            currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
            const icon = document.getElementById("sortDirIcon");
            const text = document.getElementById("sortDirText");
            if(icon) icon.textContent = currentSortDir === 'asc' ? "↑" : "↓"; 
            if(text) text.textContent = currentSortDir === 'asc' ? "Ascending" : "Descending";
            applyFilters();
        });
    }

    const resetBtn = document.getElementById("resetFiltersBtn");
    if(resetBtn) {
        resetBtn.addEventListener("click", () => {
            document.getElementById("searchInput").value = "";
            document.getElementById("filterCategory").value = "";
            document.getElementById("filterPrice").value = "";
            document.getElementById("filterStatus").value = "";
            document.getElementById("filterSort").value = "name";
            
            currentSortDir = 'asc';
            const icon = document.getElementById("sortDirIcon");
            const text = document.getElementById("sortDirText");
            if(icon) icon.textContent = "↑";
            if(text) text.textContent = "Ascending";

            applyFilters();
        });
    }
});

document.getElementById('exportBtn').addEventListener('click', exportToExcel);

// --- LOGOUT FUNCTION ---
window.logout = function() {
    // Clear LOCAL storage now
    localStorage.removeItem("user_session");
    localStorage.removeItem("user_uid");
    localStorage.removeItem("user_role");
    
    // Also clear session just in case
    sessionStorage.clear();

    signOut(auth).then(() => {
        window.location.replace("Login.html");
    }).catch((error) => {
        console.error("Logout Error:", error);
        window.location.replace("Login.html");
    });
};

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    
    toast.innerHTML = `
        <i class="fas ${icon}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);

    // Auto-remove after 3 seconds
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function exportToExcel() {
    if (!allProducts || allProducts.length === 0) {
        showToast("No products available to export", "error");
        return;
    }

    // 1. Map the data to the specific columns you want
    const dataToExport = allProducts.map(p => ({
        "ID": p.id,
        "Product Name": p.name,
        "Category": p.category,
        "Price": `₱${p.price}`,
        "Stock": p.stock,
        "Status": p.stock <= 0 ? "Out of Stock" : (p.stock <= 10 ? "Low Stock" : "In Stock"),
        "Date Added": p.createdAt ? new Date(p.createdAt.seconds * 1000).toLocaleDateString() : "N/A"
    }));

    // 2. Create a worksheet from the data
    const worksheet = XLSX.utils.json_to_sheet(dataToExport);

    // 3. Create a new workbook and append the worksheet
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Products");

    // 4. Trigger the download
    const fileName = `Inventory_Report_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    
    showToast("Exporting Excel file...", "success");
}