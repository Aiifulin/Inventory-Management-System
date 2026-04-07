import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js"
import { getFirestore, collection, addDoc, serverTimestamp, query, where, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

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
const storage = getStorage(app);

let isFormDirty = false;
let selectedImageFile = null;
let draftProducts = [];       // array of queued product objects
let isBulkMode = false;


// ================================================
// OPTIMIZED USER DATA HELPER (SHARED)
// ================================================
async function getCachedUserData(uid) {
    const CACHE_KEY = `user_data_${uid}`;
    
    // 1. Check cache first
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) return JSON.parse(cached);

    // 2. Fetch from Firestore if not cached
    try {
        const userDocRef = doc(db, "users", uid);
        const userSnap = await getDoc(userDocRef);

        if (userSnap.exists()) {
            const data = userSnap.data();

            // Save to session cache
            sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));

            return data;
        }
    } catch (error) {
        console.error("Error fetching user data:", error);
    }

    return null;
}

// --- AUTH CHECK WITH ROLE VALIDATION ---
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "Login.html";
        return;
    }

    const userData = await getCachedUserData(user.uid);
    const isAdmin  = userData?.role?.toLowerCase() === 'admin';
    const main     = document.getElementById('mainContent');

    if (!isAdmin) {
        // Swap content while still hidden — non-admins never see the form
        main.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center;
                        justify-content:center; height:60vh; text-align:center;
                        color:var(--text-secondary);">
                <i class="fas fa-lock" style="font-size:48px; margin-bottom:16px;"></i>
                <h2 style="margin:0 0 8px; color:var(--text-main); font-size:20px;">Access Denied</h2>
                <p style="margin:0; font-size:14px;">Only admins can add products.</p>
                
            </div>`;
        main.style.visibility = 'visible';
        return;
    }

    // Admin path — reveal form and load page
    displayUserRole(user.uid);
    loadDefaultThreshold();
    main.style.visibility = 'visible';
});

async function checkAdminRole(uid) {
    const userData = await getCachedUserData(uid);
    return userData?.role?.toLowerCase() === 'admin';
}

async function displayUserRole(uid) {
    const el = document.getElementById("userRoleDisplay");
    if (!el) return;

    const userData = await getCachedUserData(uid);

    let role = userData?.role || "User";
    role = role.charAt(0).toUpperCase() + role.slice(1);

    el.textContent = role;
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

// --- HELPER: LOAD DEFAULT SETTINGS ---
async function loadDefaultThreshold() {
    try {
        const docRef = doc(db, "settings", "global_config");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            const settingValue = data.defaultLowStockThreshold;
            
            const thresholdInput = document.querySelector('input[placeholder="10"]');
            
            if (thresholdInput && settingValue) {
                thresholdInput.value = settingValue;
            }
        }
    } catch (error) {
        console.log("Could not load default settings, using hardcoded fallback.");
    }
}

// --- LOAD CATEGORIES INTO SELECT ---
async function loadCategories() {
    const select = document.getElementById("categorySelect");
    if (!select) return;

    select.innerHTML = '<option value="" disabled selected>Select a category</option>';

    try {
        const snapshot = await getDocs(collection(db, "categories"));
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            // Skip archived categories
            if (data.archived === true) return;
            if (data.name) {
                const option = document.createElement("option");
                option.value = data.name;
                option.textContent = data.name;
                select.appendChild(option);
            }
        });
    } catch (error) {
        console.error("Error loading categories:", error);
    }
}

// Call this once DOM is ready
document.addEventListener("DOMContentLoaded", loadCategories);

document.addEventListener("DOMContentLoaded", () => {

    // --- 1. DATA LOSS PREVENTION ---
    const form = document.querySelector('form');
    
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

    // --- 2. SANITIZERS & HELPERS --- this prevents XSS attacks by sanitizing inputs using DOM methods
    function sanitizeInput(str) {
        if (!str) return "";
        if (typeof str !== 'string') return String(str);
        const div = document.createElement('div');
        div.innerText = str; 
        return div.innerHTML;
    }

    function applyCharLimit(input) {
        if (!input) return;
        input.setAttribute("maxlength", "30");
        input.addEventListener("input", function() {
            if (this.value.length >= 30) {
                this.style.borderColor = "red";
                this.style.outlineColor = "red"; 
            } else {
                this.style.borderColor = "";
                this.style.outlineColor = "";
            }
        });
    }

    function preventNegatives(input) {
        input.addEventListener('input', function() {
            if (this.value < 0) this.value = 0; 
        });
    }
    
    const nameInput = document.querySelector('input[placeholder="Enter product name"]');
    if(nameInput) applyCharLimit(nameInput);
    document.querySelectorAll('input[type="number"]').forEach(inp => preventNegatives(inp));

    // --- 3. IMAGE UPLOAD & REMOVE LOGIC ---
    const fileInput = document.getElementById('fileInput');
    const preview = document.getElementById('imagePreview');
    const placeholder = document.getElementById('uploadPlaceholder');
    const uploadBox = document.querySelector('.image-upload-box');

    // Create Remove Button Dynamically
    const removeBtn = document.createElement('button');
    removeBtn.innerHTML = '<i class="fas fa-times"></i>';
    removeBtn.className = 'btn-remove-image';
    removeBtn.type = 'button'; 
    removeBtn.title = "Remove Image";
    removeBtn.style.display = 'none'; 

    if(uploadBox) uploadBox.appendChild(removeBtn);

    function resetImage(e) {
        if(e) e.stopPropagation(); 
        fileInput.value = "";
        preview.src = "";
        selectedImageFile = null; // stores the raw File object
        preview.style.display = "none";
        placeholder.style.display = "block";
        removeBtn.style.display = "none"; 
        isFormDirty = true;
    }

    removeBtn.addEventListener('click', resetImage);

    if (fileInput) {
        fileInput.addEventListener('change', function (e) {
            const file = e.target.files[0];
            if (!file) return;

            if (!file.type.startsWith('image/')) {// Basic MIME type check for images
                alert("Please select a valid image file (PNG, JPG, etc.)");
                fileInput.value = "";
                return;
            }
    
            if (file.size > 5000000) { // 5MB limit for raw file size
                alert("File is too large! Please select an image under 5mb.");
                fileInput.value = "";
                return;
            }
    
            // Store the file reference instead of converting to base64
            selectedImageFile = file;
    
            const reader = new FileReader();
            reader.onloadend = function () {
                preview.src = reader.result;       // preview still works locally
                preview.style.display = "block";
                placeholder.style.display = "none";
                removeBtn.style.display = "flex";
                isFormDirty = true;
            };
            reader.readAsDataURL(file);
        });
    }

    // --- ROW LOGIC ---
    const variationContainer = document.getElementById("variation-container");
    const addVarBtn = document.getElementById("add-main-variation-btn");

    if(addVarBtn && variationContainer) {
        variationContainer.querySelectorAll('input').forEach(inp => applyCharLimit(inp));
        addVarBtn.addEventListener("click", () => {
            const newRow = document.createElement("div");
            newRow.classList.add("variations-row");
            newRow.innerHTML = `
                <div class="input-group"><input type="text" class="var-size" placeholder="Ex: Large" required></div>
                <div class="input-group"><input type="text" class="var-color" placeholder="Ex: Red" required></div>
                <div class="input-group"><input type="text" class="var-custom" placeholder="Optional"></div>
                <button type="button" class="btn-delete remove-row-btn"><i class="fas fa-trash"></i></button>
            `;
            newRow.querySelectorAll('input').forEach(inp => applyCharLimit(inp));
            variationContainer.appendChild(newRow);
        });
        variationContainer.addEventListener("click", (e) => {
            const btn = e.target.closest(".remove-row-btn");
            if (btn && variationContainer.querySelectorAll('.variations-row').length > 1) {
                btn.closest(".variations-row").remove();
            }
        });
    }

    const attrContainer = document.getElementById("custom-attributes-container");
    const addAttrBtn = document.getElementById("add-custom-attr-main-btn");

    if(addAttrBtn && attrContainer) {
        attrContainer.querySelectorAll('input').forEach(inp => applyCharLimit(inp));
        addAttrBtn.addEventListener("click", () => {
            const newRow = document.createElement("div");
            newRow.classList.add("custom-attr-row");
            newRow.innerHTML = `
                <div class="input-group"><input type="text" class="attr-name" placeholder="Name"></div>
                <div class="input-group"><input type="text" class="attr-value" placeholder="Value"></div>
                <button type="button" class="btn-delete remove-attr-btn"><i class="fas fa-trash"></i></button>
            `;
            newRow.querySelectorAll('input').forEach(inp => applyCharLimit(inp));
            attrContainer.appendChild(newRow);
        });
        attrContainer.addEventListener("click", (e) => {
            const btn = e.target.closest(".remove-attr-btn");
            if (btn && attrContainer.querySelectorAll('.custom-attr-row').length > 1) {
                btn.closest(".custom-attr-row").remove();
            }
        });
    }

    // --- 4. SAVE LOGIC WITH LOGGING ---
    const submitBtn = document.querySelector('.btn-submit');

    if(form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault(); 
            if (isBulkMode) return;

            submitBtn.innerText = "Saving...";
            submitBtn.disabled = true;

            try {
                const priceVal = parseFloat(document.querySelector('input[type="number"][step="0.01"]').value) || 0;
                const stockVal = parseInt(document.querySelector('input[placeholder="0"]').value) || 0;
                const thresholdVal = parseInt(document.querySelector('input[placeholder="10"]').value) || 10;

                // VALIDATION 1: Check Negatives
                if (priceVal < 0 || stockVal < 0 || thresholdVal < 0) {
                    throw new Error("Price and Stock values cannot be negative.");
                }

                // VALIDATION 2: Check for 0 Price with Confirmation
                if (priceVal === 0) {
                    const confirmZero = confirm("⚠️ Warning: You are setting the Price to 0.00.\n\nAre you sure this product is free?");
                    if (!confirmZero) {
                        submitBtn.innerText = "Add Product"; 
                        submitBtn.disabled = false;
                        return; 
                    }
                }

                const rawName = document.querySelector('input[placeholder="Enter product name"]').value.trim();
                const rawDesc = document.querySelector('textarea').value;

                // DUPLICATE CHECK
                const q = query(collection(db, "products"), where("name", "==", rawName));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    throw new Error(`Product name "${rawName}" already exists!`);
                }

                // --- UPLOAD IMAGE TO FIREBASE STORAGE ---
                let imageUrl = "";
                
                if (selectedImageFile) {
                    submitBtn.innerText = "Uploading Image...";
                
                    // Creates a unique path: products/images/<timestamp>_<filename>
                    const storageRef = ref(storage, `products/images/${Date.now()}_${selectedImageFile.name}`);
                    const snapshot = await uploadBytes(storageRef, selectedImageFile);
                    imageUrl = await getDownloadURL(snapshot.ref);
                }                

                const productData = {
                    name: sanitizeInput(rawName), 
                    description: sanitizeInput(rawDesc), 
                    category: document.getElementById('categorySelect').value, 
                    price: priceVal, 
                    stock: stockVal,
                    lowStockThreshold: thresholdVal,
                    imageUrl: imageUrl,          // <-- now a real hosted URL, or "" if none
                    createdAt: serverTimestamp(),
                    createdBy: auth.currentUser.uid,
                    variations: [],
                    attributes: []
                };

                // Harvest Variations
                document.querySelectorAll('.variations-row').forEach(row => {
                    const size = sanitizeInput(row.querySelector('.var-size').value);
                    const color = sanitizeInput(row.querySelector('.var-color').value);
                    const custom = sanitizeInput(row.querySelector('.var-custom').value);
                    if(size && color) productData.variations.push({ size, color, custom });
                });

                // Harvest Attributes
                document.querySelectorAll('.custom-attr-row').forEach(row => {
                    const name = sanitizeInput(row.querySelector('.attr-name').value);
                    const value = sanitizeInput(row.querySelector('.attr-value').value);
                    if(name && value) productData.attributes.push({ name, value });
                });

                if (productData.variations.length === 0) {
                    throw new Error("Please add at least one valid Product Variation.");
                }

                // 1. SAVE PRODUCT
                await addDoc(collection(db, "products"), productData);
                
                isFormDirty = false; 

                // 2. LOG ACTIVITY
                await logActivity("Added Product", productData.name);

                // Replace the alert with this:
                showSuccessAndRedirect();
                
                // Define this function inside or outside your DOMContentLoaded
                function showSuccessAndRedirect() {
                    const modal = document.getElementById('successModal');
                    const progressBar = document.getElementById('redirectProgress');
                    
                    modal.style.display = 'flex';
                
                    // Animate the progress bar over 2.5 seconds
                    let width = 0;
                    const interval = setInterval(() => {
                        if (width >= 100) {
                            clearInterval(interval);
                            window.location.href = "Dashboard.html";
                        } else {
                            width += 1;
                            progressBar.style.width = width + '%';
                        }
                    }, 25); // 25ms * 100 steps = 2500ms (2.5 seconds)
                }                

            } catch (error) {
                console.error("Error:", error);
                alert("Error saving: " + error.message);
                submitBtn.innerText = "Add Product"; 
                submitBtn.disabled = false;
            }
        });
    }

    // ================================================
    // --- BULK MODE SETUP ---
    // ================================================
    const urlParams = new URLSearchParams(window.location.search);
    isBulkMode = urlParams.get('mode') === 'bulk';
    
    const bulkBanner     = document.getElementById('bulkModeBanner');
    const singleSubmitBtn = document.getElementById('singleSubmitBtn');
    const nextBtn        = document.getElementById('nextBtn');
    const finalizeBtn    = document.getElementById('finalizeBtn');
    const finalizeBadge  = document.getElementById('finalizeBadge');
    const queueCount     = document.getElementById('queueCount');
    
    if (isBulkMode) {
        bulkBanner.style.display      = 'flex';
        singleSubmitBtn.style.display = 'none';
        nextBtn.style.display         = 'flex';
        finalizeBtn.style.display     = 'flex';
    }
    
    function updateBulkUI() {
        const count = draftProducts.length;
        if (queueCount) queueCount.textContent = count;
        if (finalizeBadge) finalizeBadge.textContent = count;
        if (finalizeBtn) finalizeBtn.disabled = (count === 0);
    }
    
    // --- COLLECT FORM DATA (no upload yet) ---
    async function collectFormDraft() {
        const rawName = document.querySelector('input[placeholder="Enter product name"]').value.trim();
    
        if (!rawName) throw new Error("Product Name is required.");
    
        const priceVal    = parseFloat(document.querySelector('input[type="number"][step="0.01"]').value) || 0;
        const stockVal    = parseInt(document.querySelector('input[placeholder="0"]').value) || 0;
        const thresholdVal = parseInt(document.querySelector('input[placeholder="10"]').value) || 10;
    
        if (priceVal < 0 || stockVal < 0 || thresholdVal < 0)
            throw new Error("Price and Stock values cannot be negative.");
    
        // Duplicate check against already-queued names
        const alreadyQueued = draftProducts.some(p => p.name.toLowerCase() === rawName.toLowerCase());
        if (alreadyQueued) throw new Error(`"${rawName}" is already in your queue.`);
    
        // Duplicate check against Firestore
        const q = query(collection(db, "products"), where("name", "==", rawName));
        const snap = await getDocs(q);
        if (!snap.empty) throw new Error(`Product "${rawName}" already exists in the database.`);
    
        const variations = [];
        document.querySelectorAll('.variations-row').forEach(row => {
            const size   = sanitizeInput(row.querySelector('.var-size').value);
            const color  = sanitizeInput(row.querySelector('.var-color').value);
            const custom = sanitizeInput(row.querySelector('.var-custom').value);
            if (size && color) variations.push({ size, color, custom });
        });
        if (variations.length === 0) throw new Error("Add at least one valid variation.");
    
        const attributes = [];
        document.querySelectorAll('.custom-attr-row').forEach(row => {
            const name  = sanitizeInput(row.querySelector('.attr-name').value);
            const value = sanitizeInput(row.querySelector('.attr-value').value);
            if (name && value) attributes.push({ name, value });
        });
    
        return {
            name:              sanitizeInput(rawName),
            description:       sanitizeInput(document.querySelector('textarea').value),
            category:          document.querySelector('select').value,
            price:             priceVal,
            stock:             stockVal,
            lowStockThreshold: thresholdVal,
            imageFile:         selectedImageFile,          // raw File — uploaded at Finalize
            imagePreviewUrl:   preview.src || null,        // blob URL for preview card
            variations,
            attributes
        };
    }
    
    // --- RESET FORM FOR NEXT PRODUCT ---
    function resetFormForNext() {
        form.reset();
        resetImage();
    
        // Reset variations to one empty row
        if (variationContainer) {
            variationContainer.innerHTML = `
                <div class="variations-row">
                    <div class="input-group"><input type="text" class="var-size" placeholder="Ex: Large" required></div>
                    <div class="input-group"><input type="text" class="var-color" placeholder="Ex: Red" required></div>
                    <div class="input-group"><input type="text" class="var-custom" placeholder="Optional"></div>
                    <button type="button" class="btn-delete remove-row-btn" title="Remove"><i class="fas fa-trash"></i></button>
                </div>`;
            variationContainer.querySelectorAll('input').forEach(inp => applyCharLimit(inp));
        }
    
        // Reset attributes to one empty row
        if (attrContainer) {
            attrContainer.innerHTML = `
                <div class="custom-attr-row">
                    <div class="input-group"><input type="text" class="attr-name" placeholder="Ex: Material"></div>
                    <div class="input-group"><input type="text" class="attr-value" placeholder="Ex: Cotton"></div>
                    <button type="button" class="btn-delete remove-attr-btn" title="Remove"><i class="fas fa-trash"></i></button>
                </div>`;
            attrContainer.querySelectorAll('input').forEach(inp => applyCharLimit(inp));
        }
    
        isFormDirty = false;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    
    // --- NEXT BUTTON ---
    if (nextBtn) {
        nextBtn.addEventListener('click', async () => {
            nextBtn.disabled = true;
            nextBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Validating...';
    
            try {
                const draft = await collectFormDraft();
                draftProducts.push(draft);
                updateBulkUI();
                resetFormForNext();
    
                // Brief success feedback on banner
                bulkBanner.style.background = 'linear-gradient(135deg, #dcfce7, #bbf7d0)';
                bulkBanner.style.borderColor = '#86efac';
                setTimeout(() => {
                    bulkBanner.style.background = '';
                    bulkBanner.style.borderColor = '';
                }, 800);
    
            } catch (err) {
                alert("⚠️ " + err.message);
            } finally {
                nextBtn.disabled = false;
                nextBtn.innerHTML = '<i class="fas fa-arrow-right"></i> Next Product';
            }
        });
    }
    
    // ================================================
    // --- PREVIEW MODAL ---
    // ================================================
    const overlay        = document.getElementById('bulkPreviewOverlay');
    const previewGrid    = document.getElementById('bulkPreviewGrid');
    const previewCountLbl = document.getElementById('previewCountLabel');
    const confirmSaveBtn = document.getElementById('confirmSaveBtn');
    
    function renderPreviewCards() {
        previewGrid.innerHTML = '';
        previewCountLbl.textContent = `${draftProducts.length} product(s) ready to save`;
    
        if (draftProducts.length === 0) {
            previewGrid.innerHTML = `
                <div class="bulk-preview-empty">
                    <i class="fas fa-box-open"></i>
                    <p>No products queued. Go back and add some.</p>
                </div>`;
            confirmSaveBtn.disabled = true;
            return;
        }
    
        confirmSaveBtn.disabled = false;
    
        draftProducts.forEach((product, index) => {
            const card = document.createElement('div');
            card.className = 'preview-card';
            card.dataset.index = index;
    
            const imgHtml = product.imagePreviewUrl && product.imagePreviewUrl !== ''
                ? `<div class="preview-card-img"><img src="${product.imagePreviewUrl}" alt="preview"></div>`
                : `<div class="preview-card-img no-image"><i class="fas fa-image"></i></div>`;
    
            card.innerHTML = `
                ${imgHtml}
                <div class="preview-card-body">
                    <div class="preview-card-name">${product.name}</div>
                    <div class="preview-card-meta"><i class="fas fa-tag" style="width:14px"></i> ${product.category || 'No category'}</div>
                    <div class="preview-card-meta"><i class="fas fa-cubes" style="width:14px"></i> Stock: ${product.stock}</div>
                    <div class="preview-card-meta"><i class="fas fa-layer-group" style="width:14px"></i> ${product.variations.length} variation(s)</div>
                    <div class="preview-card-price">₱${product.price.toFixed(2)}</div>
                </div>
                <button class="btn-remove-card" title="Remove from queue" data-index="${index}">
                    <i class="fas fa-times"></i>
                </button>`;
    
            previewGrid.appendChild(card);
        });
    }
    
    // Open preview
    if (finalizeBtn) {
        finalizeBtn.addEventListener('click', () => {
            renderPreviewCards();
            overlay.style.display = 'flex';
        });
    }
    
    // Close preview
    document.getElementById('closePreviewBtn')?.addEventListener('click', () => {
        overlay.style.display = 'none';
    });
    document.getElementById('backToEditBtn')?.addEventListener('click', () => {
        overlay.style.display = 'none';
    });
    
    // Remove a card from queue
    previewGrid?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-remove-card');
        if (!btn) return;
        const idx = parseInt(btn.dataset.index);
        draftProducts.splice(idx, 1);
        updateBulkUI();
        renderPreviewCards();
    });
    
    // --- CONFIRM SAVE ALL ---
    if (confirmSaveBtn) {
        confirmSaveBtn.addEventListener('click', async () => {
            if (draftProducts.length === 0) return;
    
            confirmSaveBtn.disabled = true;
            confirmSaveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    
            // Add a progress bar
            const footer = document.querySelector('.bulk-preview-footer');
            const progressWrap = document.createElement('div');
            progressWrap.className = 'bulk-progress-bar-wrap';
            const progressBar = document.createElement('div');
            progressBar.className = 'bulk-progress-bar';
            progressWrap.appendChild(progressBar);
            footer.prepend(progressWrap);
    
            let saved = 0;
            const errors = [];
    
            for (const product of draftProducts) {
                try {
                    // 1. Upload image if exists
                    let imageUrl = "";
                    if (product.imageFile) {
                        const storageRef = ref(storage, `products/images/${Date.now()}_${product.imageFile.name}`);
                        const snapshot = await uploadBytes(storageRef, product.imageFile);
                        imageUrl = await getDownloadURL(snapshot.ref);
                    }
    
                    // 2. Save to Firestore
                    const productData = {
                        name:              product.name,
                        description:       product.description,
                        category:          product.category,
                        price:             product.price,
                        stock:             product.stock,
                        lowStockThreshold: product.lowStockThreshold,
                        imageUrl:          imageUrl,
                        createdAt:         serverTimestamp(),
                        createdBy:         auth.currentUser.uid,
                        variations:        product.variations,
                        attributes:        product.attributes
                    };
                    await addDoc(collection(db, "products"), productData);
                    await logActivity("Added Product", product.name);
    
                    saved++;
                    progressBar.style.width = `${(saved / draftProducts.length) * 100}%`;
    
                } catch (err) {
                    errors.push(`${product.name}: ${err.message}`);
                }
            }
    
            isFormDirty = false;
    
            // REPLACE YOUR ALERT BLOCK WITH THIS:
            showBatchResult(saved, errors);
            
            // THE FUNCTION:
            function showBatchResult(savedCount, errorsArray) {
                const modal = document.getElementById('successModal');
                const modalTitle = document.getElementById('modalTitle');
                const modalMessage = document.getElementById('modalMessage');
                const modalIcon = document.getElementById('modalIcon');
                const errorLog = document.getElementById('errorLog');
                const errorList = document.getElementById('errorList');
                const progressBar = document.getElementById('redirectProgress');
            
                modal.style.display = 'flex';
                errorList.innerHTML = ""; // Clear old errors
            
                if (errorsArray.length > 0) {
                    // CASE: Partial Success / Errors
                    modalTitle.innerText = "Batch Completed with Issues";
                    modalIcon.innerHTML = '<i class="fas fa-exclamation-triangle warning-icon"></i>';
                    modalMessage.innerText = `Saved ${savedCount} product(s), but ${errorsArray.length} failed.`;
                    
                    errorLog.style.display = 'block';
                    errorsArray.forEach(err => {
                        const li = document.createElement('li');
                        li.innerText = err;
                        errorList.appendChild(li);
                    });
                } else {
                    // CASE: Perfect Success
                    modalTitle.innerText = "Success!";
                    modalIcon.innerHTML = '<i class="fas fa-check-circle"></i>';
                    modalMessage.innerText = `All ${savedCount} products have been saved successfully.`;
                    errorLog.style.display = 'none';
                }
            
                // Redirect Logic
                let width = 0;
                const duration = errorsArray.length > 0 ? 5000 : 2500; // Give them 5s to read errors, 2.5s for success
                const stepTime = duration / 100;
            
                const interval = setInterval(() => {
                    width++;
                    progressBar.style.width = width + '%';
                    if (width >= 100) {
                        clearInterval(interval);
                        window.location.href = "Dashboard.html";
                    }
                }, stepTime);
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