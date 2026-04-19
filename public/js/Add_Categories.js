import { collection, doc, getDoc, setDoc, updateDoc, serverTimestamp, query, where, getDocs, addDoc} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { initLogoutModal } from "./logout-modal.js";   
import { db, auth, storage } from "./firebase.js";




// ================================================
// OPTIMIZED USER DATA HELPER (SHARED)
// ================================================
async function getCachedUserData(uid) {
    const CACHE_KEY_USER = `user_data_${uid}`;
    
    // Check Session Storage first
    const cached = sessionStorage.getItem(CACHE_KEY_USER);
    if (cached) return JSON.parse(cached);

    // If not cached, fetch from Firestore
    try {
        const docRef = doc(db, "users", uid);
        const docSnap = await getDoc(docRef);
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

// --- AUTH CHECK WITH ROLE VALIDATION ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        await displayUserName(user.uid);
        const isAdmin = await checkAdminRole(user.uid);
        if (!isAdmin) {
            alert("Access Denied: Only Admins can add categories.");
            window.location.href = "Categories.html";
        }
        // =======================================================
        // Logout Confirmation Modal (shared pattern with Dashboard)
        // =======================================================
        const doSignOut = () => {
            localStorage.removeItem("user_session"); localStorage.removeItem("user_uid"); localStorage.removeItem("user_role");
            sessionStorage.clear();
            signOut(auth).then(() => window.location.replace("index.html")).catch(() => window.location.replace("index.html"));
        };
        const openLogoutModal = initLogoutModal(doSignOut);
        window.logout = function () { if (openLogoutModal) openLogoutModal(); }; 
    } else {
        window.location.href = "index.html";
    }
});

// --- HELPER: CHECK ADMIN ROLE ---
async function checkAdminRole(uid) {
    const userData = await getCachedUserData(uid);
    return userData?.role?.toLowerCase() === 'admin';
}

// --- HELPER: DISPLAY USER ROLE ---
async function displayUserName(uid) {
    const nameEl = document.getElementById('userNameDisplay');
    if (!nameEl) return;

    const userData = await getCachedUserData(uid);
    const name = userData?.name || "User";
    
    nameEl.textContent = name;
}


// --- HELPER: ACTIVITY LOGGING FUNCTION ---
async function logActivity(action, targetName) {
    try {
        const userEmail = auth.currentUser ? auth.currentUser.email : "Admin"; 
        await addDoc(collection(db, "activities"), {
            action,
            target: targetName,
            user: userEmail,
            timestamp: serverTimestamp()
        });
    } catch (e) {
        console.error("Error logging activity", e);
    }
}

// --- SANITIZER ---
function sanitizeInput(str) {
    if (!str) return "";
    if (typeof str !== 'string') return String(str);
    const div = document.createElement('div');
    div.innerText = str; 
    return div.innerHTML;
}

// --- ADD CATEGORY WITH NUMERIC ID ---
async function addCategory(categoryData, manualId) {
    // Check if ID already exists
    const idCheckSnap = await getDoc(doc(db, "categories", manualId));
    if (idCheckSnap.exists()) throw new Error(`Category ID "${manualId}" is already in use.`);

    await setDoc(doc(db, "categories", manualId), {
        ...categoryData,
        createdAt: serverTimestamp(),
        archived:  false,
        itemCount: 0
    });

    return manualId;
}

// --- FORM SUBMISSION ---
document.addEventListener("DOMContentLoaded", () => {
    const form = document.querySelector('#categoryForm');
    const submitBtn = document.querySelector('.btn-submit');

    if(form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault(); 

            submitBtn.innerText = "Saving...";
            submitBtn.disabled = true;

            try {
                const rawName = document.getElementById('categoryNameInput').value.trim();
                const rawDesc = document.getElementById('categoryDescInput').value.trim();

                const manualId = document.getElementById('categoryIdInput').value.trim();
                if (!manualId) throw new Error("Category ID is required.");

                if (!rawName) throw new Error("Category name is required.");

                // Duplicate check (case-insensitive)
                const normalizedName = rawName.toLowerCase();
                const q = query(
                    collection(db, "categories"),
                    where("normalizedName", "==", normalizedName),
                    where("archived", "==", false)
                );
                const querySnapshot = await getDocs(q);
                
                if (!querySnapshot.empty) throw new Error(`Category "${rawName}" already exists!`);

                const categoryData = {
                    name: rawName,
                    normalizedName,
                    description: sanitizeInput(rawDesc),
                    createdBy: auth.currentUser ? auth.currentUser.uid : "unknown"
                };

                const newId = await addCategory(categoryData, manualId);
                await logActivity("Added Category", categoryData.name);

                // 3. BUST CACHES
                sessionStorage.removeItem('dashboard_cache');
                sessionStorage.removeItem('products_cache');
                sessionStorage.removeItem('categories_cache');
                
                showSuccessModal(categoryData.name);
                

            } catch (error) {
                console.error("Error:", error);
                alert("Error saving: " + error.message);
                submitBtn.innerText = "Add Category"; 
                submitBtn.disabled = false;
            }   
        });
    }
});



// --- SUCCESS MODAL ---
function showSuccessModal(categoryName) {
    const modal = document.getElementById('successModal');
    const bar   = document.getElementById('successProgressBar');
    const label = document.getElementById('successCategoryName');

    if (label) label.textContent = `"${categoryName}" has been added.`;
    if (modal) modal.style.display = 'flex';

    let width = 0;
    const interval = setInterval(() => {
        width += 2;
        if (bar) bar.style.width = width + '%';
        if (width >= 100) {
            clearInterval(interval);
            window.location.href = "Categories.html";
        }
    }, 40); 
}