import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
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

const ADMIN_UID = "eisTKTAY9LfdMpXZ7ebo0spRDAN2";
let currentBase64Image = "";

onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = "Login.html";
    } else if (user.uid !== ADMIN_UID) {
        alert("Access Denied: Only Admin can edit products.");
        window.location.href = "Products.html";
    } else {
        initPage(); 
    }
});

function initPage() { 
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');

    if (!productId) {
        alert("No Product ID specified.");
        window.location.href = "Products.html";
        return;
    }

    // --- APPLY LIMIT TO MAIN PRODUCT NAME ---
    const nameInput = document.getElementById('inpName');
    applyCharLimit(nameInput); // Helper function is defined at the bottom

    // --- SETUP IMAGE UPLOAD LISTENER ---
    const fileInput = document.getElementById('fileInput');
    const preview = document.getElementById('imagePreview');
    const placeholder = document.getElementById('uploadPlaceholder');

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

                if (data.imageUrl) {
                    currentBase64Image = data.imageUrl; 
                    preview.src = data.imageUrl;
                    preview.style.display = "block";
                    placeholder.style.display = "none";
                }

                if (data.variations) {
                    data.variations.forEach(v => addVariationRow(v.size, v.color, v.custom));
                } else {
                    addVariationRow();
                }

                if (data.attributes) {
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

    // --- UPDATE LOGIC ---
    const form = document.getElementById('editProductForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            const btn = document.querySelector('.btn-submit');
            const originalText = btn.innerText;
            btn.innerText = "Updating...";
            btn.disabled = true;

            try {
                const variations = [];
                document.querySelectorAll('.variations-row').forEach(row => {
                    const size = row.querySelector('.var-size').value;
                    const color = row.querySelector('.var-color').value;
                    const custom = row.querySelector('.var-custom').value;
                    if(size && color) variations.push({ size, color, custom });
                });

                const attributes = [];
                document.querySelectorAll('.custom-attr-row').forEach(row => {
                    const name = row.querySelector('.attr-name').value;
                    const value = row.querySelector('.attr-value').value;
                    if(name && value) attributes.push({ name, value });
                });

                if (variations.length === 0) {
                    throw new Error("Please add at least one valid Product Variation.");
                }

                const updatedData = {
                    name: document.getElementById('inpName').value,
                    description: document.getElementById('inpDesc').value,
                    category: document.getElementById('inpCategory').value,
                    price: parseFloat(document.getElementById('inpPrice').value),
                    stock: parseInt(document.getElementById('inpStock').value),
                    lowStockThreshold: parseInt(document.getElementById('inpLowStock').value),
                    imageUrl: currentBase64Image, 
                    variations: variations,
                    attributes: attributes
                };

                await updateDoc(doc(db, "products", productId), updatedData);
                
                alert("Product Updated!");
                window.location.href = "Products.html";

            } catch (error) {
                console.error("Error updating:", error);
                alert("Error updating product: " + error.message);
                btn.innerText = originalText;
                btn.disabled = false;
            }
        });
    }
}

// --- HELPER: APPLY LIMIT & RED BORDER STYLE ---
function applyCharLimit(input) {
    if (!input) return;
    input.setAttribute("maxlength", "30"); // Hard limit
    
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

// --- HELPER FUNCTIONS ---
function addVariationRow(size="", color="", custom="") {
    const container = document.getElementById("variation-container");
    const row = document.createElement("div");
    row.className = "variations-row";
    row.innerHTML = `
        <div class="input-group"><input type="text" class="var-size" value="${size}" placeholder="Ex: Large" required></div>
        <div class="input-group"><input type="text" class="var-color" value="${color}" placeholder="Ex: Red" required></div>
        <div class="input-group"><input type="text" class="var-custom" value="${custom}" placeholder="Optional"></div>
        <button type="button" class="btn-plus remove-row-btn" style="background:#fee2e2; color:#ef4444;"><i class="fas fa-trash"></i></button>
    `;
    // Apply limits to new inputs
    row.querySelectorAll('input').forEach(inp => applyCharLimit(inp));
    container.appendChild(row);
}

function addAttributeRow(name="", value="") {
    const container = document.getElementById("custom-attributes-container");
    const row = document.createElement("div");
    row.className = "custom-attr-row";
    row.innerHTML = `
        <div class="input-group"><input type="text" class="attr-name" value="${name}" placeholder="Name"></div>
        <div class="input-group"><input type="text" class="attr-value" value="${value}" placeholder="Value"></div>
        <button type="button" class="btn-plus remove-attr-btn" style="background:#fee2e2; color:#ef4444;"><i class="fas fa-trash"></i></button>
    `;
    // Apply limits to new inputs
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
        }
        if (e.target.closest(".remove-attr-btn")) {
            e.target.closest(".custom-attr-row").remove();
        }
    });
}

// --- LOGOUT FUNCTION ---
window.logout = function() {
    sessionStorage.removeItem("user_session");
    sessionStorage.removeItem("user_uid");
    sessionStorage.removeItem("user_role");

    signOut(auth).then(() => {
        window.location.replace("Login.html");
    }).catch((error) => {
        console.error("Logout Error:", error);
        window.location.replace("Login.html");
    });
};