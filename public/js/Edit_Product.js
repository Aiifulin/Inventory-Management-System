import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
// FIXED: Added addDoc, serverTimestamp, doc, getDoc for role check
import { getFirestore, doc, getDoc, updateDoc, collection, getDocs, query, where, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { initLogoutModal } from "./logout-modal.js";

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

// REMOVED HARDCODED ADMIN UID
let currentBase64Image = "";
let isFormDirty = false;

// ================================================
// 🔥 CACHED USER DATA HELPER
// ================================================
async function getCachedUserData(uid) {
    const CACHE_KEY = `user_data_${uid}`;

    // 1. Check sessionStorage first
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) return JSON.parse(cached);

    // 2. Fetch from Firestore if not cached
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

async function checkAdminRole(uid) {
    const userData = await getCachedUserData(uid);
    return userData?.role?.toLowerCase() === 'admin';
}

// --- AUTH CHECK WITH ROLE VALIDATION ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // 1. Fetch User Role from 'users' collection
        const userData = await getCachedUserData(user.uid);
        const isAdmin = userData?.role?.toLowerCase() === 'admin';

        if (!isAdmin) {
            alert("Access Denied: Only Admins can edit products.");
            window.location.href = "Products.html";
        } else {
            // Only load page logic if admin is verified
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



// --- HELPER: ACTIVITY LOGGING FUNCTION ---
async function logActivity(action, targetName) {
    try {
        const userEmail = auth.currentUser ? auth.currentUser.email : "Admin"; 
        
        await addDoc(collection(db, "activities"), {
            action: action,          // e.g., "Updated Product"
            target: targetName,      // e.g., "Gaming Chair"
            user: userEmail,         
            timestamp: serverTimestamp()
        });
        console.log("Activity logged successfully");
    } catch (e) {
        console.error("Error logging activity", e);
    }
}

// --- INPUT HELPERS ---
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

function initPage() { 
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');

    if (!productId) {
        alert("No Product ID specified.");
        window.location.href = "Products.html";
        return;
    }

    // --- 1. DATA LOSS PREVENTION ---
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
    document.querySelectorAll('input[type="number"]').forEach(inp => preventNegatives(inp));

    // --- 2. IMAGE UPLOAD & REMOVE LOGIC ---
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
    removeBtn.style.display = 'none'; // Hidden by default

    if(uploadBox) uploadBox.appendChild(removeBtn);
    removeBtn.addEventListener('click', resetImage);

    // --- IMAGE CLICK TO PREVIEW ---
    const imgPreviewOverlay = document.getElementById('imgPreviewOverlay');
    const imgPreviewFull    = document.getElementById('imgPreviewFull');
    const imgPreviewClose   = document.getElementById('imgPreviewClose');
    
    // Click the preview image to open fullscreen
    if (preview) {
        preview.style.cursor = 'zoom-in';
        preview.addEventListener('click', (e) => {
            e.stopPropagation(); // Don't trigger the upload box click
            if (!preview.src || preview.style.display === 'none') return;
            imgPreviewFull.src = preview.src;
            imgPreviewOverlay.style.display = 'flex';
        });
    }
    
    // Close on X button or backdrop click
    imgPreviewClose?.addEventListener('click', () => {
        imgPreviewOverlay.style.display = 'none';
    });
    imgPreviewOverlay?.addEventListener('click', (e) => {
        if (e.target === imgPreviewOverlay) {
            imgPreviewOverlay.style.display = 'none';
        }
    });
    
    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && imgPreviewOverlay.style.display === 'flex') {
            imgPreviewOverlay.style.display = 'none';
        }
    });

    function resetImage(e) {
        if(e) e.stopPropagation();
        fileInput.value = "";
        currentBase64Image = "";
        preview.src = "";
        preview.style.display = "none";
        placeholder.style.display = "block";
        removeBtn.style.display = "none";
        isFormDirty = true;
    }

    if (uploadBox) {
        uploadBox.addEventListener('click', (e) => {
            // Don't open file picker if they clicked the preview image or remove button
            if (e.target === preview || e.target === removeBtn || removeBtn.contains(e.target)) return;
            fileInput.click();
        });
    }

    if(fileInput) {
        fileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 750000) {
                alert("File is too large! Please select an image under 750KB.");
                fileInput.value = "";
                return;
            }
            const reader = new FileReader();
            reader.onloadend = function() {
                currentBase64Image = reader.result; 
                preview.src = reader.result;
                preview.style.display = "block";
                placeholder.style.display = "none";
                removeBtn.style.display = "flex"; // Show button
                isFormDirty = true;
            }
            reader.readAsDataURL(file);
        });
    }

    // --- FETCH DATA ---
    (async () => { 
        try {
            const docRef = doc(db, "products", productId);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                
                document.getElementById('inpName').value = data.name || "";
                document.getElementById('inpDesc').value = data.description || "";
                document.getElementById('inpCategory').value = data.category || "";
                document.getElementById('inpPrice').value = data.price || "";
                document.getElementById('inpStock').value = data.stock || "";
                document.getElementById('inpLowStock').value = data.lowStockThreshold || 10;

                // Load existing image
                if (data.imageUrl) {
                    currentBase64Image = data.imageUrl; 
                    preview.src = data.imageUrl;
                    preview.style.display = "block";
                    placeholder.style.display = "none";
                    removeBtn.style.display = "flex"; 
                } else {
                    removeBtn.style.display = "none"; 
                }

                // Populate Variations
                if (data.variations && data.variations.length > 0) {
                    data.variations.forEach(v => addVariationRow(v.size, v.color, v.custom));
                } else {
                    addVariationRow(); // Add empty row if none exist
                }

                // Populate Attributes
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

    // --- 4. SAVE LOGIC WITH LOGGING ---
    const submitBtn = document.querySelector('.btn-submit');

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            submitBtn.innerText = "Updating...";
            submitBtn.disabled = true;

            try {
                const priceVal = parseFloat(document.getElementById('inpPrice').value) || 0;
                const stockVal = parseInt(document.getElementById('inpStock').value) || 0;
                const thresholdVal = parseInt(document.getElementById('inpLowStock').value) || 10;

                // VALIDATION 1: Check Negatives
                if (priceVal < 0 || stockVal < 0 || thresholdVal < 0) {
                    throw new Error("Price and Stock values cannot be negative.");
                }

                // VALIDATION 2 (NEW): Check for 0 Price
                if (priceVal === 0) {
                    const confirmZero = confirm("⚠️ Warning: You are setting the Price to 0.00.\n\nAre you sure this product is free?");
                    if (!confirmZero) {
                        // User cancelled
                        submitBtn.innerText = "Save Changes"; 
                        submitBtn.disabled = false;
                        return; // Stop execution here
                    }
                }

                const rawName = document.getElementById('inpName').value.trim();
                const rawDesc = document.getElementById('inpDesc').value;

                // Duplicate Check
                const q = query(collection(db, "products"), where("name", "==", rawName));
                const querySnapshot = await getDocs(q);
                
                let isDuplicate = false;
                if (!querySnapshot.empty) {
                    querySnapshot.forEach(d => {
                        if (d.id !== productId) isDuplicate = true; 
                    });
                }
                
                if (!isDuplicate) {
                    const allDocs = await getDocs(collection(db, "products"));
                    allDocs.forEach(d => {
                        if (d.id !== productId && d.data().name.toLowerCase() === rawName.toLowerCase()) {
                            isDuplicate = true;
                        }
                    });
                }

                if (isDuplicate) {
                    throw new Error(`Product name "${rawName}" already exists!`);
                }

                const variations = [];
                document.querySelectorAll('.variations-row').forEach(row => {
                    const size = sanitizeInput(row.querySelector('.var-size').value);
                    const color = sanitizeInput(row.querySelector('.var-color').value);
                    const custom = sanitizeInput(row.querySelector('.var-custom').value);
                    if(size && color) variations.push({ size, color, custom });
                });

                const attributes = [];
                document.querySelectorAll('.custom-attr-row').forEach(row => {
                    const name = sanitizeInput(row.querySelector('.attr-name').value);
                    const value = sanitizeInput(row.querySelector('.attr-value').value);
                    if(name && value) attributes.push({ name, value });
                });

                if (variations.length === 0) {
                    throw new Error("Please add at least one valid Product Variation.");
                }

                const updatedData = {
                    name: sanitizeInput(rawName), 
                    description: sanitizeInput(rawDesc),
                    category: document.getElementById('inpCategory').value,
                    price: priceVal,
                    stock: stockVal,
                    lowStockThreshold: thresholdVal,
                    imageUrl: currentBase64Image, 
                    variations: variations,
                    attributes: attributes
                };

                // 1. UPDATE PRODUCT
                await updateDoc(doc(db, "products", productId), updatedData);
                
                // 2. LOG ACTIVITY
                await logActivity("Updated Product", updatedData.name);

                isFormDirty = false;
                showSuccessModal(updatedData.name);

            } catch (error) {
                console.error("Error updating:", error);
                alert("Error updating product: " + error.message);
                submitBtn.innerText = "Save Changes";
                submitBtn.disabled = false;
            }
        });
    }
}

// --- HELPER FUNCTIONS ---
function addVariationRow(size="", color="", custom="") {
    const container = document.getElementById("variation-container");
    const row = document.createElement("div");
    row.className = "variations-row";
    
    row.innerHTML = `
        <div class="input-group"><input type="text" class="var-size" placeholder="Ex: Large" required maxlength="30"></div>
        <div class="input-group"><input type="text" class="var-color" placeholder="Ex: Red" required maxlength="30"></div>
        <div class="input-group"><input type="text" class="var-custom" placeholder="Optional" maxlength="30"></div>
        <button type="button" class="btn-delete remove-row-btn"><i class="fas fa-trash"></i></button>
    `;
    
    row.querySelector('.var-size').value = size || "";
    row.querySelector('.var-color').value = color || "";
    row.querySelector('.var-custom').value = custom || "";

    row.querySelectorAll('input').forEach(inp => applyCharLimit(inp));
    
    container.appendChild(row);
}

function addAttributeRow(name="", value="") {
    const container = document.getElementById("custom-attributes-container");
    const row = document.createElement("div");
    row.className = "custom-attr-row";
    row.innerHTML = `
        <div class="input-group"><input type="text" class="attr-name" placeholder="Name" maxlength="30"></div>
        <div class="input-group"><input type="text" class="attr-value" placeholder="Value" maxlength="30"></div>
        <button type="button" class="btn-delete remove-attr-btn"><i class="fas fa-trash"></i></button>
    `;
    
    row.querySelector('.attr-name').value = name || "";
    row.querySelector('.attr-value').value = value || "";

    row.querySelectorAll('input').forEach(inp => applyCharLimit(inp));
    
    container.appendChild(row);
}

function setupDynamicRows() {
    const addVarBtn = document.getElementById("add-main-variation-btn");
    const addAttrBtn = document.getElementById("add-custom-attr-main-btn");

    if (addVarBtn) addVarBtn.addEventListener("click", () => addVariationRow());
    if (addAttrBtn) addAttrBtn.addEventListener("click", () => addAttributeRow());

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


// --- LOAD CATEGORIES FOR SELECT ---
async function loadCategories() {
    const categorySelect = document.getElementById("inpCategory");
    if (!categorySelect) return;

    // Clear existing options except the first placeholder
    categorySelect.innerHTML = `<option value="" disabled selected>Select Category</option>`;

    try {
        const snapshot = await getDocs(collection(db, "categories"));
        snapshot.forEach(docSnap => {
            const category = docSnap.data();
            if (category.archived !== true) { // skip archived categories
                const option = document.createElement("option");
                option.value = category.name;
                option.textContent = category.name;
                categorySelect.appendChild(option);
            }
        });
    } catch (err) {
        console.error("Error loading categories:", err);
    }
}

// --- SUCCESS MODAL ---
function showSuccessModal(productName) {
    const modal = document.getElementById('successModal');
    const label = document.getElementById('successProductName');

    if (label) label.textContent = `"${productName}" has been updated.`;
    if (modal) modal.style.display = 'flex';

    setTimeout(() => {
        window.location.href = "Products.html";
    }, 2000);
}

// Run on page load
document.addEventListener("DOMContentLoaded", loadCategories);

