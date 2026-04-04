import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, collection, doc, getDoc, setDoc, updateDoc, serverTimestamp, query, where, getDocs, addDoc} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

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
        await displayUserRole(user.uid);
        const isAdmin = await checkAdminRole(user.uid);
        if (!isAdmin) {
            alert("Access Denied: Only Admins can add categories.");
            window.location.href = "Categories.html";
        }
    } else {
        window.location.href = "Login.html";
    }
});

// --- HELPER: CHECK ADMIN ROLE ---
async function checkAdminRole(uid) {
    const userData = await getCachedUserData(uid);
    return userData?.role?.toLowerCase() === 'admin';
}

// --- HELPER: DISPLAY USER ROLE ---
async function displayUserRole(uid) {
    const roleEl = document.getElementById('userRoleDisplay');
    if (!roleEl) return;

    const userData = await getCachedUserData(uid);
    let roleName = userData?.role || "User";
    
    roleName = roleName.charAt(0).toUpperCase() + roleName.slice(1);
    roleEl.textContent = roleName;
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
async function addCategory(categoryData) {
    const counterRef = doc(db, "counters", "categories");
    const counterSnap = await getDoc(counterRef);

    let newIdNum = 1;
    if (counterSnap.exists()) {
        newIdNum = counterSnap.data().lastId + 1;
        await updateDoc(counterRef, { lastId: newIdNum });
    } else {
        // First category ever
        await setDoc(counterRef, { lastId: 1 });
    }

    const newId = String(newIdNum);

    await setDoc(doc(db, "categories", newId), {
        ...categoryData,
        createdAt: serverTimestamp(),
        archived: false,
        itemCount: 0  
    });

    return newId;
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

                if (!rawName) throw new Error("Category name is required.");

                // Duplicate check (case-insensitive)
                const normalizedName = rawName.toLowerCase();
                const q = query(collection(db, "categories"), where("normalizedName", "==", normalizedName));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) throw new Error(`Category "${rawName}" already exists!`);

                const categoryData = {
                    name: sanitizeInput(rawName),
                    normalizedName,
                    description: sanitizeInput(rawDesc),
                    createdBy: auth.currentUser ? auth.currentUser.uid : "unknown"
                };

                const newId = await addCategory(categoryData);
                await logActivity("Added Category", categoryData.name);

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

// --- LOGOUT HELPER ---
window.logout = function() {
    localStorage.removeItem("user_session");
    localStorage.removeItem("user_uid");
    localStorage.removeItem("user_role");
    sessionStorage.clear();

    signOut(auth).then(() => {
        window.location.replace("Login.html");
    }).catch((error) => {
        console.error("Logout Error:", error);
        window.location.replace("Login.html");
    });
};

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