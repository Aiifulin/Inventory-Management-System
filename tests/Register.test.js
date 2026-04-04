// tests/Register.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateRegistration, registerUserLogic } from "./Register.js";

// --- HOISTED MOCKS ---
const { mockCreateUser, mockSetDoc, mockDoc, mockFirestore } = vi.hoisted(() => ({
    mockCreateUser: vi.fn(),
    mockSetDoc: vi.fn(),
    mockDoc: vi.fn(),
    mockFirestore: vi.fn()
}));

// --- MOCK FIREBASE ---
vi.mock("firebase/auth", () => ({
    getAuth: vi.fn(),
    createUserWithEmailAndPassword: mockCreateUser
}));

vi.mock("firebase/firestore", () => ({
    getFirestore: mockFirestore,
    doc: mockDoc,
    setDoc: mockSetDoc
}));

describe("Registration Logic", () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    // --- TEST 1: Validation ---
    describe("validateRegistration", () => {
        it("should return error if fields are missing", () => {
            const result = validateRegistration("", "test@test.com", "123456", "123456");
            expect(result).toBe("Please fill out all fields.");
        });

        it("should return error for invalid email", () => {
            const result = validateRegistration("John", "invalid-email", "123456", "123456");
            expect(result).toBe("Please enter a valid email address.");
        });

        it("should return error if passwords do not match", () => {
            const result = validateRegistration("John", "test@test.com", "123456", "654321");
            expect(result).toBe("Passwords do not match.");
        });

        it("should return error if password is too short", () => {
            const result = validateRegistration("John", "test@test.com", "123", "123");
            expect(result).toBe("Password must be at least 6 characters.");
        });

        it("should return null (success) for valid inputs", () => {
            const result = validateRegistration("John", "test@test.com", "123456", "123456");
            expect(result).toBeNull();
        });
    });

    // --- TEST 2: Database Operations ---
    describe("registerUserLogic", () => {
        it("should create auth user and save to firestore", async () => {
            // Mock successful auth creation
            const mockUser = { uid: "user123", email: "test@test.com" };
            mockCreateUser.mockResolvedValue({ user: mockUser });

            // Call the function
            await registerUserLogic("John Doe", "test@test.com", "password123", {}, {});

            // Verify Auth was called
            expect(mockCreateUser).toHaveBeenCalled();

            // Verify Firestore save was called
            expect(mockSetDoc).toHaveBeenCalled();
            
            // Verify correct data format (including default 'user' role)
            const setDocCall = mockSetDoc.mock.calls[0];
            const data = setDocCall[1]; // The data object passed to setDoc
            
            expect(data.uid).toBe("user123");
            expect(data.name).toBe("John Doe");
            expect(data.role).toBe("user"); // CRITICAL CHECK
        });

        it("should throw error if firebase fails", async () => {
            // Mock Auth failure (e.g., email already in use)
            mockCreateUser.mockRejectedValue(new Error("Email already in use"));

            await expect(registerUserLogic("John", "test@test.com", "pass", {}, {}))
                .rejects.toThrow("Email already in use");
            
            // Firestore should NOT be called if auth fails
            expect(mockSetDoc).not.toHaveBeenCalled();
        });
    });
});