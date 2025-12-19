// ==========================================
// 1. IMPORTS (Standard NPM)
// ==========================================
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { 
    getFirestore, doc, getDoc, updateDoc, collection, 
    query, where, getDocs, addDoc, serverTimestamp 
} from "firebase/firestore";

// ==========================================
// 2. CONFIGURATION
// ==========================================
export const firebaseConfig = {
    apiKey: "AIzaSyBeaF2VKovHASuzhvZHzOoE0yB7QnBDej0",
    authDomain: "inventory-management-sys-baccc.firebaseapp.com",
    projectId: "inventory-management-sys-baccc",
    storageBucket: "inventory-management-sys-baccc.firebasestorage.app",
    messagingSenderId: "304433839568",
    appId: "1:304433839568:web:50dafae1296e6bb0d30dd5",
    measurementId: "G-68CR9JCJV8"
};

let app, db, auth;
try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
} catch (e) {
    // Suppress errors if running in a test environment
}

// Global State
let currentBase64Image = "";
let isFormDirty = false;

// ==========================================
// 3. EXPORTED LOGIC (Tested Functions)
// ==========================================

export function sanitizeInput(str) {
    if (!str) return "";
    if (typeof str !== 'string') return String(str);
    return str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function checkAdminRole(uid, dbInstance = db) {
    try {
        const userSnap = await getDoc(doc(dbInstance, "users", uid));
        if (userSnap.exists()) {
            const role = userSnap.data().role;
            return role && role.toLowerCase() === 'admin';
        }
        return false;
    } catch (e) { return false; }
}

/**
 * Core Logic for Updating Product
 * Separated from DOM to allow Unit Testing
 */
export async function updateProductLogic(productId, formData, dbInstance, authInstance) {
    // 1. Validation
    const price = parseFloat(formData.price) || 0;
    const stock = parseInt(formData.stock) || 0;
    
    if (price < 0 || stock < 0) {
        throw new Error("Price and Stock values cannot be negative.");
    }

    // 2. Duplicate Check (Exclude current product ID)
    const q = query(collection(dbInstance, "products"), where("name", "==", formData.name));
    const snap = await getDocs(q);
    let isDuplicate = false;
    
    if (!snap.empty) {
        snap.forEach(d => {
            if (d.id !== productId) isDuplicate = true;
        });
    }

    if (isDuplicate) {
        throw new Error(`Product name "${formData.name}" already exists!`);
    }

    // 3. Construct Data
    const updatedData = {
        name: sanitizeInput(formData.name),
        description: sanitizeInput(formData.description),
        category: formData.category,
        price: price,
        stock: stock,
        lowStockThreshold: parseInt(formData.lowStockThreshold) || 10,
        imageUrl: formData.imageUrl,
        variations: formData.variations || [],
        attributes: formData.attributes || []
    };

    // 4. Update Firestore
    await updateDoc(doc(dbInstance, "products", productId), updatedData);

    // 5. Log Activity
    const userEmail = (authInstance && authInstance.currentUser) ? authInstance.currentUser.email : "Admin";
    await addDoc(collection(dbInstance, "activities"), {
        action: "Updated Product",
        target: updatedData.name,
        user: userEmail,
        timestamp: serverTimestamp()
    });

    return updatedData;
}

// ==========================================
// 4. BROWSER ONLY LOGIC
// ==========================================
if (typeof window !== 'undefined') {

    // --- Auth Listener ---
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            const isAdmin = await checkAdminRole(user.uid, db);
            if (!isAdmin) {
                alert("Access Denied: Only Admins can edit products.");
                window.location.href = "Products.html";
            } else {
                initPage(); 
            }
        } else {
            window.location.href = "Login.html";
        }
    });

    // --- DOM Loaded ---
    function initPage() { 
        const urlParams = new URLSearchParams(window.location.search);
        const productId = urlParams.get('id');

        if (!productId) {
            alert("No Product ID specified.");
            window.location.href = "Products.html";
            return;
        }

        // 1. Data Loss Prevention
        const form = document.getElementById('editProductForm');
        if (form) {
            form.addEventListener('input', () => isFormDirty = true);
            form.addEventListener('change', () => isFormDirty = true);
        }
        window.addEventListener('beforeunload', (e) => {
            if (isFormDirty) { e.preventDefault(); e.returnValue = ''; }
        });

        // Input Limits
        const nameInput = document.getElementById('inpName');
        if(nameInput) {
            nameInput.setAttribute("maxlength", "30");
            nameInput.addEventListener("input", function() {
                this.style.borderColor = (this.value.length >= 30) ? "red" : "";
            });
        }
        document.querySelectorAll('input[type="number"]').forEach(inp => {
            inp.addEventListener('input', function() { if (this.value < 0) this.value = 0; });
        });

        // 2. Image Logic
        setupImageUpload();

        // 3. Fetch Existing Data
        fetchProductData(productId);

        // 4. Dynamic Rows
        setupDynamicRows();

        // 5. Submit Handler
        const submitBtn = document.querySelector('.btn-submit');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                submitBtn.innerText = "Updating...";
                submitBtn.disabled = true;

                try {
                    // Gather Data from DOM
                    const priceVal = parseFloat(document.getElementById('inpPrice').value) || 0;
                    
                    // UI Confirmation (kept in browser logic)
                    if (priceVal === 0) {
                        const confirmZero = confirm("⚠️ Warning: Price is 0.00. Is this correct?");
                        if (!confirmZero) {
                            submitBtn.innerText = "Save Changes"; 
                            submitBtn.disabled = false;
                            return; 
                        }
                    }

                    // Harvest Variations
                    const variations = [];
                    document.querySelectorAll('.variations-row').forEach(row => {
                        const size = sanitizeInput(row.querySelector('.var-size').value);
                        const color = sanitizeInput(row.querySelector('.var-color').value);
                        const custom = sanitizeInput(row.querySelector('.var-custom').value);
                        if(size && color) variations.push({ size, color, custom });
                    });

                    if (variations.length === 0) throw new Error("Please add at least one valid Product Variation.");

                    // Harvest Attributes
                    const attributes = [];
                    document.querySelectorAll('.custom-attr-row').forEach(row => {
                        const name = sanitizeInput(row.querySelector('.attr-name').value);
                        const value = sanitizeInput(row.querySelector('.attr-value').value);
                        if(name && value) attributes.push({ name, value });
                    });

                    // Build Object
                    const formData = {
                        name: document.getElementById('inpName').value.trim(),
                        description: document.getElementById('inpDesc').value,
                        category: document.getElementById('inpCategory').value,
                        price: document.getElementById('inpPrice').value,
                        stock: document.getElementById('inpStock').value,
                        lowStockThreshold: document.getElementById('inpLowStock').value,
                        imageUrl: currentBase64Image,
                        variations: variations,
                        attributes: attributes
                    };

                    // CALL EXPORTED LOGIC
                    await updateProductLogic(productId, formData, db, auth);

                    isFormDirty = false;
                    alert("Product Updated!");
                    window.location.href = "Products.html";

                } catch (error) {
                    console.error("Error updating:", error);
                    alert("Error updating product: " + error.message);
                    submitBtn.innerText = "Save Changes";
                    submitBtn.disabled = false;
                }
            });
        }
    }

    // --- HELPER FUNCTIONS (Browser Specific) ---

    async function fetchProductData(productId) {
        try {
            const docSnap = await getDoc(doc(db, "products", productId));
            if (docSnap.exists()) {
                const data = docSnap.data();
                
                document.getElementById('inpName').value = data.name || "";
                document.getElementById('inpDesc').value = data.description || "";
                document.getElementById('inpCategory').value = data.category || "";
                document.getElementById('inpPrice').value = data.price || "";
                document.getElementById('inpStock').value = data.stock || "";
                document.getElementById('inpLowStock').value = data.lowStockThreshold || 10;

                if (data.imageUrl) {
                    currentBase64Image = data.imageUrl; 
                    const preview = document.getElementById('imagePreview');
                    preview.src = data.imageUrl;
                    preview.style.display = "block";
                    document.getElementById('uploadPlaceholder').style.display = "none";
                    document.querySelector('.btn-remove-image').style.display = "flex"; 
                }

                // Populate Rows
                if (data.variations?.length > 0) {
                    data.variations.forEach(v => addVariationRow(v.size, v.color, v.custom));
                } else {
                    addVariationRow();
                }

                if (data.attributes?.length > 0) {
                    data.attributes.forEach(a => addAttributeRow(a.name, a.value));
                }

            } else {
                alert("Product not found!");
                window.location.href = "Products.html";
            }
        } catch (e) { console.error("Error fetching product:", e); }
    }

    function setupImageUpload() {
        const fileInput = document.getElementById('fileInput');
        const preview = document.getElementById('imagePreview');
        const placeholder = document.getElementById('uploadPlaceholder');
        const uploadBox = document.querySelector('.image-upload-box');

        if (!fileInput || !uploadBox) return;

        const removeBtn = document.createElement('button');
        removeBtn.innerHTML = '<i class="fas fa-times"></i>';
        removeBtn.className = 'btn-remove-image';
        removeBtn.type = 'button';
        removeBtn.style.display = 'none'; 
        uploadBox.appendChild(removeBtn);

        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.value = "";
            currentBase64Image = "";
            preview.src = "";
            preview.style.display = "none";
            placeholder.style.display = "block";
            removeBtn.style.display = "none";
            isFormDirty = true;
        });

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 750000) { alert("File too large (>750KB)"); fileInput.value = ""; return; }
            
            const reader = new FileReader();
            reader.onloadend = function() {
                currentBase64Image = reader.result; 
                preview.src = reader.result;
                preview.style.display = "block";
                placeholder.style.display = "none";
                removeBtn.style.display = "flex";
                isFormDirty = true;
            }
            reader.readAsDataURL(file);
        });
    }

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
        
        // Add limit listeners
        row.querySelectorAll('input').forEach(inp => {
            inp.addEventListener("input", function() { this.style.borderColor = (this.value.length >= 30) ? "red" : ""; });
        });
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
        
        row.querySelectorAll('input').forEach(inp => {
            inp.addEventListener("input", function() { this.style.borderColor = (this.value.length >= 30) ? "red" : ""; });
        });
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

    window.logout = function() {
        sessionStorage.clear();
        signOut(auth).then(() => window.location.replace("Login.html"));
    };
}