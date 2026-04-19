import { 
    collection, addDoc, setDoc, serverTimestamp, 
    query, where, getDocs, doc, getDoc 
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import { initLogoutModal } from "./logout-modal.js";
import { db, auth, storage } from "./firebase.js";


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
        window.location.href = "index.html";
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
    displayUserName(user.uid);
    loadDefaultThreshold();
    main.style.visibility = 'visible';

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
});

async function checkAdminRole(uid) {
    const userData = await getCachedUserData(uid);
    return userData?.role?.toLowerCase() === 'admin';
}

async function displayUserName(uid) {
    const nameEl = document.getElementById('userNameDisplay');
    if (!nameEl) return;

    const userData = await getCachedUserData(uid);
    const name = userData?.name || "User";
    const role = userData?.role
        ? ` (${userData.role.charAt(0).toUpperCase() + userData.role.slice(1)})`
        : "";

    nameEl.innerHTML = `${name}<span style="font-size:11px; color:#00FFFF; font-weight:600; opacity:0.7;">${role}</span>`;
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
    
            if (file.size > 10000000) { // 10MB limit for raw file size
                alert("File is too large! Please select an image under 10mb.");
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
            console.log('form submit fired, isBulkMode:', isBulkMode); // ✅ ADD

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
                    submitBtn.innerText = "Optimizing Image...";
                
                    const resizedImage = await resizeImage(selectedImageFile, 500); 
                
                    submitBtn.innerText = "Uploading Image...";
                
                    const storageRef = ref(storage, `products/images/${Date.now()}_${selectedImageFile.name}`);
                    const snapshot = await uploadBytes(storageRef, resizedImage); 
                    imageUrl = await getDownloadURL(snapshot.ref);
                }         
                
                // --- Harvest Variations FIRST ---
                const variations = [];
                document.querySelectorAll('.variations-row').forEach(row => {
                    const size = sanitizeInput(row.querySelector('.var-size').value);
                    const color = sanitizeInput(row.querySelector('.var-color').value);
                    const custom = sanitizeInput(row.querySelector('.var-custom').value);
                
                    if (size && color) {
                        variations.push({ size, color, custom });
                    }
                });
                
                if (variations.length === 0) {
                    throw new Error("Please add at least one valid Product Variation.");
                }
                
                // --- Harvest Attributes ---
                const attributes = [];
                document.querySelectorAll('.custom-attr-row').forEach(row => {
                    const name = sanitizeInput(row.querySelector('.attr-name').value);
                    const value = sanitizeInput(row.querySelector('.attr-value').value);
                
                    if (name && value) {
                        attributes.push({ name, value });
                    }
                });

                const productData = {
                    name: sanitizeInput(rawName), 
                    description: sanitizeInput(rawDesc), 
                    category: document.getElementById('categorySelect').value, 
                    price: priceVal, 
                    stock: stockVal,
                    lowStockThreshold: thresholdVal,
                    imageUrl: imageUrl,
                    createdAt: serverTimestamp(),
                    createdBy: auth.currentUser.uid,
                
                    archived: false,
                    archivedAt: null,
                
                    variations: variations,
                    attributes: attributes
                };

                

                if (productData.variations.length === 0) {
                    throw new Error("Please add at least one valid Product Variation.");
                }

                // 1. SAVE PRODUCT
                const manualId = document.getElementById('productIdInput').value.trim();
                if (!manualId) throw new Error("Product ID is required.");
                
                // Check if ID already exists in Firestore
                const idCheckSnap = await getDoc(doc(db, "products", manualId));
                if (idCheckSnap.exists()) throw new Error(`Product ID "${manualId}" is already in use.`);
                
                await setDoc(doc(db, "products", manualId), productData);
                
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
                            sessionStorage.removeItem('products_cache');
                            window.location.href = "Products.html";
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

    async function resizeImage(file, maxWidth = 500) {
        return new Promise((resolve) => {
            const img = new Image();
            const reader = new FileReader();
    
            reader.onload = e => {
                img.src = e.target.result;
            };
    
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scale = maxWidth / img.width;
    
                canvas.width = maxWidth;
                canvas.height = img.height * scale;
    
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    
                canvas.toBlob(blob => {
                    resolve(blob);
                }, 'image/jpeg', 0.7); // compress to 70%
            };
    
            reader.readAsDataURL(file);
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
    const saveEditBtn = document.getElementById('saveEditBtn');
    

    
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
    
        const priceVal     = parseFloat(document.querySelector('input[type="number"][step="0.01"]').value) || 0;
        const stockVal     = parseInt(document.querySelector('input[placeholder="0"]').value) || 0;
        const thresholdVal = parseInt(document.querySelector('input[placeholder="10"]').value) || 10;
        const manualId = document.getElementById('productIdInput').value.trim();
        if (!manualId) throw new Error("Product ID is required.");

        // Only check Firestore if not currently re-editing the same product
        const idCheckSnap = await getDoc(doc(db, "products", manualId));
        if (idCheckSnap.exists()) throw new Error(`Product ID "${manualId}" is already in use.`);
        
        // Check queue but skip if this ID was just removed for editing
        const alreadyQueuedId = draftProducts.some(p => p.productId === manualId);
        if (alreadyQueuedId) throw new Error(`Product ID "${manualId}" is already in your queue.`);

    
        if (priceVal < 0 || stockVal < 0 || thresholdVal < 0)
            throw new Error("Price and Stock values cannot be negative.");
    
        // ✅ Category validation — outside the loop, before the return
        const categoryVal = document.getElementById('categorySelect').value;
        if (!categoryVal) throw new Error("Please select a category.");
    
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
            productId:         manualId,
            name:              sanitizeInput(rawName),
            description:       sanitizeInput(document.querySelector('textarea').value),
            category:          categoryVal,  
            price:             priceVal,
            stock:             stockVal,
            lowStockThreshold: thresholdVal,
            imageFile:         selectedImageFile,
            imagePreviewUrl:   preview.src || null,
            variations,
            attributes
        };
    }
    
    // --- RESET FORM FOR NEXT PRODUCT ---
    function resetFormForNext() {
        form.reset();
        document.getElementById('productIdInput').value = '';
        resetImage();
        loadCategories();
        
    
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

    if (saveEditBtn) {
        saveEditBtn.addEventListener('click', async () => {
            console.log('saveEditBtn fired, stack:', new Error().stack); // ✅ ADD
            console.log('saveEditBtn clicked, queue before push:', draftProducts.map(p => p.name)); // ✅ ADD
            saveEditBtn.disabled = true;
            saveEditBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    
            try {
                const draft = await collectFormDraft();
                draftProducts.push(draft);
                updateBulkUI();
                resetFormForNext();
    
                // Restore normal bulk UI
                nextBtn.style.display = 'flex';
                saveEditBtn.style.display = 'none';
                bulkBanner.querySelector('.bulk-banner-text').textContent = 
                    `Bulk Mode — ${draftProducts.length} product(s) in queue`;
    
                /* Re-open the preview so they can continue
                renderPreviewCards();
                setTimeout(() => {
                    overlay.style.display = 'flex'; // ✅ delay prevents click bleed-through
                }, 100);*/
    
            } catch (err) {
                alert("⚠️ " + err.message);
            } finally {
                saveEditBtn.disabled = false;
                saveEditBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
            }
        });
    }
    
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
                </button>
                <button class="btn-edit-card" title="Edit this product" data-index="${index}">
                    <i class="fas fa-pen"></i>
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
        const removeBtnCard = e.target.closest('.btn-remove-card');
        if (removeBtnCard) {
            const idx = parseInt(removeBtnCard.dataset.index);
            draftProducts.splice(idx, 1);
            updateBulkUI();
            renderPreviewCards();
            return;
        }
    
        const editBtn = e.target.closest('.btn-edit-card');
        if (!editBtn) return;
        
        const idx = parseInt(editBtn.dataset.index);
        if (idx < 0 || idx >= draftProducts.length) return;
        
        const product = { ...draftProducts[idx] }; 
        draftProducts.splice(idx, 1);              
        updateBulkUI();
        console.log('After splice, queue length:', draftProducts.length); // ✅ ADD
        console.log('Queue contents:', draftProducts.map(p => p.name));   // ✅ ADD
        
        overlay.style.display = 'none';
    
        // Populate form fields
        document.querySelector('input[placeholder="Enter product name"]').value = product.name;
        document.querySelector('textarea').value = product.description || '';
        document.querySelector('input[type="number"][step="0.01"]').value = product.price;
        document.querySelector('input[placeholder="0"]').value = product.stock;
        document.querySelector('input[placeholder="10"]').value = product.lowStockThreshold;
        document.getElementById('productIdInput').value = product.productId || '';
    
        // Wait for category options to be ready before setting value
        const categorySelect = document.getElementById('categorySelect');
        const setCategoryWhenReady = () => {
            if (categorySelect.options.length > 1) {
                categorySelect.value = product.category;
            } else {
                setTimeout(setCategoryWhenReady, 50);
            }
        };
        setCategoryWhenReady();
    
        // Restore image preview if it existed
        if (product.imagePreviewUrl) {
            preview.src = product.imagePreviewUrl;
            preview.style.display = 'block';
            placeholder.style.display = 'none';
            removeBtn.style.display = 'flex';
            selectedImageFile = product.imageFile || null;
        } else {
            resetImage();
        }
    
        // Restore variations — always reset container first
        if (variationContainer) {
            if (product.variations && product.variations.length > 0) {
                variationContainer.innerHTML = product.variations.map(v => `
                    <div class="variations-row">
                        <div class="input-group"><input type="text" class="var-size" placeholder="Ex: Large" value="${v.size}" required></div>
                        <div class="input-group"><input type="text" class="var-color" placeholder="Ex: Red" value="${v.color}" required></div>
                        <div class="input-group"><input type="text" class="var-custom" placeholder="Optional" value="${v.custom || ''}"></div>
                        <button type="button" class="btn-delete remove-row-btn"><i class="fas fa-trash"></i></button>
                    </div>`).join('');
            } else {
                variationContainer.innerHTML = `
                    <div class="variations-row">
                        <div class="input-group"><input type="text" class="var-size" placeholder="Ex: Large" required></div>
                        <div class="input-group"><input type="text" class="var-color" placeholder="Ex: Red" required></div>
                        <div class="input-group"><input type="text" class="var-custom" placeholder="Optional"></div>
                        <button type="button" class="btn-delete remove-row-btn"><i class="fas fa-trash"></i></button>
                    </div>`;
            }
            variationContainer.querySelectorAll('input').forEach(inp => applyCharLimit(inp));
        }
    
        // Restore attributes — always reset container first
        if (attrContainer) {
            if (product.attributes && product.attributes.length > 0) {
                attrContainer.innerHTML = product.attributes.map(a => `
                    <div class="custom-attr-row">
                        <div class="input-group"><input type="text" class="attr-name" placeholder="Ex: Material" value="${a.name}"></div>
                        <div class="input-group"><input type="text" class="attr-value" placeholder="Ex: Cotton" value="${a.value}"></div>
                        <button type="button" class="btn-delete remove-attr-btn"><i class="fas fa-trash"></i></button>
                    </div>`).join('');
            } else {
                attrContainer.innerHTML = `
                    <div class="custom-attr-row">
                        <div class="input-group"><input type="text" class="attr-name" placeholder="Ex: Material"></div>
                        <div class="input-group"><input type="text" class="attr-value" placeholder="Ex: Cotton"></div>
                        <button type="button" class="btn-delete remove-attr-btn"><i class="fas fa-trash"></i></button>
                    </div>`;
            }
            attrContainer.querySelectorAll('input').forEach(inp => applyCharLimit(inp));
        }
    
    
        // Show "Save Changes" button, hide "Next Product"
        nextBtn.style.display = 'none';
        saveEditBtn.style.display = 'flex';
        bulkBanner.querySelector('.bulk-banner-text').textContent = `Editing: ${product.name}`;
    
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    
    // --- CONFIRM SAVE ALL ---
    if (confirmSaveBtn) {
        confirmSaveBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
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
                        const resizedImage = await resizeImage(product.imageFile, 500); 
                    
                        const storageRef = ref(storage, `products/images/${Date.now()}_${product.imageFile.name}`);
                        const snapshot = await uploadBytes(storageRef, resizedImage); 
                        imageUrl = await getDownloadURL(snapshot.ref);
                    }
    
                    // 2. Save to Firestore
                    const productData = {
                        name: product.name,
                        description: product.description,
                        category: product.category,
                        price: product.price,
                        stock: product.stock,
                        lowStockThreshold: product.lowStockThreshold,
                        imageUrl: imageUrl,
                        createdAt: serverTimestamp(),
                        createdBy: auth.currentUser.uid,
                    
                        archived: false,
                        archivedAt: null,
                    
                        variations: product.variations,
                        attributes: product.attributes
                    };
                    await setDoc(doc(db, "products", product.productId), productData);
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
                        sessionStorage.removeItem('products_cache');
                        window.location.href = "Products.html";
                    }
                }, stepTime);
            }
    
            
        });
    }    
});


function sanitizeInput(str) {
    if (!str) return "";
    if (typeof str !== 'string') return String(str);
    const div = document.createElement('div');
    div.innerText = str;
    return div.innerHTML;
}

function preventNegatives(input) {
    input.addEventListener('input', function() {
        if (this.value < 0) this.value = 0;
    });
}

function applyCharLimit(input) {
    if (!input) return;
    input.setAttribute("maxlength", "30");
    input.addEventListener("input", function() {
        this.style.borderColor  = this.value.length >= 30 ? "red" : "";
        this.style.outlineColor = this.value.length >= 30 ? "red" : "";
    });
}


export { getCachedUserData, checkAdminRole, sanitizeInput, logActivity, loadCategories, loadDefaultThreshold };