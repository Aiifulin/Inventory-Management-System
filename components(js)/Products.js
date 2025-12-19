import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, collection, getDocs, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
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

// --- HARDCODED ADMIN ID ---
const ADMIN_UID = "eisTKTAY9LfdMpXZ7ebo0spRDAN2";

// --- GLOBAL STATE ---
let allProducts = [];
let currentSortDir = 'asc';
let currentUser = null;
let isAdmin = false; 

// --- AUTH CHECK & INITIAL LOAD ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        isAdmin = (user.uid === ADMIN_UID);
        
        // Hide/Show "Add Product" button
        const addBtn = document.querySelector('.btn-primary');
        if(addBtn) {
            addBtn.style.display = isAdmin ? "flex" : "none";
        }

        fetchProducts();
    } else {
        // Not logged in? Redirect
        window.location.href = "Login.html";
    }
});

// --- FETCH DATA ---
async function fetchProducts() {
    try {
        const querySnapshot = await getDocs(collection(db, "products"));
        allProducts = [];
        querySnapshot.forEach((doc) => {
            allProducts.push({ id: doc.id, ...doc.data() });
        });
        applyFilters();
    } catch (error) {
        console.error("Error loading products:", error);
    }
}

// --- FILTER & SORT (UPDATED) ---
function applyFilters() {
    const searchVal = document.getElementById("searchInput").value.trim().toLowerCase();
    
    const catVal = document.getElementById("filterCategory").value;
    const priceRangeVal = document.getElementById("filterPrice").value; // NEW
    const statusVal = document.getElementById("filterStatus").value;
    const sortVal = document.getElementById("filterSort").value;

    let filtered = allProducts.filter(p => {
        // 1. Search Logic (Name, Category, ID)
        const prodName = (p.name || "").toLowerCase();
        const prodCat = (p.category || "").toLowerCase();
        const prodId = (p.id || "").toLowerCase();

        const matchesSearch = prodName.includes(searchVal) || 
                              prodCat.includes(searchVal) || 
                              prodId.includes(searchVal);

        // 2. Category Logic
        const matchesCategory = catVal === "" || p.category === catVal;
        
        // 3. Status Logic
        let pStatus = 'in-stock';
        const stock = Number(p.stock) || 0;
        const price = Number(p.price) || 0;
        const threshold = Number(p.lowStockThreshold) || 10;
        
        if (stock === 0) pStatus = 'out-of-stock';
        else if (stock <= threshold) pStatus = 'low-stock';
        
        const matchesStatus = statusVal === "" || pStatus === statusVal;

        // 4. NEW: Price Range Logic
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

    // Sort Logic
    filtered.sort((a, b) => {
        let valA, valB;
        if (sortVal === 'price') { valA = Number(a.price) || 0; valB = Number(b.price) || 0; }
        else if (sortVal === 'stock') { valA = Number(a.stock) || 0; valB = Number(b.stock) || 0; }
        else if (sortVal === 'date') { valA = a.createdAt?.seconds || 0; valB = b.createdAt?.seconds || 0; }
        else { valA = (a.name || "").toLowerCase(); valB = (b.name || "").toLowerCase(); }

        if (valA < valB) return currentSortDir === 'asc' ? -1 : 1;
        if (valA > valB) return currentSortDir === 'asc' ? 1 : -1;
        return 0;
    });

    renderTable(filtered);
}

// --- RENDER FUNCTION ---
function renderTable(productsToRender) {
    const tableBody = document.getElementById("productTableBody");
    const mobileList = document.getElementById("mobileProductList");
    const tableHead = document.querySelector(".products-table thead tr");

    // 1. UPDATE TABLE HEADER (Add ID Column)
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

    productsToRender.forEach(p => {
        const docId = p.id;
        const shortId = "#" + docId.slice(0, 6); 

        // Image Logic
        let imageHtml = p.imageUrl 
            ? `<img src="${p.imageUrl}" alt="${p.name}" style="width: 45px; height: 45px; border-radius: 8px; object-fit: cover; border: 1px solid #e5e7eb;">`
            : `<div class="product-img-placeholder"><i class="fa-regular fa-image"></i></div>`;

        let mobileImageHtml = p.imageUrl 
            ? `<img src="${p.imageUrl}" alt="${p.name}" style="width: 60px; height: 60px; border-radius: 8px; object-fit: cover; border: 1px solid #e5e7eb;">`
            : `<div class="card-img"><i class="fa-regular fa-image"></i></div>`;

        // Status Logic
        let statusText = "In Stock";
        let statusClass = "in-stock";
        const stock = Number(p.stock) || 0;
        const threshold = Number(p.lowStockThreshold) || 10;
        if (stock === 0) { statusText = "Out of Stock"; statusClass = "out-of-stock"; }
        else if (stock <= threshold) { statusText = "Low Stock"; statusClass = "low-stock"; }

        // Date Logic
        let dateAdded = "N/A";
        if (p.createdAt && p.createdAt.toDate) {
            dateAdded = p.createdAt.toDate().toLocaleDateString("en-US", { month: 'short', day: 'numeric', year: 'numeric' });
        }

        // Tags Logic
        let tagsHtml = (p.variations || []).map(v => 
            v.size ? `<span class="v-tag">${v.size}</span>` : ''
        ).join('');

        let attributesHtml = (p.attributes || []).map(a => 
            `<span class="v-tag" style="background-color: #e0f2fe; color: #0284c7; border: 1px solid #bae6fd;">
                ${a.name}: ${a.value}
             </span>`
        ).join('');

        const allTags = tagsHtml + attributesHtml;

        // Admin Actions
        const adminActions = isAdmin ? `
            <i class="fa-regular fa-pen-to-square" title="Edit" onclick="editProduct('${docId}')" style="cursor: pointer;"></i>
            <i class="fa-regular fa-trash-can delete-btn" data-id="${docId}" title="Delete" style="cursor: pointer;"></i>
        ` : '';

        const mobileAdminActions = isAdmin ? `
            <button class="btn-card-action" onclick="editProduct('${docId}')"><i class="fa-regular fa-pen-to-square"></i> Edit</button>
            <button class="btn-card-action btn-card-delete delete-btn" data-id="${docId}"><i class="fa-regular fa-trash-can"></i></button>
        ` : '';

        // --- DESKTOP RENDER ---
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
                <td>$${Number(p.price).toFixed(2)}</td>
                <td>${p.stock}</td>
                <td><span class="status-pill ${statusClass}">${statusText}</span></td>
                <td>${dateAdded}</td>
                <td class="actions">
                    ${adminActions} 
                </td>
            `;
            tableBody.appendChild(row);
        }

        // --- MOBILE RENDER ---
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
                    <div class="detail-item"><label>Price:</label> <span>$${Number(p.price).toFixed(2)}</span></div>
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

// --- DELETE FUNCTION ---
function attachDeleteListeners() {
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const target = e.target.closest('.delete-btn'); 
            if(!target) return;
            const idToDelete = target.getAttribute('data-id');
            if(confirm("Are you sure you want to delete this product?")) {
                try {
                    await deleteDoc(doc(db, "products", idToDelete));
                    allProducts = allProducts.filter(p => p.id !== idToDelete);
                    applyFilters();
                    alert("Product deleted!");
                } catch(err) {
                    console.error("Error deleting:", err);
                }
            }
        });
    });
}

// --- EVENT LISTENERS ---
document.addEventListener("DOMContentLoaded", () => {
    // 1. Filter Listeners
    document.getElementById("searchInput").addEventListener("input", applyFilters);
    document.getElementById("filterCategory").addEventListener("change", applyFilters);
    document.getElementById("filterPrice").addEventListener("change", applyFilters); // NEW
    document.getElementById("filterStatus").addEventListener("change", applyFilters);
    document.getElementById("filterSort").addEventListener("change", applyFilters);
    
    // 2. Sort Direction
    document.getElementById("sortDirBtn").addEventListener("click", () => {
        currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
        const icon = document.getElementById("sortDirIcon");
        const text = document.getElementById("sortDirText");
        icon.textContent = currentSortDir === 'asc' ? "↑" : "↓"; 
        text.textContent = currentSortDir === 'asc' ? "Ascending" : "Descending";
        applyFilters();
    });

    // 3. Reset Button (NEW)
    document.getElementById("resetFiltersBtn").addEventListener("click", () => {
        document.getElementById("searchInput").value = "";
        document.getElementById("filterCategory").value = "";
        document.getElementById("filterPrice").value = "";
        document.getElementById("filterStatus").value = "";
        document.getElementById("filterSort").value = "name";
        
        // Reset Sort Direction to Ascending
        currentSortDir = 'asc';
        document.getElementById("sortDirIcon").textContent = "↑";
        document.getElementById("sortDirText").textContent = "Ascending";

        applyFilters();
    });
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