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

// --- AUTH LISTENER ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log("User Logged In:", user.uid);

        // 1. CHECK IF ADMIN
        if (user.uid !== ADMIN_UID) {
            // If NOT Admin, hide the "Add Product" button
            const addBtn = document.querySelector('.btn-add'); // Make sure this matches your HTML class
            if (addBtn) {
                addBtn.style.display = 'none';
            }
        }

        // 2. LOAD DASHBOARD DATA
        loadDashboardStats();

    } else {
        // Not logged in -> Redirect
        window.location.href = "Login.html";
    }
});

// --- LOAD STATS LOGIC ---
async function loadDashboardStats() {
    try {
        const querySnapshot = await getDocs(collection(db, "products"));
        const products = [];
        
        querySnapshot.forEach((doc) => {
            products.push(doc.data());
        });

        // Calculate Stats
        const totalProducts = products.length;
        
        // Count unique categories
        const categories = new Set(products.map(p => p.category).filter(c => c)).size;
        
        // Count low stock (assuming threshold is 10 if not set)
        const lowStock = products.filter(p => p.stock <= (p.lowStockThreshold || 10)).length;
        
        // Calculate Total Value (Price * Stock)
        const totalValue = products.reduce((sum, p) => sum + (Number(p.price || 0) * Number(p.stock || 0)), 0);

        // Update HTML Elements (Ensure these IDs exist in Dashboard.html)
        updateStat("statTotalProducts", totalProducts);
        updateStat("statCategories", categories);
        updateStat("statLowStock", lowStock);
        updateStat("statTotalValue", `$${totalValue.toLocaleString(undefined, {minimumFractionDigits: 2})}`);

    } catch (error) {
        console.error("Error loading stats:", error);
    }
}

// Helper to safely update element text
function updateStat(id, value) {
    const el = document.getElementById(id);
    if(el) el.innerText = value;
}

// --- LOGOUT FUNCTION ---
window.logout = function() {
    // 1. CLEAR SESSION (Instant protection)
    sessionStorage.removeItem("user_session");
    sessionStorage.removeItem("user_uid");
    sessionStorage.removeItem("user_role");

    // 2. FIREBASE SIGNOUT
    signOut(auth).then(() => {
        // 3. REDIRECT
        // Use replace() so they can't press 'Back'
        window.location.replace("Login.html");
    }).catch((error) => {
        console.error("Logout Error:", error);
        // Force redirect even if Firebase fails
        window.location.replace("Login.html");
    });
};