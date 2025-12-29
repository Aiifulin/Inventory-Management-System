import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, collection, getDocs, deleteDoc, doc, addDoc, serverTimestamp, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
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

// --- HELPER: CHECK ADMIN ROLE (Dynamic) ---
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

// --- HELPER: DISPLAY USER ROLE (UI) ---
async function displayUserRole(uid) {
    const roleEl = document.getElementById('userRoleDisplay');
    if (!roleEl) {
        const sidebarRole = document.querySelector('.sidebar-header .user-role');
        if (sidebarRole) {
            sidebarRole.id = 'userRoleDisplay'; 
            return displayUserRole(uid); 
        }
        return;
    }

    try {
        const docRef = doc(db, "users", uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            let roleName = data.role || "User";
            roleName = roleName.charAt(0).toUpperCase() + roleName.slice(1);
            roleEl.textContent = roleName;
        } else {
            roleEl.textContent = "User"; 
        }
    } catch (error) {
        console.error("Error displaying role:", error);
        roleEl.textContent = "User";
    }
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

        displayUserRole(user.uid);
        isAdmin = await checkAdminRole(user.uid);
        
        const addBtn = document.querySelector('.btn-primary');
        if(addBtn) {
            addBtn.style.display = isAdmin ? "flex" : "none";
        }

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
        querySnapshot.forEach((doc) => {
            allProducts.push({ id: doc.id, ...doc.data() });
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

        const matchesSearch = prodName.includes(searchVal) || 
                              prodCat.includes(searchVal) || 
                              prodId.includes(searchVal);

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

// --- DELETE FUNCTION WITH LOGGING ---
function attachDeleteListeners() {
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const target = e.target.closest('.delete-btn'); 
            if(!target) return;
            
            const idToDelete = target.getAttribute('data-id');
            const productToDelete = allProducts.find(p => p.id === idToDelete);
            const nameToLog = productToDelete ? productToDelete.name : "Unknown Product";

            if(confirm("Are you sure you want to delete this product?")) {
                try {
                    await deleteDoc(doc(db, "products", idToDelete));
                    await logActivity("Deleted Product", nameToLog);
                    allProducts = allProducts.filter(p => p.id !== idToDelete);
                    applyFilters();
                    alert("Product deleted!");
                } catch(err) {
                    console.error("Error deleting:", err);
                    alert("Error deleting product: " + err.message);
                }
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