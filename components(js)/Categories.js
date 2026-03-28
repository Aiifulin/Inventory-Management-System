import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, collection, getDocs, doc, addDoc, serverTimestamp, getDoc, where, updateDoc, query} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
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
let allCategories = [];
let filteredCategories = []; 
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

        fetchCategories();
    } else {
        window.location.href = "Login.html";
    }
});

// --- FETCH DATA ---
async function fetchCategories() {
    try {
        const querySnapshot = await getDocs(collection(db, "categories"));
        console.log("Found categories:", querySnapshot.size);
        allCategories = [];

        for (const docSnap of querySnapshot.docs) {
            const data = docSnap.data();
            if (data.archived === true) continue;

            // Query products by category name
            const productsQuery = query(
                collection(db, "products"),
                where("category", "==", data.name)
            );
            const productsSnapshot = await getDocs(productsQuery);

            // Count only non-archived products
            let count = 0;
            productsSnapshot.forEach(p => {
                const pData = p.data();
                if (pData.archived !== true) count++;
            });

            allCategories.push({ id: docSnap.id, ...data, itemCount: count });
        }

        applyFilters();

    } catch (error) {
        console.error("Error loading categories:", error);
    }
}

// --- FILTER & SORT ---
function applyFilters() {
    const searchVal = document.getElementById("searchInput").value.trim().toLowerCase();
    const sortVal = document.getElementById("filterSort").value;

    let result = allCategories.filter(c => {
        const catName = (c.name || "").toLowerCase();
        const catId = (c.id || "").toLowerCase();
        return catName.includes(searchVal) || catId.includes(searchVal);
    });

    result.sort((a, b) => {
        let valA, valB;
        if (sortVal === 'date') { 
            valA = a.createdAt?.seconds || 0; 
            valB = b.createdAt?.seconds || 0; 
        } else { 
            valA = (a.name || "").toLowerCase(); 
            valB = (b.name || "").toLowerCase(); 
        }

        if (valA < valB) return currentSortDir === 'asc' ? -1 : 1;
        if (valA > valB) return currentSortDir === 'asc' ? 1 : -1;
        return 0;
    });

    filteredCategories = result;
    renderTable(filteredCategories);
}

// --- RENDER TABLE ---
function renderTable(categoriesToRender) {
    const tableBody = document.getElementById("productTableBody");
    const mobileList = document.getElementById("mobileProductList");

    if (tableBody) tableBody.innerHTML = "";
    if (mobileList) mobileList.innerHTML = "";

    if (categoriesToRender.length === 0) {
        if(tableBody) tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:#9ca3af;">No categories found.</td></tr>`;
        if(mobileList) mobileList.innerHTML = `<div style="text-align:center; padding:30px; color:#9ca3af;">No categories found.</div>`;
        return;
    }

    categoriesToRender.forEach(c => {
        const docId = c.id;
        const shortId = "#" + docId.slice(0, 6);

        let dateAdded = "N/A";
        if (c.createdAt && c.createdAt.toDate) {
            dateAdded = c.createdAt.toDate().toLocaleDateString("en-US", { month: 'short', day: 'numeric', year: 'numeric' });
        }

        const adminActions = isAdmin ? `
            <i class="fa-regular fa-pen-to-square" title="Edit" onclick="editCategory('${docId}')" style="cursor: pointer;"></i>
            <i class="fa-regular fa-trash-can delete-btn" data-id="${docId}" title="Delete" style="cursor: pointer;"></i>
        ` : '';

        const mobileAdminActions = isAdmin ? `
            <button class="btn-card-action" onclick="editCategory('${docId}')"><i class="fa-regular fa-pen-to-square"></i> Edit</button>
            <button class="btn-card-action btn-card-delete delete-btn" data-id="${docId}"><i class="fa-regular fa-trash-can"></i></button>
        ` : '';

        if (tableBody) {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td><span class="id-badge" title="${docId}">${shortId}</span></td>
                <td>${c.name}</td>
                <td>${c.itemCount || 0}</td>
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
                    <div class="card-header-text">
                        <h3 class="card-title">${c.name}</h3>
                    </div>
                </div>
                <div class="card-details-grid">
                    <div class="detail-item"><label>Items:</label> <span>${c.itemCount || 0}</span></div>
                    <div class="detail-item"><label>Created:</label> <span>${dateAdded}</span></div>
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
window.editCategory = function(id) {
    if (isAdmin) {
        window.location.href = `Edit_Category.html?id=${id}`;
    } else {
        alert("Access Denied: Only Admin can edit categories.");
    }
}

// --- DELETE FUNCTION WITH LOGGING ---
function attachDeleteListeners() {
    if (!isAdmin) return;

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const target = e.target.closest('.delete-btn');
            if (!target) return;

            const idToDelete = target.getAttribute('data-id');
            const categoryToDelete = allCategories.find(c => c.id === idToDelete);
            const nameToLog = categoryToDelete ? categoryToDelete.name : "Unknown Category";

            if (!confirm("Archive this category? Products in this category will remain.")) return;

            try {
                await updateDoc(doc(db, "categories", idToDelete), {
                    archived: true,
                    archivedAt: serverTimestamp()
                });

                await logActivity("Archived Category", nameToLog);

                // Remove locally so no reload needed
                allCategories = allCategories.filter(c => c.id !== idToDelete);
                applyFilters();

                alert("Category archived successfully.");
            } catch (err) {
                console.error("Error archiving:", err);
                alert("Error archiving category: " + err.message);
            }
        });
    });
}

// --- EVENT LISTENERS ---
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("searchInput").addEventListener("input", applyFilters);
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
