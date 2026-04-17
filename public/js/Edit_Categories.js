import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, doc, getDoc, updateDoc, collection, addDoc, serverTimestamp, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { initLogoutModal } from "./logout-modal.js";
import { initializeFirestore, persistentLocalCache } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

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
const db  = initializeFirestore(app, {
    localCache: persistentLocalCache()
});
const auth = getAuth(app);

let isFormDirty = false;

// ================================================
// CACHED USER DATA HELPER
// ================================================
async function getCachedUserData(uid) {
    const CACHE_KEY = `user_data_${uid}`;
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) return JSON.parse(cached);

    try {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) {
            const data = snap.data();
            sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
            return data;
        }
    } catch (err) {
        console.error("Error fetching user data:", err);
    }
    return null;
}

async function displayUserName(uid) {
    const nameEl = document.getElementById('userNameDisplay');
    if (!nameEl) return;

    const userData = await getCachedUserData(uid);
    const name = userData?.name || "User";
    
    nameEl.textContent = name;
}


// --- AUTH CHECK WITH ROLE VALIDATION ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userData = await getCachedUserData(user.uid);
        const isAdmin  = userData?.role?.toLowerCase() === 'admin';

        if (!isAdmin) {
            alert("Access Denied: Only Admins can edit categories.");
            window.location.href = "Categories.html";
        } else {
            await displayUserName(user.uid);
            initPage();
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
        }
    } else {
        window.location.href = "index.html";
    }
});

// --- HELPER: ACTIVITY LOGGING ---
async function logActivity(action, targetName) {
    try {
        const userEmail = auth.currentUser ? auth.currentUser.email : "Admin";
        await addDoc(collection(db, "activities"), {
            action,
            target:    targetName,
            user:      userEmail,
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

function applyCharLimit(input) {
    if (!input) return;
    input.setAttribute("maxlength", "100");
    input.addEventListener("input", function () {
        this.style.borderColor  = this.value.length >= 100 ? "red" : "";
        this.style.outlineColor = this.value.length >= 100 ? "red" : "";
    });
}

// ================================================
// INIT PAGE
// ================================================
function initPage() {
    const urlParams  = new URLSearchParams(window.location.search);
    const categoryId = urlParams.get('id');

    if (!categoryId) {
        alert("No Category ID specified.");
        window.location.href = "Categories.html";
        return;
    }

    // --- DATA LOSS PREVENTION ---
    const form = document.getElementById('editProductForm');
    if (form) {
        form.addEventListener('input',  () => isFormDirty = true);
        form.addEventListener('change', () => isFormDirty = true);
    }
    window.addEventListener('beforeunload', (e) => {
        if (isFormDirty) { e.preventDefault(); e.returnValue = ''; }
    });

    const nameInput = document.getElementById('inpName');
    if (nameInput) applyCharLimit(nameInput);

    // --- FETCH EXISTING DATA ---
    (async () => {
        try {
            const docRef  = doc(db, "categories", categoryId);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();

                nameInput.value = data.name || "";
                document.getElementById('inpDesc').value = data.description || "";

                // Store original name so we can detect renames later
                nameInput.dataset.originalName = data.name || "";

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

    // --- SAVE LOGIC ---
    const submitBtn = document.querySelector('.btn-submit');

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            submitBtn.innerText = "Updating...";
            submitBtn.disabled  = true;

            try {
                const rawName = document.getElementById('inpName').value.trim();
                const rawDesc = document.getElementById('inpDesc').value.trim();
                const originalName = document.getElementById('inpName').dataset.originalName || "";

                if (!rawName) throw new Error("Category name is required.");

                // Duplicate check — exclude current doc
                const q  = query(collection(db, "categories"), where("name", "==", rawName));
                const qs = await getDocs(q);
                let isDuplicate = false;
                qs.forEach(d => { if (d.id !== categoryId) isDuplicate = true; });
                if (isDuplicate) throw new Error(`Category "${rawName}" already exists!`);

                const updatedData = {
                    name:        rawName,          // plain text, no sanitize needed for stored name
                    normalizedName: rawName.toLowerCase(),
                    description: sanitizeInput(rawDesc),
                    updatedAt:   serverTimestamp()
                };

                // 1. UPDATE CATEGORY DOCUMENT
                await updateDoc(doc(db, "categories", categoryId), updatedData);

                // 2. CASCADE RENAME TO ALL PRODUCTS IN THIS CATEGORY
                const nameChanged = originalName && originalName !== rawName;
                if (nameChanged) {
                    submitBtn.innerText = "Updating Products...";

                    const productsQuery = query(
                        collection(db, "products"),
                        where("category", "==", originalName)
                    );
                    const productsSnap = await getDocs(productsQuery);

                    const updatePromises = [];
                    productsSnap.forEach(docSnap => {
                        updatePromises.push(
                            updateDoc(doc(db, "products", docSnap.id), {
                                category: rawName
                            })
                        );
                    });

                    await Promise.all(updatePromises);
                    console.log(`Updated category name in ${updatePromises.length} product(s).`);
                }

                // 3. LOG ACTIVITY
                await logActivity("Updated Category", rawName);

                // 4. BUST CACHES so Dashboard and Products reflect the change
                sessionStorage.removeItem('dashboard_cache');

                isFormDirty = false;
                showSuccessModal(rawName);

            } catch (error) {
                console.error("Error updating:", error);
                alert("Error updating category: " + error.message);
                submitBtn.innerText = "Update Category";
                submitBtn.disabled  = false;
            }
        });
    }
}



// --- SUCCESS MODAL ---
function showSuccessModal(categoryName) {
    const modal = document.getElementById('successModal');
    const label = document.getElementById('successCategoryName');

    if (label) label.textContent = `"${categoryName}" has been updated.`;
    if (modal) modal.style.display = 'flex';

    setTimeout(() => {
        window.location.href = "Categories.html";
    }, 2000);
}