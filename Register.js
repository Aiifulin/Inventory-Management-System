    /************************************************
     * required for firebase
     ***********************************************/
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";

    import { 
        getAuth,
        createUserWithEmailAndPassword
    } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

    import {
        getFirestore,
        doc,
        setDoc
    } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

    /************************************************
     * WAG GALAWIN
     ***********************************************/
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
    const db = getFirestore(app);

    /************************************************
     * Functionalities
     ***********************************************/

    // Password Toggle
    window.togglePassword = function (id) {
        const input = document.getElementById(id);
        input.type = input.type === "password" ? "text" : "password";
    };

    // Navigation
    window.goToLogin = function () {
        window.location.href = "Login.html";
    };

    window.goToRegister = function () {
        window.location.href = "Register.html";
    };

    // Show Error Message
    function showError(msg) {
        const errorBox = document.getElementById("error-box");
        errorBox.style.display = "block";
        errorBox.textContent = msg;
    }

    /************************************************
     * REGISTER
     ***********************************************/
    const registerForm = document.getElementById("register-form");

    registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

        const name = document.getElementById("name").value.trim();
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;
        const confirmPassword = document.getElementById("confirmPassword").value;
        const errorBox = document.getElementById("error-box");

        // RESET ERROR BOX
        errorBox.style.display = "none";
        errorBox.textContent = "";

        // VALIDATION
        if (password !== confirmPassword) {
            return showError("Passwords do not match");
        }

        if (password.length < 6) {
            return showError("Password must be at least 6 characters");
        }

        try {
            // 1. CREATE USER IN FIREBASE AUTH
            const userCred = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCred.user;

            // 2. SAVE USER DATA TO FIRESTORE
            await setDoc(doc(db, "users", user.uid), {
                fullName: name,
                email: email,
                createdAt: new Date()
            });

        } catch (err) {
            console.error(err);

            if (err.code === "auth/email-already-in-use") {
                showError("This email is already registered.");
            } else {
                showError(err.message);
            }
        }
    });