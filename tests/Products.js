// ==========================================
// 1. IMPORTS (Standard NPM)
// ==========================================
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { 
    getFirestore, collection, getDocs, deleteDoc, 
    doc, addDoc, serverTimestamp, getDoc 
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

let app, db, auth;
try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
} catch (e) {
    // Suppress errors if running in a test environment
}

// Global State (For Browser Use)
let allProducts = [];
let filteredProducts = []; 
let currentSortDir = 'asc';
let isAdmin = false; 

// ==========================================
// 3. EXPORTED LOGIC (Tested Functions)
// ==========================================

export async function checkAdminRole(uid, dbInstance = db) {
    try {
        const userSnap = await getDoc(doc(dbInstance, "users", uid));
        if (userSnap.exists()) {
            const userData = userSnap.data();
            return (userData.role && userData.role.toLowerCase() === 'admin');
        }
        return false;
    } catch (error) { return false; }
}

export async function logActivity(action, targetName, user, dbInstance = db) {
    try {
        const userEmail = user ? user.email : "Admin"; 
        await addDoc(collection(dbInstance, "activities"), {
            action: action,          
            target: targetName,      
            user: userEmail,
            timestamp: serverTimestamp()
        });
        return true;
    } catch (e) { return false; }
}

export async function fetchProductsLogic(dbInstance = db) {
    const querySnapshot = await getDocs(collection(dbInstance, "products"));
    const products = [];
    querySnapshot.forEach((doc) => {
        products.push({ id: doc.id, ...doc.data() });
    });
    return products;
}

export async function deleteProductLogic(productId, allProducts, dbInstance, authInstance) {
    const productToDelete = allProducts.find(p => p.id === productId);
    const nameToLog = productToDelete ? productToDelete.name : "Unknown Product";

    await deleteDoc(doc(dbInstance, "products", productId));
    
    const user = authInstance ? authInstance.currentUser : null;
    await logActivity("Deleted Product", nameToLog, user, dbInstance);
    
    return productId; 
}

// Pure Function: Filters products based on criteria
export function filterProductsLogic(products, filters) {
    const { searchVal, catVal, priceRangeVal, statusVal } = filters;

    return products.filter(p => {
        const prodName = (p.name || "").toLowerCase();
        const prodCat = (p.category || "").toLowerCase();
        
        const matchesSearch = prodName.includes(searchVal) || prodCat.includes(searchVal);
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
}

// Pure Function: Sorts products
export function sortProductsLogic(products, sortVal, sortDir) {
    // Create a copy to avoid mutating original array in tests
    return [...products].sort((a, b) => {
        let valA, valB;
        if (sortVal === 'price') { valA = Number(a.price) || 0; valB = Number(b.price) || 0; }
        else if (sortVal === 'stock') { valA = Number(a.stock) || 0; valB = Number(b.stock) || 0; }
        else if (sortVal === 'date') { valA = a.createdAt?.seconds || 0; valB = b.createdAt?.seconds || 0; }
        else { valA = (a.name || "").toLowerCase(); valB = (b.name || "").toLowerCase(); }

        if (valA < valB) return sortDir === 'asc' ? -1 : 1;
        if (valA > valB) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });
}

// ==========================================
// 4. BROWSER ONLY LOGIC
// ==========================================
if (typeof window !== 'undefined') {

    // --- Auth Check ---
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            displayUserRole(user.uid);
            isAdmin = await checkAdminRole(user.uid, db);
            
            const addBtn = document.querySelector('.btn-primary');
            if(addBtn) {
                addBtn.style.display = isAdmin ? "flex" : "none";
            }

            // Load Data
            loadProducts();
        } else {
            window.location.href = "Login.html";
        }
    });

    // --- Data Loading Wrapper ---
    async function loadProducts() {
        try {
            allProducts = await fetchProductsLogic(db);
            applyFilters();
        } catch (error) {
            console.error("Error loading products:", error);
        }
    }

    // --- Filter Wrapper ---
    function applyFilters() {
        const filters = {
            searchVal: document.getElementById("searchInput").value.trim().toLowerCase(),
            catVal: document.getElementById("filterCategory").value,
            priceRangeVal: document.getElementById("filterPrice").value,
            statusVal: document.getElementById("filterStatus").value
        };

        const sortVal = document.getElementById("filterSort").value;

        // 1. Filter
        let result = filterProductsLogic(allProducts, filters);
        
        // 2. Sort
        result = sortProductsLogic(result, sortVal, currentSortDir);

        filteredProducts = result;
        renderTable(filteredProducts);
    }

    // --- Delete Wrapper ---
    function attachDeleteListeners() {
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const target = e.target.closest('.delete-btn'); 
                if(!target) return;
                
                const idToDelete = target.getAttribute('data-id');

                if(confirm("Are you sure you want to delete this product?")) {
                    try {
                        await deleteProductLogic(idToDelete, allProducts, db, auth);
                        
                        // Update UI
                        allProducts = allProducts.filter(p => p.id !== idToDelete);
                        applyFilters();
                        alert("Product deleted!");
                    } catch(err) {
                        alert("Error deleting product.");
                    }
                }
            });
        });
    }

    // --- Rendering ---
    function renderTable(productsToRender) {
        const tableBody = document.getElementById("productTableBody");
        const mobileList = document.getElementById("mobileProductList");
        
        if (tableBody) tableBody.innerHTML = "";
        if (mobileList) mobileList.innerHTML = "";

        if (productsToRender.length === 0) {
            if(tableBody) tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:#9ca3af;">No products found.</td></tr>`;
            return;
        }

        productsToRender.forEach(p => {
            const docId = p.id;
            const shortId = "#" + docId.slice(0, 6); 

            let imageHtml = p.imageUrl 
                ? `<img src="${p.imageUrl}" alt="${p.name}" style="width: 45px; height: 45px; border-radius: 8px; object-fit: cover;">`
                : `<div class="product-img-placeholder"><i class="fa-regular fa-image"></i></div>`;

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

            const adminActions = isAdmin ? `
                <i class="fa-regular fa-pen-to-square" title="Edit" onclick="editProduct('${docId}')" style="cursor: pointer;"></i>
                <i class="fa-regular fa-trash-can delete-btn" data-id="${docId}" title="Delete" style="cursor: pointer;"></i>
            ` : '';

            // Desktop Row
            if (tableBody) {
                const row = document.createElement("tr");
                row.innerHTML = `
                    <td><span class="id-badge">${shortId}</span></td>
                    <td><div class="product-cell">${imageHtml}<div class="product-info"><h4>${p.name}</h4></div></div></td>
                    <td>${p.category}</td>
                    <td>₱${Number(p.price).toFixed(2)}</td>
                    <td>${p.stock}</td>
                    <td><span class="status-pill ${statusClass}">${statusText}</span></td>
                    <td>${dateAdded}</td>
                    <td class="actions">${adminActions}</td>
                `;
                tableBody.appendChild(row);
            }
        });

        if(isAdmin) attachDeleteListeners();
    }

    // --- Helpers ---
    async function displayUserRole(uid) {
        const roleEl = document.getElementById('userRoleDisplay');
        if (!roleEl) return;
        try {
            const userSnap = await getDoc(doc(db, "users", uid));
            if (userSnap.exists()) {
                let r = userSnap.data().role || "User";
                roleEl.textContent = r.charAt(0).toUpperCase() + r.slice(1);
            }
        } catch (e) { roleEl.textContent = "User"; }
    }

    window.editProduct = function(id) {
        if (isAdmin) window.location.href = `Edit_Product.html?id=${id}`;
    };

    window.logout = function() {
        sessionStorage.clear();
        signOut(auth).then(() => window.location.replace("Login.html"));
    };

    // --- Event Listeners ---
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
                document.getElementById("sortDirIcon").textContent = currentSortDir === 'asc' ? "↑" : "↓"; 
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
                applyFilters();
            });
        }
    });
}

export function doSignOut(authInstance) {
    localStorage.removeItem("user_session");
    localStorage.removeItem("user_uid");
    localStorage.removeItem("user_role");
    sessionStorage.clear();
    return signOut(authInstance);
}