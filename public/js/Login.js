/************************************************
 * IMPORTS
 ***********************************************/
import { auth, db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

/************************************************
 * LOGIN FUNCTION
 ***********************************************/
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

            if (!userCredential.user.emailVerified) {
                await signOut(auth);

                loginBtn.disabled     = false;
                btnText.textContent   = "Sign In";
                spinner.style.display = "none";

                if (errorBox) {
                    errorBox.textContent = "Please verify your email before signing in. Check your inbox for the verification link.";
                    errorBox.style.display = "block";
                    errorBox.style.animation = "none";
                    errorBox.offsetHeight;
                    errorBox.style.animation = "";
                }
                return;
            }

            const uid = userCredential.user.uid;

            localStorage.setItem("user_session", "true");
            localStorage.setItem("user_uid", uid);

            let userName = "User";
            try {
                const snap = await getDoc(doc(db, "users", uid));
                if (snap.exists()) {
                    userName = snap.data().name || "User";
                }
            } catch (err) {
                console.error("Error fetching user name:", err);
            }

            showLoginSuccess(userName);
        })
        .catch((err) => {
            console.error(err.code, err.message);

            // Reset button
            loginBtn.disabled     = false;
            btnText.textContent   = "Sign In";
            spinner.style.display = "none";

            if (errorBox) {
                errorBox.style.display = "block";
                // Re-trigger shake animation
                errorBox.style.animation = 'none';
                errorBox.offsetHeight; // reflow
                errorBox.style.animation = '';

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

function showLoginSuccess(userName) {
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
            window.location.href = "Dashboard.html";
        }
    }, 35);
}

/************************************************
 * PASSWORD TOGGLE
 ***********************************************/
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

/************************************************
 * NAVIGATION
 ***********************************************/
const goToRegister = function () {
    window.location.href = "Register.html";
};

// EXPOSE FUNCTIONS TO WINDOW
window.login          = login;
window.togglePassword = togglePassword;
window.goToRegister   = goToRegister;

export { login, togglePassword, goToRegister };