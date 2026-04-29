// ============================================================
// Login.js
// Handles authentication logic for the login page, including
// credential validation, Firebase sign-in, email verification
// checks, and the post-login success animation.
//
// ARCHITECTURE OVERVIEW:
//   1. Imports          — Firebase Auth + Firestore dependencies
//   2. Login Function   — validates credentials, calls Firebase
//                         signInWithEmailAndPassword, handles all
//                         error cases, and triggers the success flow
//   3. Success Overlay  — animates a progress bar then redirects
//                         to Dashboard.html
//   4. Password Toggle  — shows/hides the password input value
//   5. Navigation       — helper to route the user to Register.html
//   6. Window Exports   — exposes functions to inline HTML handlers
// ============================================================

/************************************************
 * IMPORTS
 ***********************************************/
import { auth, db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";


// ============================================================
// SECTION 1 — LOGIN FUNCTION
// Core authentication flow. Reads email + password from the
// form, calls Firebase, handles every error case with a user-
// friendly message, and on success triggers the welcome overlay.
// ============================================================

/**
 * Attempts to sign the user in with their email and password.
 *
 * Flow:
 *  1. Reads and trims the email and password field values.
 *  2. Clears any previously displayed error message.
 *  3. Disables the login button and shows a spinner to prevent
 *     double-submission and give visual feedback.
 *  4. Calls Firebase signInWithEmailAndPassword().
 *  5. If sign-in succeeds but the email is NOT verified:
 *       — Signs the user back out immediately.
 *       — Displays an informational error asking them to verify.
 *  6. If sign-in succeeds and email IS verified:
 *       — Persists a lightweight auth flag in localStorage.
 *       — Fetches the user's display name from Firestore.
 *       — Calls showLoginSuccess() to animate the redirect.
 *  7. On any Firebase error, re-enables the button and shows a
 *     message mapped from the error code:
 *       auth/invalid-credential | auth/user-not-found |
 *       auth/wrong-password → "Invalid email or password."
 *       auth/too-many-requests  → "Too many attempts…"
 *       anything else           → raw Firebase error message.
 *
 * @returns {Promise<void>}
 */
const login = function () {
    const email    = document.getElementById("email").value.trim();
    const pass     = document.getElementById("password").value.trim();
    const errorBox = document.getElementById("errorMessage");
    const loginBtn = document.getElementById("loginBtn");
    const btnText  = document.getElementById("loginBtnText");
    const spinner  = document.getElementById("loginSpinner");

    // Clear previous errors
    if (errorBox) { errorBox.style.display = "none"; errorBox.textContent = ""; }

    // Show loading state
    loginBtn.disabled   = true;
    btnText.textContent = "Signing in...";
    spinner.style.display = "inline-block";

    return signInWithEmailAndPassword(auth, email, pass)
        .then(async (userCredential) => {

            // Block unverified accounts — sign them out and show a notice.
            if (!userCredential.user.emailVerified) {
                await signOut(auth);

                loginBtn.disabled     = false;
                btnText.textContent   = "Sign In";
                spinner.style.display = "none";

                if (errorBox) {
                    errorBox.textContent = "Please verify your email before signing in. Check your inbox for the verification link.";
                    errorBox.style.display = "block";
                    // Re-trigger the shake/fade-in animation by forcing a reflow.
                    errorBox.style.animation = "none";
                    errorBox.offsetHeight;
                    errorBox.style.animation = "";
                }
                return;
            }

            const uid = userCredential.user.uid;

            // Persist a lightweight session flag so other pages can
            // quickly check auth status without an async call.
            localStorage.setItem("user_session", "true");
            localStorage.setItem("user_uid", uid);

            // Fetch the user's display name and role for the welcome overlay
            // and post-login route.
            let userName = "User";
            let userRole = "user";
            try {
                const snap = await getDoc(doc(db, "users", uid));
                if (snap.exists()) {
                    const userData = snap.data();
                    userName = userData.name || "User";
                    userRole = userData.role || "user";
                    sessionStorage.setItem(`user_data_${uid}`, JSON.stringify(userData));
                }
            } catch (err) {
                console.error("Error fetching user data:", err);
            }

            const normalizedRole = userRole.toLowerCase();
            const redirectUrl = normalizedRole === "admin" ? "Dashboard.html" : "Products.html";
            localStorage.setItem("user_role", normalizedRole === "admin" ? "admin" : "user");

            showLoginSuccess(userName, redirectUrl);
        })
        .catch((err) => {
            console.error(err.code, err.message);

            // Reset button to allow retry.
            loginBtn.disabled     = false;
            btnText.textContent   = "Sign In";
            spinner.style.display = "none";

            if (errorBox) {
                errorBox.style.display = "block";
                // Re-trigger shake animation.
                errorBox.style.animation = 'none';
                errorBox.offsetHeight; // force reflow
                errorBox.style.animation = '';

                // Map Firebase error codes to human-friendly messages.
                if (["auth/invalid-credential","auth/user-not-found","auth/wrong-password"].includes(err.code)) {
                    errorBox.textContent = "Invalid email or password. Please try again.";
                } else if (err.code === "auth/too-many-requests") {
                    errorBox.textContent = "Too many attempts. Please wait a moment and try again.";
                } else {
                    errorBox.textContent = err.message;
                }
            }
        });
};


// ============================================================
// SECTION 2 — SUCCESS OVERLAY
// Shown after a successful, verified login. Animates a progress
// bar from 0 → 100 % over ~1.75 s, then navigates to Dashboard.
// ============================================================

/**
 * Displays the full-screen login success overlay and animates
 * a progress bar that fills over ~1.75 seconds before redirecting
 * the user to Dashboard.html.
 *
 * The welcome title is personalised with the user's display name
 * fetched during the login flow.
 *
 * Progress animation: increments the bar's width by 2 % every 35 ms
 * (50 steps × 35 ms ≈ 1,750 ms total) via setInterval. The interval
 * is cleared as soon as width reaches 100 %.
 *
 * @param {string} userName — the user's display name to show in the title
 */
function showLoginSuccess(userName, redirectUrl) {
    const overlay = document.getElementById('loginSuccessOverlay');
    const bar     = document.getElementById('loginProgressBar');
    const title   = document.querySelector('.login-success-title');

    title.textContent = `Welcome back, ${userName}!`;
    overlay.style.display = 'flex';

    let width = 0;
    const interval = setInterval(() => {
        width += 2;
        bar.style.width = width + '%';
        if (width >= 100) {
            clearInterval(interval);
            window.location.href = redirectUrl;
        }
    }, 35);
}


// ============================================================
// SECTION 3 — PASSWORD TOGGLE
// Toggles the password input between plain-text and masked modes
// and updates the eye icon to match the current visibility state.
// ============================================================

/**
 * Toggles a password input field between "password" (masked) and
 * "text" (visible) types, and swaps the Font Awesome eye icon to
 * indicate the current state:
 *   masked  → fa-eye      (click to reveal)
 *   visible → fa-eye-slash (click to hide)
 *
 * @param {string}      id — the ID of the <input> element to toggle
 * @param {HTMLElement} el — the toggle button element that contains
 *                          the <i> icon (used to swap the icon class)
 */
const togglePassword = function (id, el) {
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
// SECTION 4 — NAVIGATION
// Simple redirect helper used by the "Create an account" link
// on the login page.
// ============================================================

/**
 * Navigates the browser to the Register page.
 * Called by the "Register" / "Create account" link on the login form.
 */
const goToRegister = function () {
    window.location.href = "Register.html";
};


// ============================================================
// SECTION 5 — WINDOW EXPORTS
// These functions are called directly from inline HTML event
// handlers (onclick="login()", etc.), so they must be attached
// to window in addition to being exported as ES module bindings.
// ============================================================
window.login          = login;
window.togglePassword = togglePassword;
window.goToRegister   = goToRegister;

// ============================================================
// EXPORTS
// Named exports allow other modules (e.g. unit tests or other
// pages) to reuse individual helpers without importing the
// entire module.
// ============================================================
export { 
    login, 
    togglePassword, 
    goToRegister };
