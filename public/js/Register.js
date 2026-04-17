import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
// Added setDoc and doc to imports
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
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
const auth = getAuth(app);
const db = initializeFirestore(app, {
    localCache: persistentLocalCache()
});

window.togglePassword = function(id, el) {
    const input = document.getElementById(id);
    const icon = el.querySelector('i');
    if(input.type === "password") {
        input.type = "text";
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = "password";
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
};

window.register = async function () {
    const name            = document.getElementById("name").value.trim();
    const email           = document.getElementById("email").value.trim();
    const password        = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirmPassword").value;
    const errorBox        = document.getElementById("errorMessage");
    const registerBtn     = document.getElementById("registerBtn");
    const btnText         = document.getElementById("registerBtnText");
    const spinner         = document.getElementById("registerSpinner");

    // Clear previous error
    errorBox.style.display = "none";
    errorBox.textContent   = "";

    // --- VALIDATION ---
    if (!name || !email || !password || !confirmPassword) {
        showError(errorBox, "Please fill out all fields.");
        return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
        showError(errorBox, "Please enter a valid email address.");
        return;
    }

    if (password.length < 6) {
        showError(errorBox, "Password must be at least 6 characters.");
        return;
    }

    if (password !== confirmPassword) {
        showError(errorBox, "Passwords do not match.");
        return;
    }

    // Show loading state
    registerBtn.disabled   = true;
    btnText.textContent    = "Creating account...";
    spinner.style.display  = "inline-block";

    try {
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        const user     = userCred.user;

        await setDoc(doc(db, "users", user.uid), {
            uid:       user.uid,
            name:      name,
            email:     email,
            role:      "user",
            createdAt: new Date()
        });

        showRegisterSuccess();

    } catch (err) {
        console.error(err);

        // Reset button
        registerBtn.disabled  = false;
        btnText.textContent   = "Create Account";
        spinner.style.display = "none";

        let msg = err.message;
        if (err.code === "auth/email-already-in-use") {
            msg = "An account with this email already exists.";
        } else if (err.code === "auth/invalid-email") {
            msg = "Please enter a valid email address.";
        } else if (err.code === "auth/weak-password") {
            msg = "Password must be at least 6 characters.";
        }

        showError(errorBox, msg);
    }
};

function showError(box, message) {
    box.textContent   = message;
    box.style.display = "block";
    // Re-trigger shake animation
    box.style.animation = "none";
    box.offsetHeight;
    box.style.animation = "";
}

function showRegisterSuccess() {
    const overlay = document.getElementById("successOverlay");
    const bar     = document.getElementById("registerProgressBar");

    overlay.style.display = "flex";

    let width = 0;
    const interval = setInterval(() => {
        width += 2;
        bar.style.width = width + "%";
        if (width >= 100) {
            clearInterval(interval);
            window.location.href = "index.html";
        }
    }, 40); // 2 seconds total
}

window.goToLogin = function() {
    window.location.href = "index.html";
};