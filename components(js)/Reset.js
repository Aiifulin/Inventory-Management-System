/************************************************
 * required for firebase
 ***********************************************/
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js"

import { getAuth, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js"

/************************************************
 * WAG GALAWIN
 **********************************************/
const firebaseConfig = {
  apiKey: "AIzaSyBeaF2VKovHASuzhvZHzOoE0yB7QnBDej0",
  authDomain: "inventory-management-sys-baccc.firebaseapp.com",
  projectId: "inventory-management-sys-baccc",
  storageBucket: "inventory-management-sys-baccc.firebasestorage.app",
  messagingSenderId: "304433839568",
  appId: "1:304433839568:web:50dafae1296e6bb0d30dd5",
  measurementId: "G-68CR9JCJV8",
}

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)

    /************************************************
     * Functionalities
     ***********************************************/
    // Navigation
    window.goToLogin = function () {
      window.location.href = "Login.html";
  };
  
  
    // Show Error Message
    function showError(msg) {
      const errorBox = document.getElementById("error-box")
      errorBox.style.display = "block"
      errorBox.textContent = msg
    }

function showSuccess(msg) {
  const successBox = document.getElementById("success-box")
  successBox.style.display = "block"
  successBox.textContent = msg
}

/************************************************
 * PASSWORD RESET
 ***********************************************/
const passwordResetForm = document.getElementById("password-reset-form")

passwordResetForm.addEventListener("submit", async (e) => {
  e.preventDefault()

  const email = document.getElementById("email").value.trim()
  const errorBox = document.getElementById("error-box")
  const successBox = document.getElementById("success-box")

  errorBox.style.display = "none"
  errorBox.textContent = ""
  successBox.style.display = "none"
  successBox.textContent = ""

  // VALIDATION
  if (!email) {
    return showError("Please enter your email address")
  }

  try {
    await sendPasswordResetEmail(auth, email)

    // Show success message
    showSuccess("Password reset email sent successfully. Check your inbox.")

    // Clear form
    passwordResetForm.reset()
  } catch (err) {
    console.error(err)

    if (err.code === "auth/user-not-found") {
      showError("No account found with this email address.")
    } else if (err.code === "auth/invalid-email") {
      showError("Please enter a valid email address.")
    } else if (err.code === "auth/too-many-requests") {
      showError("Too many attempts. Please try again later.")
    } else {
      showError(err.message)
    }
  }
})
