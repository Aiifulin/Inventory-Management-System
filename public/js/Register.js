import { auth, db } from "./firebase.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { createUserWithEmailAndPassword, sendEmailVerification, deleteUser } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";


// ============================================================
// SECTION 1 — PASSWORD VISIBILITY TOGGLE
// Handles the show/hide toggle for password input fields.
// ============================================================

/**
 * Toggles a password input between plain-text and masked mode.
 * Also swaps the eye icon to reflect the current visibility state.
 *
 * @param {string} id  — the ID of the <input> element to toggle
 * @param {Element} el — the toggle button element containing the icon
 */
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


// ============================================================
// SECTION 2 — REGISTRATION HANDLER
// Validates all form fields, creates the Firebase Auth account,
// sends a verification email, and opens the verify modal.
// The Firestore user document is NOT written here — it is only
// written after the user confirms their email (see Section 5).
// ============================================================

/**
 * Main registration function triggered by the "Create Account" button.
 *
 * Flow:
 *   1. Reads and trims all form field values.
 *   2. Runs client-side validation (required fields, email format,
 *      password length, password match).
 *   3. Shows a loading state on the submit button.
 *   4. Creates the Firebase Auth user via createUserWithEmailAndPassword().
 *   5. Sends a verification email to the new user.
 *   6. Stores the user's profile data in pendingUserData (not yet saved
 *      to Firestore) and opens the email-verification modal.
 *   7. On any error, resets the button and displays a friendly message.
 */
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

        // Stage the user's profile data for Firestore — written only
        // after email verification is confirmed (see proceedAfterVerify).
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


// ============================================================
// SECTION 3 — UI UTILITIES
// Small helpers for displaying errors and navigating pages.
// ============================================================

/**
 * Displays an error message in the given error box element.
 * Re-triggers the CSS shake animation by briefly clearing and
 * resetting the animation property.
 *
 * @param {Element} box     — the error message container element
 * @param {string}  message — the error text to display
 */
function showError(box, message) {
    box.textContent   = message;
    box.style.display = "block";
    // Re-trigger shake animation
    box.style.animation = "none";
    box.offsetHeight;
    box.style.animation = "";
}

/**
 * Redirects the user back to the login page.
 * Bound to the "Go to Login" button on the registration page.
 */
window.goToLogin = function() {
    window.location.href = "index.html";
};


// ============================================================
// SECTION 4 — GLOBALS
// verifyInterval — holds the setInterval ID for the email
//   verification polling loop so it can be stopped on success
//   or cancellation.
// currentUser    — holds the Firebase Auth user object created
//   during registration, used by the polling loop and resend.
// pendingUserData — the user's profile object staged during
//   registration, written to Firestore only after email is verified.
// ============================================================
let verifyInterval = null;
let currentUser = null;
let pendingUserData = null;


// ============================================================
// SECTION 5 — EMAIL VERIFICATION MODAL
// After account creation, the user is shown a modal asking them
// to verify their email. A polling loop checks Firebase every
// 3 seconds. On success, the Firestore user document is written
// and the user is redirected to login. On cancellation, the
// unverified Auth account is deleted to keep Auth clean.
// ============================================================

/**
 * Opens the email-verification modal and starts the polling loop.
 * Displays the user's email address inside the modal for clarity.
 *
 * @param {string}  email — the email address the verification was sent to
 * @param {Object}  user  — the Firebase Auth user object
 */
function showVerifyModal(email, user) {
    currentUser = user;
    document.getElementById("verifyEmailDisplay").textContent = email;
    document.getElementById("verifyOverlay").style.display = "flex";
    startPolling();
}

/**
 * Shows the animated progress bar success overlay and redirects
 * the user to the login page once the bar reaches 100 %.
 * Called after the Firestore user document has been saved.
 */
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

/**
 * Starts a 3-second polling loop that reloads the Firebase Auth
 * user and checks whether their email has been verified.
 * Stops itself and calls showVerifySuccess() as soon as
 * emailVerified becomes true.
 */
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

/**
 * Updates the verification modal UI to show a success state.
 * Replaces the "Resend" and "Cancel" buttons with a single
 * "Continue to Login" button that calls proceedAfterVerify().
 */
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

/**
 * Resends the verification email to the current user.
 * Temporarily updates the button text to give visual feedback,
 * resetting it after 3 seconds regardless of success or failure.
 */
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

/**
 * Handles the user clicking "Cancel" on the verification modal.
 * Stops the polling loop, hides the modal, and deletes the
 * unverified Firebase Auth account to prevent orphaned accounts
 * from accumulating in Firebase Authentication.
 */
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

/**
 * Called when the user clicks "Continue to Login" after verifying
 * their email. Writes the staged user profile (pendingUserData) to
 * Firestore, closes the modal, and triggers the success overlay
 * which redirects to the login page.
 *
 * Writing to Firestore is deferred to this point so that only
 * verified users ever appear in the users collection.
 */
window.proceedAfterVerify = async function () {
    try {
        await setDoc(doc(db, "users", pendingUserData.uid), pendingUserData);
    } catch (e) {
        console.error("Failed to save user:", e);
    }
    document.getElementById("verifyOverlay").style.display = "none";
    showRegisterSuccess();
};


// ============================================================
// EXPORTS
// Named exports allow other modules or unit tests to reuse
// the showError helper without importing the full module.
// ============================================================
export { showError };