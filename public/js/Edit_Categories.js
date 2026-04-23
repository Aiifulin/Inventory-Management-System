import { doc, getDoc, updateDoc, collection, addDoc, serverTimestamp, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { initLogoutModal } from "./logout-modal.js";
import { db, auth, storage } from "./firebase.js";


// ============================================================
// GLOBALS
// isFormDirty — tracks whether the user has made unsaved changes
//   to the edit form. Used by the beforeunload guard to warn
//   users before they accidentally navigate away mid-edit.
// ============================================================
let isFormDirty = false;


// ============================================================
// SECTION 1 — CACHE HELPERS
// User data is cached in sessionStorage so revisiting the page
// doesn't trigger an extra Firestore read. Same pattern used
// across Dashboard.js and other pages for consistency.
// ============================================================

/**
 * Fetches the current user's Firestore document (name, role, etc.).
 * Results are cached per-UID in sessionStorage so repeat visits
 * don't cost an extra read.
 *
 * @param {string} uid — Firebase Auth UID of the logged-in user.
 * @returns {Object|null} — user data object, or null on failure.
 */
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

/**
 * Fetches user data via getCachedUserData() and injects the
 * user's name and role into the sidebar name badge element.
 * The role is displayed in orange beside the name.
 *
 * @param {string} uid — Firebase Auth UID of the logged-in user.
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
// SECTION 2 — AUTH LISTENER
// Runs once on page load. Non-authenticated users are sent to
// the login page immediately. Authenticated non-admins are
// redirected to Categories.html — this page is admin-only.
// Only after confirming admin access is the page initialised.
// ============================================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userData = await getCachedUserData(user.uid);
        const isAdmin  = userData?.role?.toLowerCase() === 'admin';

        if (!isAdmin) {
            // Block non-admins from accessing the edit page at all.
            alert("Access Denied: Only Admins can edit categories.");
            window.location.href = "Categories.html";
        } else {
            await displayUserName(user.uid);
            initPage();

            // Wire up the logout modal with a sign-out callback that clears
            // all local/session storage before signing the user out of Firebase.
            const doSignOut = () => {
                localStorage.removeItem("user_session");
                localStorage.removeItem("user_uid");
                localStorage.removeItem("user_role");
                sessionStorage.clear();
                signOut(auth)
                    .then(() => window.location.replace("index.html"))
                    .catch(() => window.location.replace("index.html"));
            };
            const openLogoutModal = initLogoutModal(doSignOut);
            window.logout = function () { if (openLogoutModal) openLogoutModal(); };
        }
    } else {
        window.location.href = "index.html";
    }
});


// ============================================================
// SECTION 3 — ACTIVITY LOGGING
// Writes a record to the "activities" Firestore collection so
// the Dashboard's Recent Activities feed stays up to date.
// All writes use serverTimestamp() to avoid clock-skew issues.
// ============================================================

/**
 * Logs a user action (e.g. "Updated Category") to the activities
 * collection. Used so the Dashboard can display a live audit trail.
 *
 * @param {string} action     — verb phrase describing what happened.
 * @param {string} targetName — the name of the affected resource.
 */
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


// ============================================================
// SECTION 4 — INPUT UTILITIES
// Small helpers for enforcing input constraints on form fields.
// ============================================================

/**
 * Attaches a 100-character hard limit to a text input and adds a
 * visual red border when the limit is reached, giving users a
 * clear warning before the input stops accepting characters.
 *
 * @param {HTMLInputElement} input — the input element to constrain.
 */
function applyCharLimit(input) {
    if (!input) return;
    input.setAttribute("maxlength", "100");
    input.addEventListener("input", function () {
        this.style.borderColor  = this.value.length >= 100 ? "red" : "";
        this.style.outlineColor = this.value.length >= 100 ? "red" : "";
    });
}


// ============================================================
// SECTION 5 — PAGE INITIALISATION
// initPage() is the main entry point called after the auth check
// confirms the user is an admin. It:
//   1. Reads the category ID from the URL query string.
//   2. Attaches the unsaved-changes guard to the form.
//   3. Fetches and pre-populates the existing category data.
//   4. Handles the form submission, including duplicate-name
//      checking and cascading the rename to all products.
// ============================================================

/**
 * Bootstraps the Edit Category page:
 *   - Reads ?id= from the URL to identify which category to edit.
 *   - Sets up the data-loss prevention guard (beforeunload).
 *   - Fetches the category document and pre-fills the form fields.
 *   - Registers the submit handler that validates, updates
 *     Firestore, cascades the rename to products, logs the
 *     activity, busts relevant caches, and shows a success modal.
 */
function initPage() {
    const urlParams  = new URLSearchParams(window.location.search);
    const categoryId = urlParams.get('id');

    if (!categoryId) {
        alert("No Category ID specified.");
        window.location.href = "Categories.html";
        return;
    }

    // --- DATA LOSS PREVENTION ---
    // Mark the form as dirty whenever the user changes any field.
    // The beforeunload listener will prompt them before leaving.
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

    // --- FETCH AND PRE-FILL EXISTING DATA ---
    // Wrapped in an IIFE so we can use async/await inside initPage().
    (async () => {
        try {
            const docRef  = doc(db, "categories", categoryId);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();

                // Pre-fill the name field with the current category name.
                nameInput.value = data.name || "";
                document.getElementById('inpCategoryId').value = categoryId;

                // Store the original name so the save handler can detect
                // renames and trigger the product cascade if needed.
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

    // --- SAVE / SUBMIT LOGIC ---
    const submitBtn = document.querySelector('.btn-submit');

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            submitBtn.innerText = "Updating...";
            submitBtn.disabled  = true;

            try {
                const rawName      = document.getElementById('inpName').value.trim();
                const originalName = document.getElementById('inpName').dataset.originalName || "";

                if (!rawName) throw new Error("Category name is required.");

                // Duplicate check — query for any category with the same
                // name and reject if one is found (excluding the current doc).
                const q  = query(collection(db, "categories"), where("name", "==", rawName));
                const qs = await getDocs(q);
                let isDuplicate = false;
                qs.forEach(d => { if (d.id !== categoryId) isDuplicate = true; });
                if (isDuplicate) throw new Error(`Category "${rawName}" already exists!`);

                const updatedData = {
                    name:           rawName,
                    normalizedName: rawName.toLowerCase(),
                    updatedAt:      serverTimestamp()
                };

                // STEP 1 — Update the category document itself.
                await updateDoc(doc(db, "categories", categoryId), updatedData);

                // STEP 2 — Cascade the rename to every product in this category.
                // Only runs when the name actually changed to avoid unnecessary writes.
                const nameChanged = originalName && originalName !== rawName;
                if (nameChanged) {
                    submitBtn.innerText = "Updating Products...";

                    const productsQuery = query(
                        collection(db, "products"),
                        where("category", "==", originalName)
                    );
                    const productsSnap = await getDocs(productsQuery);

                    // Fire all product updates in parallel for speed.
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

                // STEP 3 — Write an audit log entry for the Dashboard feed.
                await logActivity("Updated Category", rawName);

                // STEP 4 — Bust all related caches so Dashboard, Products,
                // and Categories pages reflect the change on next load.
                sessionStorage.removeItem('dashboard_cache');
                sessionStorage.removeItem('products_cache');
                sessionStorage.removeItem('categories_cache');

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


// ============================================================
// SECTION 6 — SUCCESS MODAL
// Shown briefly after a successful save before auto-redirecting
// the user back to the Categories list page.
// ============================================================

/**
 * Displays the success confirmation modal with the updated
 * category name, then redirects to Categories.html after 1 second.
 *
 * @param {string} categoryName — the name of the just-updated category.
 */
function showSuccessModal(categoryName) {
    const modal = document.getElementById('successModal');
    const label = document.getElementById('successCategoryName');

    if (label) label.textContent = `"${categoryName}" has been updated.`;
    if (modal) modal.style.display = 'flex';

    setTimeout(() => {
        window.location.href = "Categories.html";
    }, 1000);
}


// ============================================================
// EXPORTS
// Named exports allow other modules to reuse these helpers
// without importing the entire module.
// ============================================================
export { 
    getCachedUserData, 
    logActivity };