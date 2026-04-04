import { describe, it, expect, beforeEach, afterEach } from "vitest";
// Ensure this path points to your refactored Login.js
import { firebaseConfig, togglePassword } from "./Login.js";

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
        // Regex adjusted to match standard API key length (usually 39 chars)
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

        // Mock window.location
        delete window.location;
        window.location = { href: "Initial.html" };
    });

    afterEach(() => {
        // Clean up the DOM after each test
        document.body.innerHTML = '';
    });

    // --- TEST 1: Toggle from password to text ---
    it("should change input type from 'password' to 'text'", () => {
        expect(input.type).toBe("password");
        togglePassword(inputId, button);
        expect(input.type).toBe("text");
    });

    // --- TEST 2: Toggle from text back to password ---
    it("should change input type from 'text' back to 'password'", () => {
        input.type = "text";
        // Helper to manually set icon state to match input type
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
        
        expect(input.type).toBe("text");
        
        togglePassword(inputId, button);
        expect(input.type).toBe("password");
    });

    // --- TEST 3: Icon change (fa-eye to fa-eye-slash) ---
    it("should toggle icon class from 'fa-eye' to 'fa-eye-slash'", () => {
        expect(icon.classList.contains('fa-eye')).toBe(true);
        togglePassword(inputId, button);
        expect(icon.classList.contains('fa-eye')).toBe(false);
        expect(icon.classList.contains('fa-eye-slash')).toBe(true);
    });

    // --- TEST 4: Icon change (fa-eye-slash to fa-eye) ---
    it("should toggle icon class from 'fa-eye-slash' back to 'fa-eye'", () => {
        // Arrange: Set up the state where the password is currently visible
        input.type = "text";
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
        expect(icon.classList.contains('fa-eye-slash')).toBe(true);

        // Act
        togglePassword(inputId, button);

        // Assert
        expect(icon.classList.contains('fa-eye-slash')).toBe(false);
        expect(icon.classList.contains('fa-eye')).toBe(true);
    });
});