import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
// Added doc and getDoc for role checking
import { getFirestore, collection, addDoc, serverTimestamp, query, where, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
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

let base64ImageString = "";
let isFormDirty = false;

// --- AUTH CHECK WITH ROLE VALIDATION ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // 1. Fetch User Role from 'users' collection
        const isAdmin = await checkAdminRole(user.uid);

        if (!isAdmin) {
            alert("Access Denied: Only Admins can add categories.");
            window.location.href = "Categories.html";
        } else {
            console.log("Admin verified.");
        }
    } else {
        window.location.href = "Login.html";
    }
});

// --- HELPER: CHECK ADMIN ROLE ---
async function checkAdminRole(uid) {
    try {
        const userDocRef = doc(db, "users", uid);
        const userSnap = await getDoc(userDocRef);
        
        if (userSnap.exists()) {
            const userData = userSnap.data();
            // Check if role is 'admin' (case-insensitive for safety)
            return (userData.role && userData.role.toLowerCase() === 'admin');
        }
        
        // Fallback: If user not found in DB (legacy accounts), assume NOT admin
        return false;
    } catch (error) {
        console.error("Error checking role:", error);
        return false; 
    }
}

// --- HELPER: ACTIVITY LOGGING FUNCTION ---
async function logActivity(action, targetName) {
    try {
        const userEmail = auth.currentUser ? auth.currentUser.email : "Admin"; 
        
        await addDoc(collection(db, "activities"), {
            action: action,          // e.g., "Added Product"
            target: targetName,      // e.g., "Gaming Chair"
            user: userEmail,         // Logs who performed the action
            timestamp: serverTimestamp()
        });
        console.log("Activity logged successfully");
    } catch (e) {
        console.error("Error logging activity", e);
    }
}



document.addEventListener("DOMContentLoaded", () => {

    // --- SANITIZER ---
    function sanitizeInput(str) {
        if (!str) return "";
        if (typeof str !== 'string') return String(str);
        const div = document.createElement('div');
        div.innerText = str; 
        return div.innerHTML;
    }

    // --- FORM SUBMISSION ---
    const form = document.querySelector('form');
    const submitBtn = document.querySelector('.btn-submit');

    if(form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault(); 

            submitBtn.innerText = "Saving...";
            submitBtn.disabled = true;

            try {
                const rawName = document.getElementById('categoryNameInput').value.trim();
                const rawDesc = document.getElementById('categoryDescInput').value.trim();

                if (!rawName) {
                    throw new Error("Category name is required.");
                }

                // DUPLICATE CHECK
                const q = query(collection(db, "categories"), where("name", "==", rawName));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    throw new Error(`Category "${rawName}" already exists!`);
                }

                const categoryData = {
                    name: sanitizeInput(rawName), 
                    description: sanitizeInput(rawDesc), 
                    createdAt: serverTimestamp(),
                    createdBy: auth.currentUser.uid,
                    archived: false
                };

                // 1. SAVE CATEGORY
                await addDoc(collection(db, "categories"), categoryData);

                // 2. LOG ACTIVITY
                await logActivity("Added Category", categoryData.name);

                alert("Category Saved Successfully!");
                window.location.href = "Categories.html";

            } catch (error) {
                console.error("Error:", error);
                alert("Error saving: " + error.message);
                submitBtn.innerText = "Add Category"; 
                submitBtn.disabled = false;
            }
        });
    }
});

// Logout Helper
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
