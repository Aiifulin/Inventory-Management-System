import { auth, db } from "./firebase.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { createUserWithEmailAndPassword, sendEmailVerification, deleteUser } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

window.togglePassword = function(id, el) {
    const input = document.getElementById(id);
    const icon  = el.querySelector('i');
    if (input.type === "password") {
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
    registerBtn.disabled  = true;
    btnText.textContent   = "Creating account...";
    spinner.style.display = "inline-block";

    try {
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        const user     = userCred.user;
    
        
    
        await sendEmailVerification(user);

        // Store for later, don't write yet
        pendingUserData = { uid: user.uid, name, email, role: "user", createdAt: new Date() };
        
    
        registerBtn.disabled  = false;
        btnText.textContent   = "Create Account";
        spinner.style.display = "none";
    
        showVerifyModal(email, user);
        

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

window.goToLogin = function() {
    window.location.href = "index.html";
};

let verifyInterval = null;
let currentUser = null;
let pendingUserData = null;

function showVerifyModal(email, user) {
    currentUser = user;
    document.getElementById("verifyEmailDisplay").textContent = email;
    document.getElementById("verifyOverlay").style.display = "flex";
    startPolling();
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
    }, 40);
}

function startPolling() {
    verifyInterval = setInterval(async () => {
        try {
            await currentUser.reload();
            if (currentUser.emailVerified) {
                clearInterval(verifyInterval);
                showVerifySuccess();
            }
        } catch (e) { /* user may have been deleted */ }
    }, 3000); // checks every 3 seconds
}

function showVerifySuccess() {
    const status = document.getElementById("verifyStatus");
    status.innerHTML = `<span style="color:#16a34a; font-size:16px;">✓</span>
        <span style="color:#16a34a; font-weight:600;">Email verified!</span>`;
    status.style.background = "#dcfce7";

    // Replace the resend + cancel buttons with a Continue button
    document.getElementById("verifyActions").innerHTML = `
        <button class="login-btn" style="margin-top:8px;" onclick="proceedAfterVerify()">
            Continue to Login
        </button>
    `;
}

window.resendVerification = async function () {
    const btn = document.getElementById("resendBtnText");
    try {
        await sendEmailVerification(currentUser);
        btn.textContent = "Sent!";
        setTimeout(() => { btn.textContent = "Resend email"; }, 3000);
    } catch (e) {
        btn.textContent = "Try again later";
        setTimeout(() => { btn.textContent = "Resend email"; }, 3000);
    }
};

window.cancelVerification = async function () {
    clearInterval(verifyInterval);
    document.getElementById("verifyOverlay").style.display = "none";
    try {
        await deleteUser(currentUser);
        pendingUserData = null;
    } catch (e) {
        console.error("Failed to delete unverified user:", e);
    }
};

window.proceedAfterVerify = async function () {
    try {
        await setDoc(doc(db, "users", pendingUserData.uid), pendingUserData);
    } catch (e) {
        console.error("Failed to save user:", e);
    }
    document.getElementById("verifyOverlay").style.display = "none";
    showRegisterSuccess();
};

export { showError };