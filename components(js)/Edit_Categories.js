import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, doc, getDoc, updateDoc, collection, addDoc, serverTimestamp, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
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

let isFormDirty = false;

// --- AUTH CHECK WITH ROLE VALIDATION ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const isAdmin = await checkAdminRole(user.uid);

        if (!isAdmin) {
            alert("Access Denied: Only Admins can edit categories.");
            window.location.href = "Categories.html";
        } else {
            initPage(); 
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
            return (userData.role && userData.role.toLowerCase() === 'admin');
        }
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

// --- SANITIZER ---
function sanitizeInput(str) {
    if (!str) return "";
    if (typeof str !== 'string') return String(str);
    const div = document.createElement('div');
    div.innerText = str; 
    return div.innerHTML;
}

function applyCharLimit(input) {
    if (!input) return;
    input.setAttribute("maxlength", "100");
    input.addEventListener("input", function() {
        if (this.value.length >= 100) {
            this.style.borderColor = "red";
            this.style.outlineColor = "red";
        } else {
            this.style.borderColor = "";
            this.style.outlineColor = "";
        }
    });
}

// --- INIT PAGE ---
function initPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const categoryId = urlParams.get('id');

    if (!categoryId) {
        alert("No Category ID specified.");
        window.location.href = "Categories.html";
        return;
    }

    // --- DATA LOSS PREVENTION ---
    const form = document.getElementById('editProductForm');
    if (form) {
        form.addEventListener('input', () => isFormDirty = true);
        form.addEventListener('change', () => isFormDirty = true);
    }
    window.addEventListener('beforeunload', (e) => {
        if (isFormDirty) {
            e.preventDefault();
            e.returnValue = ''; 
        }
    });

    // Apply limits to main inputs
    const nameInput = document.getElementById('inpName');
    if(nameInput) applyCharLimit(nameInput);

    // --- FETCH DATA ---
    (async () => { 
        try {
            const docRef = doc(db, "categories", categoryId);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                
                document.getElementById('inpName').value = data.name || "";
                document.getElementById('inpDesc').value = data.description || "";

            } else {
                alert("Category not found!");
                window.location.href = "Categories.html";
            }
        } catch (e) {
            console.error("Error fetching category:", e);
            alert("Error loading category: " + e.message);
            window.location.href = "Categories.html";
        }
    })();

    // --- SAVE LOGIC WITH LOGGING ---
    const submitBtn = document.querySelector('.btn-submit');

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            submitBtn.innerText = "Updating...";
            submitBtn.disabled = true;

            try {
                const rawName = document.getElementById('inpName').value.trim();
                const rawDesc = document.getElementById('inpDesc').value.trim();

                if (!rawName) {
                    throw new Error("Category name is required.");
                }

                // Duplicate Check
                const q = query(collection(db, "categories"), where("name", "==", rawName));
                const querySnapshot = await getDocs(q);
                
                let isDuplicate = false;
                if (!querySnapshot.empty) {
                    querySnapshot.forEach(d => {
                        if (d.id !== categoryId) isDuplicate = true; 
                    });
                }

                if (isDuplicate) {
                    throw new Error(`Category "${rawName}" already exists!`);
                }

                const updatedData = {
                    name: sanitizeInput(rawName), 
                    description: sanitizeInput(rawDesc),
                    updatedAt: serverTimestamp()
                };

                // 1. UPDATE CATEGORY
                await updateDoc(doc(db, "categories", categoryId), updatedData);
                
                // 2. LOG ACTIVITY
                await logActivity("Updated Category", updatedData.name);

                isFormDirty = false;
                alert("Category Updated!");
                window.location.href = "Categories.html";

            } catch (error) {
                console.error("Error updating:", error);
                alert("Error updating category: " + error.message);
                submitBtn.innerText = "Update Category";
                submitBtn.disabled = false;
            }
        });
    }
}

// --- LOGOUT FUNCTION ---
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
