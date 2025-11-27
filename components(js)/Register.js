
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

    function showError(msg) {
        const box = document.getElementById("errorMessage");
        box.innerText = msg;
        box.style.display = "block";
    }
    
    window.register = async function () {
    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const pw = document.getElementById("password").value;
    const cpw = document.getElementById("confirmPassword").value;

    const errorBox = document.getElementById("errorMessage");

    errorBox.style.display = "none";

    // Validation
    if (!name || !email || !pw || !cpw) {
        errorBox.innerText = "Please fill out all fields.";
        errorBox.style.display = "block";
        return;
    }

    if (pw !== cpw) {
        errorBox.innerText = "Passwords do not match.";
        errorBox.style.display = "block";
        return;
    }

    if (pw.length < 6) {
        errorBox.innerText = "Password must be at least 6 characters.";
        errorBox.style.display = "block";
        return;
    }

    try {
        const userCred = await createUserWithEmailAndPassword(auth, email, pw);
        console.log("Account created:", userCred.user);

        const popup = document.getElementById("successPopup");
        popup.style.display = "flex";

    } catch (err) {
        errorBox.innerText = err.message;
        errorBox.style.display = "block";
        console.error(err);
    }
};

window.goToLogin = function() {
    window.location.href = "Login.html";
}
