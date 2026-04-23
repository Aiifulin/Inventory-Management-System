import { collection, doc, getDoc, setDoc, updateDoc, serverTimestamp, query, where, getDocs, addDoc} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { initLogoutModal } from "./logout-modal.js";   
import { db, auth, storage } from "./firebase.js";



// ============================================================
// SECTION 1 — USER DATA CACHE
// Fetches the current user's Firestore document (name, role).
// Cached per-UID in sessionStorage so repeat calls within the
// same tab skip the Firestore read entirely.
// ============================================================

/**
 * Returns the user's Firestore document data, reading from sessionStorage
 * if available, or fetching from Firestore and caching the result.
 * @param {string} uid — Firebase Auth UID
 * @returns {Object|null}
 */
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

// ============================================================
// SECTION 2 — AUTH LISTENER & ROLE GUARD
// Runs once on page load. If no user is signed in, redirects to
// the login page. If a user is signed in but is not an admin,
// shows an access denied alert and redirects to Categories.html.
// This page is admin-only so the role check is blocking —
// non-admins should never be able to reach the add form.
// ============================================================
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

// ============================================================
// SECTION 3 — AUTH HELPERS
// Small focused helpers used by the auth listener above.
// Kept separate so each concern (role check, name display) is
// independently readable and reusable via exports.
// ============================================================

/**
 * Resolves the user's role from the cached Firestore document.
 * Returns true only if role is exactly 'admin' (case-insensitive).
 * @param {string} uid
 * @returns {Promise<boolean>}
 */
async function checkAdminRole(uid) {
    const userData = await getCachedUserData(uid);
    return userData?.role?.toLowerCase() === 'admin';
}

/**
 * Reads the user's name and role from the cache and injects them
 * into the #userNameDisplay sidebar element.
 * Role label is capitalised and styled in orange to match the
 * shared sidebar pattern used across all pages.
 * @param {string} uid
 */
async function displayUserName(uid) {
    const nameEl = document.getElementById('userNameDisplay');
    if (!nameEl) return;

    const userData = await getCachedUserData(uid);
    const name = userData?.name || "User";
    const role = userData?.role
        ? ` (${userData.role.charAt(0).toUpperCase() + userData.role.slice(1)})`
        : "";

    nameEl.innerHTML = `${name}<span style="font-size:11px; color:#FFA500; font-weight:600; opacity:0.7;">${role}</span>`;
}


// ============================================================
// SECTION 4 — ACTIVITY LOGGING
// ============================================================

/**
 * Writes a single activity entry to the "activities" Firestore collection.
 * Called after a category is successfully created.
 * Falls back to "Admin" as the user label if auth.currentUser is null.
 * @param {string} action     — e.g. "Added Category"
 * @param {string} targetName — the name of the created category
 */
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

// ============================================================
// SECTION 5 — INPUT SANITIZATION
// ============================================================

/**
 * Escapes a string for safe HTML insertion by passing it through
 * a temporary div's innerText → innerHTML round-trip.
 * Prevents XSS from user-supplied category names or descriptions.
 * Returns an empty string for null/undefined input.
 * @param {string} str
 * @returns {string}
 */
function sanitizeInput(str) {
    if (!str) return "";
    if (typeof str !== 'string') return String(str);
    const div = document.createElement('div');
    div.innerText = str; 
    return div.innerHTML;
}

// ============================================================
// SECTION 6 — FIRESTORE WRITE
// ============================================================

/**
 * Creates a new category document in Firestore using a manually
 * supplied ID (manualId) instead of an auto-generated one.
 * Throws if the ID is already taken to prevent silent overwrites.
 * Initialises itemCount to 0 and archived to false on creation.
 * @param {Object} categoryData — { name, normalizedName, createdBy }
 * @param {string} manualId     — the document ID to use
 * @returns {Promise<string>}   — the ID of the created document
 */
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

// ============================================================
// SECTION 7 — FORM SUBMISSION
// Handles the Add Category form submit event.
// Validation order:
//   1. Category ID is present
//   2. Category name is present
//   3. Name doesn't already exist in Firestore (case-insensitive)
// On success: writes to Firestore, logs the activity, busts the
// dashboard/products/categories caches, and shows the success modal.
// On failure: surfaces the error message via alert and re-enables
// the submit button so the user can correct and retry.
// ============================================================
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

// ============================================================
// SECTION 8 — SUCCESS MODAL
// ============================================================

/**
 * Displays the post-save success modal with the new category name
 * and animates a progress bar over ~2 seconds (100 steps × 40ms).
 * When the bar reaches 100%, automatically redirects to Categories.html.
 * @param {string} categoryName — displayed inside the modal message
 */
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

// ============================================================
// EXPORTS
// Shared helpers exported for use by other pages (e.g. Categories,
// Edit_Category) that need the same user cache, role check,
// sanitizer, Firestore write, or activity logging logic.
// ============================================================
export { 
    getCachedUserData, 
    checkAdminRole, 
    sanitizeInput, 
    addCategory, 
    logActivity };