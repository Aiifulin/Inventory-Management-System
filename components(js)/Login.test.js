import { describe, it, expect } from "vitest";
import { firebaseConfig } from "./Login.js";
import { togglePassword } from "./Login.js";
import { beforeEach } from "vitest";
import { afterEach } from "vitest";

describe("firebaseConfig", () => {
    it("should have all required Firebase configuration properties", () => {
        expect(firebaseConfig).toHaveProperty("apiKey");
        expect(firebaseConfig).toHaveProperty("authDomain");
        expect(firebaseConfig).toHaveProperty("projectId");
        expect(firebaseConfig).toHaveProperty("storageBucket");
        expect(firebaseConfig).toHaveProperty("messagingSenderId");
        expect(firebaseConfig).toHaveProperty("appId");
        expect(firebaseConfig).toHaveProperty("measurementId");
    });

    it("should have non-empty string values for all properties", () => {
        Object.values(firebaseConfig).forEach((value) => {
            expect(typeof value).toBe("string");
            expect(value.length).toBeGreaterThan(0);
        });
    });

    it("should have valid Firebase project configuration format", () => {
        expect(firebaseConfig.projectId).toMatch(/^[a-z0-9-]+$/);
        expect(firebaseConfig.authDomain).toMatch(/\.firebaseapp\.com$/);
        expect(firebaseConfig.storageBucket).toMatch(/\.firebasestorage\.app$/);
        expect(firebaseConfig.messagingSenderId).toMatch(/^\d+$/);
    });

    it("should have a valid apiKey format", () => {
        expect(firebaseConfig.apiKey).toMatch(/^AIza[0-9A-Za-z_-]{35}$/);
    });

    it("should have a valid appId format", () => {
        expect(firebaseConfig.appId).toMatch(/^1:\d+:web:[0-9a-f]{22}$/);
    });

    it("should not have any properties with null values", () => {
        Object.values(firebaseConfig).forEach((value) => {
            expect(value).not.toBeNull();
        });
    });

    it("should have a valid measurementId format", () => {
        expect(firebaseConfig.measurementId).toMatch(/^G-[A-Z0-9]{10}$/);
    });

    it("should contain a valid projectId", () => {
        const validProjectId = "inventory-management-sys-baccc";
        expect(firebaseConfig.projectId).toBe(validProjectId);
    });

describe("togglePassword", () => {
    let input;
    let icon;
    let button;
    const inputId = "test-password-input";

    beforeEach(() => {
        // Mock the initial DOM structure for testing
        document.body.innerHTML = `
            <button id="toggle-button">
                <i id="test-icon" class="fa-eye"></i>
            </button>
            <input id="${inputId}" type="password"/>
        `;
        input = document.getElementById(inputId);
        icon = document.getElementById("test-icon");
        button = document.getElementById("toggle-button");

        // Spy on window.location.href to track changes
        // JSDOM provides a writable location mock
        window.location.href = "Initial.html"; 
    });

    afterEach(() => {
        // Clean up the DOM after each test
        document.body.innerHTML = ''; 
    });
    
    // --- TEST 1: Toggle from password to text ---
    it("should change input type from 'password' to 'text'", () => {
        // Arrange: Input is initially type="password" (from beforeEach)
        expect(input.type).toBe("password");
        
        // Act
        togglePassword(inputId, button);

        // Assert
        expect(input.type).toBe("text");
    });

    // --- TEST 2: Toggle from text back to password ---
    it("should change input type from 'text' back to 'password'", () => {
        // Arrange: Manually set input type to 'text' before calling the function
        input.type = "text";
        expect(input.type).toBe("text"); 
        
        // Act
        togglePassword(inputId, button);

        // Assert
        expect(input.type).toBe("password");
    });

    // --- TEST 3: Icon change (fa-eye to fa-eye-slash) ---
    it("should toggle icon class from 'fa-eye' to 'fa-eye-slash'", () => {
        // Arrange: Input is initially type="password" (from beforeEach)
        expect(icon.classList.contains('fa-eye')).toBe(true);

        // Act (simulates showing the password)
        togglePassword(inputId, button);

        // Assert
        expect(icon.classList.contains('fa-eye')).toBe(false);
        expect(icon.classList.contains('fa-eye-slash')).toBe(true);
    });
    
    // --- TEST 5: Icon change (fa-eye-slash to fa-eye) ---
    it("should toggle icon class from 'fa-eye-slash' back to 'fa-eye'", () => {
        // Arrange: Set up the state where the password is currently visible
        input.type = "text";
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
        expect(icon.classList.contains('fa-eye-slash')).toBe(true);

        // Act (simulates hiding the password)
        togglePassword(inputId, button);

        // Assert
        expect(icon.classList.contains('fa-eye-slash')).toBe(false);
        expect(icon.classList.contains('fa-eye')).toBe(true);
    });

});



});