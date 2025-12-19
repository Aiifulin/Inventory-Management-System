import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
// ADDED imports: query, where, getDocs
import { getFirestore, collection, addDoc, serverTimestamp, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
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
let base64ImageString = "";

onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = "Login.html";
    } else if (user.uid !== ADMIN_UID) {
        alert("Access Denied: Only Admin can add products.");
        window.location.href = "Products.html";
    } else {
        console.log("Admin verified.");
    }
});

document.addEventListener("DOMContentLoaded", () => {

    function sanitizeInput(str) {
        if (typeof str !== 'string') return str;
        return str.replace(/[&<>"']/g, function(m) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            }[m];
        });
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
            if (this.value < 0) {
                this.value = 0; 
            }
        });
    }
    
    const nameInput = document.querySelector('input[placeholder="Enter product name"]');
    applyCharLimit(nameInput);

    document.querySelectorAll('input[type="number"]').forEach(inp => preventNegatives(inp));

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
                base64ImageString = reader.result;
                preview.src = reader.result;
                preview.style.display = "block";
                placeholder.style.display = "none";
            }
            reader.readAsDataURL(file);
        });
    }

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

    // --- SAVE LOGIC ---
    const submitBtn = document.querySelector('.btn-submit');
    const form = document.querySelector('form');

    if(submitBtn && form) {
        submitBtn.addEventListener("click", async (e) => {
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }
            e.preventDefault();

            const originalText = submitBtn.innerText;
            submitBtn.innerText = "Saving...";
            submitBtn.disabled = true;

            try {
                const priceVal = parseFloat(document.querySelector('input[type="number"][step="0.01"]').value) || 0;
                const stockVal = parseInt(document.querySelector('input[placeholder="0"]').value) || 0;
                const thresholdVal = parseInt(document.querySelector('input[placeholder="10"]').value) || 10;

                if (priceVal < 0 || stockVal < 0 || thresholdVal < 0) {
                    throw new Error("Price and Stock values cannot be negative.");
                }

                const rawName = document.querySelector('input[placeholder="Enter product name"]').value.trim();
                const rawDesc = document.querySelector('textarea').value;

                // --- 1. DUPLICATE CHECK ---
                // Query Firestore for products with the exact same name
                const q = query(collection(db, "products"), where("name", "==", rawName));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    // Exact match found immediately
                    throw new Error(`Product name "${rawName}" already exists!`);
                } else {
                    // Optional: Fetch ALL names to check case-insensitive match (e.g., "Chair" vs "chair")
                    // Note: For large databases, this is inefficient. For small inventory, it works.
                    const allDocs = await getDocs(collection(db, "products"));
                    let isDuplicate = false;
                    allDocs.forEach(doc => {
                        if (doc.data().name.toLowerCase() === rawName.toLowerCase()) {
                            isDuplicate = true;
                        }
                    });
                    
                    if (isDuplicate) {
                        throw new Error(`Product name "${rawName}" already exists (duplicate name)!`);
                    }
                }

                const productData = {
                    name: sanitizeInput(rawName), 
                    description: sanitizeInput(rawDesc), 
                    category: document.querySelector('select').value, 
                    price: priceVal,
                    stock: stockVal,
                    lowStockThreshold: thresholdVal,
                    imageUrl: base64ImageString, 
                    createdAt: serverTimestamp(),
                    createdBy: auth.currentUser.uid, 
                    variations: [],
                    attributes: []
                };

                document.querySelectorAll('.variations-row').forEach(row => {
                    const size = sanitizeInput(row.querySelector('.var-size').value);
                    const color = sanitizeInput(row.querySelector('.var-color').value);
                    const custom = sanitizeInput(row.querySelector('.var-custom').value);
                    
                    if(size && color) productData.variations.push({ size, color, custom });
                });

                document.querySelectorAll('.custom-attr-row').forEach(row => {
                    const name = sanitizeInput(row.querySelector('.attr-name').value);
                    const value = sanitizeInput(row.querySelector('.attr-value').value);
                    
                    if(name && value) productData.attributes.push({ name, value });
                });

                if (productData.variations.length === 0) {
                    throw new Error("Please add at least one valid Product Variation.");
                }

                await addDoc(collection(db, "products"), productData);
                
                alert("Product Saved Successfully!");
                window.location.href = "Dashboard.html";

            } catch (error) {
                console.error("Error:", error);
                alert("Error saving: " + error.message);
                submitBtn.innerText = originalText;
                submitBtn.disabled = false;
            }
        });
    }
});

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