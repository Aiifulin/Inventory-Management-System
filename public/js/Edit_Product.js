import { doc, getDoc, updateDoc, collection, getDocs, query, where, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { initLogoutModal } from "./logout-modal.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import { db, auth, storage } from "./firebase.js";


// ============================================================
// GLOBALS
// selectedImageFile  — holds the File object chosen by the user
//   before it is uploaded. Null when no new image is staged.
// isFormDirty        — tracks whether the user has unsaved
//   changes; triggers the beforeunload navigation warning.
// currentImageUrl    — the live image URL shown in the preview
//   (may differ from originalImageUrl mid-edit).
// originalImageUrl   — the image URL as it existed in Firestore
//   when the page loaded; used to decide whether to delete the
//   old Storage file after a successful save.
// removeExistingImage — flag set when the user explicitly clicks
//   the remove button, signalling that imageUrl should be cleared
//   in Firestore even if no new file was selected.
// ============================================================
let selectedImageFile  = null;
let isFormDirty        = false;
let currentImageUrl    = "";
let originalImageUrl   = "";
let removeExistingImage = false;


// ============================================================
// SECTION 1 — CACHE HELPERS
// User data is cached per-UID in sessionStorage to avoid paying
// an extra Firestore read on every page visit. The same pattern
// is used across Dashboard.js, EditCategory.js, and other pages.
// ============================================================

/**
 * Fetches the current user's Firestore document (name, role, etc.).
 * Returns the cached value from sessionStorage when available;
 * otherwise fetches from Firestore and stores the result.
 *
 * @param {string} uid — Firebase Auth UID of the logged-in user.
 * @returns {Object|null} — user data object, or null on failure.
 */
async function getCachedUserData(uid) {
    const CACHE_KEY = `user_data_${uid}`;

    // 1. Return cached value immediately if available.
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) return JSON.parse(cached);

    // 2. Fall back to a Firestore read and prime the cache.
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
 * Returns true when the given user holds the "admin" role.
 * Delegates to getCachedUserData() so no extra Firestore read
 * is made when the user data is already cached.
 *
 * @param {string} uid — Firebase Auth UID to check.
 * @returns {boolean}
 */
async function checkAdminRole(uid) {
    const userData = await getCachedUserData(uid);
    return userData?.role?.toLowerCase() === 'admin';
}

/**
 * Fetches user data via getCachedUserData() and injects the
 * user's name and role label into the sidebar name badge.
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
// Runs once on page load. Unauthenticated users are redirected
// to the login page. Authenticated non-admins are sent back to
// Products.html — this page is admin-only. Only after confirming
// admin access is the page initialised and the logout modal wired.
// ============================================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userData = await getCachedUserData(user.uid);
        const isAdmin  = userData?.role?.toLowerCase() === 'admin';

        if (!isAdmin) {
            // Block non-admins from accessing the edit page at all.
            alert("Access Denied: Only Admins can edit products.");
            window.location.href = "Products.html";
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
 * Logs a user action (e.g. "Updated Product") to the activities
 * collection. Used so the Dashboard can display a live audit trail.
 *
 * @param {string} action     — verb phrase describing what happened.
 * @param {string} targetName — the name of the affected resource.
 */
async function logActivity(action, targetName) {
    try {
        const userEmail = auth.currentUser ? auth.currentUser.email : "Admin";
        await addDoc(collection(db, "activities"), {
            action:    action,
            target:    targetName,
            user:      userEmail,
            timestamp: serverTimestamp()
        });
        console.log("Activity logged successfully");
    } catch (e) {
        console.error("Error logging activity", e);
    }
}


// ============================================================
// SECTION 4 — INPUT UTILITIES
// Small helpers for sanitising, constraining, and validating
// form inputs before any data is written to Firestore.
// ============================================================

/**
 * Sanitises a string against XSS by assigning it as innerText
 * of a temporary div and reading back the HTML-escaped result.
 * Returns an empty string for null/undefined inputs.
 *
 * @param {*} str — value to sanitise.
 * @returns {string} — HTML-safe string.
 */
function sanitizeInput(str) {
    if (!str) return "";
    if (typeof str !== 'string') return String(str);
    const div = document.createElement('div');
    div.innerText = str;
    return div.innerHTML;
}

/**
 * Attaches a 30-character hard limit to a text input and adds a
 * visual red border when the limit is reached.
 *
 * @param {HTMLInputElement} input — the input element to constrain.
 */
function applyCharLimit(input) {
    if (!input) return;
    input.setAttribute("maxlength", "30");
    input.addEventListener("input", function () {
        this.style.borderColor  = this.value.length >= 30 ? "red" : "";
        this.style.outlineColor = this.value.length >= 30 ? "red" : "";
    });
}

/**
 * Prevents a number input from holding a value below zero by
 * clamping it to 0 whenever a negative value is entered.
 *
 * @param {HTMLInputElement} input — the number input to guard.
 */
function preventNegatives(input) {
    input.addEventListener('input', function () {
        if (this.value < 0) this.value = 0;
    });
}


// ============================================================
// SECTION 5 — PAGE INITIALISATION
// initPage() is the main entry point called after the auth check
// confirms the user is an admin. It:
//   1. Reads the product ID from the URL query string.
//   2. Attaches the unsaved-changes guard to the form.
//   3. Sets up image upload, preview, and remove behaviour.
//   4. Fetches and pre-populates all existing product fields,
//      including variations and custom attributes.
//   5. Handles form submission — validation, image processing,
//      Firestore update, activity logging, and cache busting.
// ============================================================

/**
 * Bootstraps the Edit Product page. Reads ?id= from the URL,
 * sets up all event listeners, fetches the product document,
 * and registers the submit handler that validates input, uploads
 * any new image (with resize/compression), updates Firestore,
 * logs the activity, busts relevant caches, and shows a
 * success modal on completion.
 */
function initPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');

    if (!productId) {
        alert("No Product ID specified.");
        window.location.href = "Products.html";
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

    // Apply input constraints to name and all number fields.
    const nameInput = document.getElementById('inpName');
    if (nameInput) applyCharLimit(nameInput);
    document.querySelectorAll('input[type="number"]').forEach(inp => preventNegatives(inp));

    // --- IMAGE UPLOAD & REMOVE LOGIC ---
    const fileInput   = document.getElementById('fileInput');
    const preview     = document.getElementById('imagePreview');
    const placeholder = document.getElementById('uploadPlaceholder');
    const uploadBox   = document.querySelector('.image-upload-box');

    // Create the remove (×) button dynamically and hide it until an image is loaded.
    const removeBtn = document.createElement('button');
    removeBtn.innerHTML   = '<i class="fas fa-times"></i>';
    removeBtn.className   = 'btn-remove-image';
    removeBtn.type        = 'button';
    removeBtn.title       = "Remove Image";
    removeBtn.style.display = 'none';

    if (uploadBox) uploadBox.appendChild(removeBtn);
    removeBtn.addEventListener('click', resetImage);

    // --- FULLSCREEN IMAGE PREVIEW OVERLAY ---
    // Clicking the thumbnail opens a fullscreen overlay; the overlay
    // can be closed via the X button, clicking the backdrop, or Escape.
    const imgPreviewOverlay = document.getElementById('imgPreviewOverlay');
    const imgPreviewFull    = document.getElementById('imgPreviewFull');
    const imgPreviewClose   = document.getElementById('imgPreviewClose');

    if (preview) {
        preview.style.cursor = 'zoom-in';
        preview.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent triggering the upload box click handler.
            if (!preview.src || preview.style.display === 'none') return;
            imgPreviewFull.src = preview.src;
            imgPreviewOverlay.style.display = 'flex';
        });
    }

    imgPreviewClose?.addEventListener('click', () => {
        imgPreviewOverlay.style.display = 'none';
    });
    imgPreviewOverlay?.addEventListener('click', (e) => {
        if (e.target === imgPreviewOverlay) imgPreviewOverlay.style.display = 'none';
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && imgPreviewOverlay.style.display === 'flex') {
            imgPreviewOverlay.style.display = 'none';
        }
    });

    /**
     * Resets the image selection back to a blank state.
     * If the product had an existing image, sets removeExistingImage
     * so the save handler knows to clear imageUrl in Firestore.
     */
    function resetImage(e) {
        if (e) e.stopPropagation();
        fileInput.value        = "";
        selectedImageFile      = null;
        currentImageUrl        = "";
        removeExistingImage    = !!originalImageUrl;
        preview.src            = "";
        preview.style.display  = "none";
        placeholder.style.display = "block";
        removeBtn.style.display   = "none";
        isFormDirty = true;
    }

    // Clicking anywhere on the upload box opens the file picker,
    // unless the click was on the preview image or remove button.
    if (uploadBox) {
        uploadBox.addEventListener('click', (e) => {
            if (e.target === preview || e.target === removeBtn || removeBtn.contains(e.target)) return;
            fileInput.click();
        });
    }

    // Validate the selected file (type and size) before staging it for upload.
    if (fileInput) {
        fileInput.addEventListener('change', function (e) {
            const file = e.target.files[0];
            if (!file) return;

            if (!file.type.startsWith('image/')) {
                alert("Please select a valid image file (PNG, JPG, etc.)");
                fileInput.value = "";
                return;
            }
            if (file.size > 750000) {
                alert("File is too large! Please select an image under 750KB.");
                fileInput.value = "";
                return;
            }

            // Read the file into a data URL so we can show a local preview
            // before any upload has happened.
            const reader = new FileReader();
            reader.onloadend = function () {
                selectedImageFile       = file;
                removeExistingImage     = false;
                preview.src             = reader.result;
                preview.style.display   = "block";
                placeholder.style.display = "none";
                removeBtn.style.display   = "flex";
                isFormDirty = true;
            };
            reader.readAsDataURL(file);
        });
    }

    // --- FETCH AND PRE-FILL EXISTING DATA ---
    // Wrapped in an IIFE so we can use async/await inside initPage().
    (async () => {
        try {
            const docRef  = doc(db, "products", productId);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();

                // Pre-fill all basic fields.
                document.getElementById('inpName').value      = data.name        || "";
                document.getElementById('inpDesc').value      = data.description || "";
                document.getElementById('inpCategory').value  = data.category    || "";
                document.getElementById('inpPrice').value     = data.price       || "";
                document.getElementById('inpStock').value     = data.stock       || "";
                document.getElementById('inpLowStock').value  = data.lowStockThreshold || 10;

                const productIdDisplay = document.getElementById('productIdDisplay');
                if (productIdDisplay) productIdDisplay.value = productId;

                // Load the existing product image into the preview if one exists.
                if (data.imageUrl) {
                    currentImageUrl     = data.imageUrl;
                    originalImageUrl    = data.imageUrl;
                    removeExistingImage = false;
                    preview.src             = data.imageUrl;
                    preview.style.display   = "block";
                    placeholder.style.display = "none";
                    removeBtn.style.display   = "flex";
                } else {
                    originalImageUrl    = "";
                    currentImageUrl     = "";
                    removeExistingImage = false;
                    removeBtn.style.display = "none";
                }

                // Pre-fill dynamic variation rows; add one blank row if none exist.
                if (data.variations && data.variations.length > 0) {
                    data.variations.forEach(v => addVariationRow(v.size, v.color, v.custom));
                } else {
                    addVariationRow();
                }

                // Pre-fill dynamic custom attribute rows if any exist.
                if (data.attributes && data.attributes.length > 0) {
                    data.attributes.forEach(a => addAttributeRow(a.name, a.value));
                }

            } else {
                alert("Product not found!");
                window.location.href = "Products.html";
            }
        } catch (e) {
            console.error("Error fetching product:", e);
        }
    })();

    setupDynamicRows();

    // --- SAVE / SUBMIT LOGIC ---
    const submitBtn = document.querySelector('.btn-submit');

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            submitBtn.innerText = "Updating...";
            submitBtn.disabled  = true;

            try {
                const priceVal     = parseFloat(document.getElementById('inpPrice').value) || 0;
                const stockVal     = parseInt(document.getElementById('inpStock').value)   || 0;
                const thresholdVal = parseInt(document.getElementById('inpLowStock').value) || 10;

                // VALIDATION 1 — Reject negative values for price, stock, and threshold.
                if (priceVal < 0 || stockVal < 0 || thresholdVal < 0) {
                    throw new Error("Price and Stock values cannot be negative.");
                }

                // VALIDATION 2 — Warn the user if they are intentionally setting price to 0.
                if (priceVal === 0) {
                    const confirmZero = confirm("⚠️ Warning: You are setting the Price to 0.00.\n\nAre you sure this product is free?");
                    if (!confirmZero) {
                        submitBtn.innerText = "Save Changes";
                        submitBtn.disabled  = false;
                        return;
                    }
                }

                const rawName = document.getElementById('inpName').value.trim();
                const rawDesc = document.getElementById('inpDesc').value;

                // VALIDATION 3 — Duplicate name check (case-sensitive first, then case-insensitive).
                // The current product's own ID is excluded from both checks.
                const q             = query(collection(db, "products"), where("name", "==", rawName));
                const querySnapshot = await getDocs(q);

                let isDuplicate = false;
                if (!querySnapshot.empty) {
                    querySnapshot.forEach(d => { if (d.id !== productId) isDuplicate = true; });
                }

                if (!isDuplicate) {
                    const allDocs = await getDocs(collection(db, "products"));
                    allDocs.forEach(d => {
                        if (d.id !== productId && d.data().name.toLowerCase() === rawName.toLowerCase()) {
                            isDuplicate = true;
                        }
                    });
                }

                if (isDuplicate) throw new Error(`Product name "${rawName}" already exists!`);

                // Collect and sanitise all variation rows (size + color required).
                const variations = [];
                document.querySelectorAll('.variations-row').forEach(row => {
                    const size   = sanitizeInput(row.querySelector('.var-size').value);
                    const color  = sanitizeInput(row.querySelector('.var-color').value);
                    const custom = sanitizeInput(row.querySelector('.var-custom').value);
                    if (size && color) variations.push({ size, color, custom });
                });

                // Collect and sanitise all custom attribute rows (name + value required).
                const attributes = [];
                document.querySelectorAll('.custom-attr-row').forEach(row => {
                    const name  = sanitizeInput(row.querySelector('.attr-name').value);
                    const value = sanitizeInput(row.querySelector('.attr-value').value);
                    if (name && value) attributes.push({ name, value });
                });

                if (variations.length === 0) {
                    throw new Error("Please add at least one valid Product Variation.");
                }

                const updatedData = {
                    name:              sanitizeInput(rawName),
                    description:       sanitizeInput(rawDesc),
                    category:          document.getElementById('inpCategory').value,
                    price:             priceVal,
                    stock:             stockVal,
                    lowStockThreshold: thresholdVal,
                    imageUrl:          currentImageUrl || "",
                    variations,
                    attributes
                };

                const previousImageUrl = originalImageUrl;

                // IMAGE HANDLING — three possible branches:
                //   a) New file selected → resize, compress, upload, get URL.
                //   b) Existing image removed → clear the imageUrl field.
                //   c) No change → keep the current URL as-is.
                if (selectedImageFile) {
                    submitBtn.innerText = "Optimizing Image...";
                    const resizedImage  = await resizeImage(selectedImageFile, 500);

                    submitBtn.innerText = "Uploading Image...";
                    const storageRef    = ref(storage, `products/images/${Date.now()}_${selectedImageFile.name}`);
                    const snapshot      = await uploadBytes(storageRef, resizedImage);
                    updatedData.imageUrl = await getDownloadURL(snapshot.ref);
                } else if (removeExistingImage) {
                    updatedData.imageUrl = "";
                } else {
                    updatedData.imageUrl = currentImageUrl;
                }

                // STEP 1 — Persist the updated product document to Firestore.
                await updateDoc(doc(db, "products", productId), updatedData);

                // STEP 2 — Delete the old Storage file if a new image replaced it,
                // or if the user explicitly removed the image with no replacement.
                if (selectedImageFile && previousImageUrl && previousImageUrl !== updatedData.imageUrl) {
                    await deleteImageByUrl(previousImageUrl);
                }
                if (!selectedImageFile && removeExistingImage && previousImageUrl) {
                    await deleteImageByUrl(previousImageUrl);
                }

                // STEP 3 — Write an audit log entry for the Dashboard feed.
                await logActivity("Updated Product", updatedData.name);

                // Reset image-tracking globals to the new saved state.
                isFormDirty         = false;
                currentImageUrl     = updatedData.imageUrl;
                originalImageUrl    = updatedData.imageUrl;
                removeExistingImage = false;
                selectedImageFile   = null;

                // STEP 4 — Bust all related caches so Dashboard, Products, and
                // Categories pages reflect the change on their next load.
                sessionStorage.removeItem('dashboard_cache');
                sessionStorage.removeItem('products_cache');
                sessionStorage.removeItem('categories_cache');

                showSuccessModal(updatedData.name);

            } catch (error) {
                console.error("Error updating:", error);
                alert("Error updating product: " + error.message);
                submitBtn.innerText = "Save Changes";
                submitBtn.disabled  = false;
            }
        });
    }
}


// ============================================================
// SECTION 6 — IMAGE PROCESSING
// Resizes and compresses a user-selected image client-side
// before uploading to Firebase Storage, keeping file sizes
// small and load times fast for product listings.
// ============================================================

/**
 * Resizes an image File to a maximum width and compresses it to
 * JPEG at 70% quality using an off-screen canvas. Returns a Blob
 * ready to be passed directly to Firebase Storage's uploadBytes().
 *
 * @param {File}   file     — the original image file from the input.
 * @param {number} maxWidth — maximum pixel width of the output (default 500).
 * @returns {Promise<Blob>} — the resized and compressed image blob.
 */
async function resizeImage(file, maxWidth = 500) {
    return new Promise((resolve) => {
        const img    = new Image();
        const reader = new FileReader();

        reader.onload = e => { img.src = e.target.result; };

        img.onload = () => {
            const canvas  = document.createElement('canvas');
            const scale   = maxWidth / img.width;
            canvas.width  = maxWidth;
            canvas.height = img.height * scale;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            // Encode as JPEG at 70% quality to reduce upload size.
            canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.7);
        };

        reader.readAsDataURL(file);
    });
}


// ============================================================
// SECTION 7 — DYNAMIC ROW HELPERS
// Functions for building and removing the variation and custom
// attribute rows that are added/removed at runtime by the user.
// ============================================================

/**
 * Creates and appends a new variation row (size, color, custom)
 * to the variations container. Pre-fills values when provided,
 * useful for populating rows from existing Firestore data.
 *
 * @param {string} size   — pre-fill value for the Size field.
 * @param {string} color  — pre-fill value for the Color field.
 * @param {string} custom — pre-fill value for the Custom field.
 */
function addVariationRow(size = "", color = "", custom = "") {
    const container = document.getElementById("variation-container");
    const row       = document.createElement("div");
    row.className   = "variations-row";

    row.innerHTML = `
        <div class="input-group"><input type="text" class="var-size"   placeholder="Ex: Large"     maxlength="30"></div>
        <div class="input-group"><input type="text" class="var-color"  placeholder="Ex: Red"       maxlength="30"></div>
        <div class="input-group"><input type="text" class="var-custom" placeholder="Optional"              maxlength="30"></div>
        <button type="button" class="btn-delete remove-row-btn"><i class="fas fa-trash"></i></button>
    `;

    row.querySelector('.var-size').value   = size   || "";
    row.querySelector('.var-color').value  = color  || "";
    row.querySelector('.var-custom').value = custom || "";

    row.querySelectorAll('input').forEach(inp => applyCharLimit(inp));
    container.appendChild(row);
}

/**
 * Creates and appends a new custom attribute row (name + value)
 * to the attributes container. Pre-fills values when provided.
 *
 * @param {string} name  — pre-fill value for the Attribute Name field.
 * @param {string} value — pre-fill value for the Attribute Value field.
 */
function addAttributeRow(name = "", value = "") {
    const container = document.getElementById("custom-attributes-container");
    const row       = document.createElement("div");
    row.className   = "custom-attr-row";

    row.innerHTML = `
        <div class="input-group"><input type="text" class="attr-name"  placeholder="Name"  maxlength="30"></div>
        <div class="input-group"><input type="text" class="attr-value" placeholder="Value" maxlength="30"></div>
        <button type="button" class="btn-delete remove-attr-btn"><i class="fas fa-trash"></i></button>
    `;

    row.querySelector('.attr-name').value  = name  || "";
    row.querySelector('.attr-value').value = value || "";

    row.querySelectorAll('input').forEach(inp => applyCharLimit(inp));
    container.appendChild(row);
}

/**
 * Wires up the "Add Variation" and "Add Attribute" buttons, and
 * registers a single delegated click listener on document.body
 * that handles removal of any variation or attribute row. Using
 * event delegation means rows added dynamically still respond
 * to remove clicks without needing individual listeners.
 */
function setupDynamicRows() {
    const addVarBtn  = document.getElementById("add-main-variation-btn");
    const addAttrBtn = document.getElementById("add-custom-attr-main-btn");

    if (addVarBtn)  addVarBtn.addEventListener("click",  () => addVariationRow());
    if (addAttrBtn) addAttrBtn.addEventListener("click", () => addAttributeRow());

    // Delegated removal — listens on body so it catches dynamically created rows.
    document.body.addEventListener("click", (e) => {
        if (e.target.closest(".remove-row-btn")) {
            e.target.closest(".variations-row").remove();
            isFormDirty = true;
        }
        if (e.target.closest(".remove-attr-btn")) {
            e.target.closest(".custom-attr-row").remove();
            isFormDirty = true;
        }
    });
}


// ============================================================
// SECTION 8 — CATEGORY LOADER
// Populates the Category <select> dropdown from Firestore on
// DOMContentLoaded. Archived categories are filtered out so
// users can only assign products to active categories.
// ============================================================

/**
 * Fetches all non-archived categories from Firestore and injects
 * them as <option> elements into the Category dropdown. Clears
 * any previously rendered options before populating.
 */
async function loadCategories() {
    const categorySelect = document.getElementById("inpCategory");
    if (!categorySelect) return;

    // Reset the dropdown to just the placeholder option.
    categorySelect.innerHTML = `<option value="" disabled selected>Select Category</option>`;

    try {
        const snapshot = await getDocs(collection(db, "categories"));
        snapshot.forEach(docSnap => {
            const category = docSnap.data();
            if (category.archived !== true) {
                const option       = document.createElement("option");
                option.value       = category.name;
                option.textContent = category.name;
                categorySelect.appendChild(option);
            }
        });
    } catch (err) {
        console.error("Error loading categories:", err);
    }
}

// Populate the category dropdown as soon as the DOM is ready.
document.addEventListener("DOMContentLoaded", loadCategories);


// ============================================================
// SECTION 9 — SUCCESS MODAL
// Shown briefly after a successful save before auto-redirecting
// the user back to the Products list page.
// ============================================================

/**
 * Displays the success confirmation modal with the updated product
 * name, then redirects to Products.html after 1 second.
 *
 * @param {string} productName — the name of the just-updated product.
 */
function showSuccessModal(productName) {
    const modal = document.getElementById('successModal');
    const label = document.getElementById('successProductName');

    if (label) label.textContent = `"${productName}" has been updated.`;
    if (modal) modal.style.display = 'flex';

    setTimeout(() => {
        window.location.href = "Products.html";
    }, 1000);
}


// ============================================================
// SECTION 10 — STORAGE UTILITIES
// Helpers for safely deleting images from Firebase Storage by
// their full download URL rather than a storage path string.
// ============================================================

/**
 * Extracts the Firebase Storage object path from a full download
 * URL. Returns null if the URL doesn't follow the expected format.
 *
 * @param {string} url — the Firebase Storage download URL.
 * @returns {string|null} — the decoded storage path, or null.
 */
function getPathFromUrl(url) {
    const index = url.indexOf("/o/");
    if (index === -1) return null;
    return decodeURIComponent(url.substring(index + 3, url.indexOf("?")));
}

/**
 * Deletes the Firebase Storage file at the path encoded in the
 * given download URL. Silently ignores "object not found" errors
 * (e.g. already deleted) but re-throws all other errors.
 *
 * @param {string} url — the Firebase Storage download URL to delete.
 */
async function deleteImageByUrl(url) {
    const path = getPathFromUrl(url);
    if (!path) return;

    try {
        await deleteObject(ref(storage, path));
    } catch (error) {
        // Ignore missing-file errors; re-throw anything else.
        if (error?.code !== "storage/object-not-found") throw error;
    }
}


// ============================================================
// EXPORTS
// Named exports allow other modules to reuse individual helpers
// without importing the entire module.
// ============================================================
export {
    getCachedUserData,
    checkAdminRole,
    logActivity,
    sanitizeInput,
    loadCategories,
    getPathFromUrl,
    deleteImageByUrl
};