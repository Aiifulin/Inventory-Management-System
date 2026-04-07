import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateRegistration, registerUserLogic } from "./Register.js";

const { mockCreateUser, mockSetDoc, mockDoc, mockFirestore } = vi.hoisted(() => ({
    mockCreateUser: vi.fn(),
    mockSetDoc: vi.fn(),
    mockDoc: vi.fn(),
    mockFirestore: vi.fn()
}));

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

    beforeEach(() => vi.clearAllMocks());

    // ─── validateRegistration ─────────────────────────────────────────────────
    describe("validateRegistration", () => {
        it("should return error if name is empty", () => {
            expect(validateRegistration("", "test@test.com", "123456", "123456"))
                .toBe("Please fill out all fields.");
        });

        it("should return error if email is empty", () => {
            expect(validateRegistration("John", "", "123456", "123456"))
                .toBe("Please fill out all fields.");
        });

        it("should return error if password is empty", () => {
            expect(validateRegistration("John", "test@test.com", "", ""))
                .toBe("Please fill out all fields.");
        });

        it("should return error for invalid email (no @)", () => {
            expect(validateRegistration("John", "invalidemail", "123456", "123456"))
                .toBe("Please enter a valid email address.");
        });

        it("should return error for invalid email (no TLD)", () => {
            expect(validateRegistration("John", "user@domain", "123456", "123456"))
                .toBe("Please enter a valid email address.");
        });

        it("should return error if passwords do not match", () => {
            expect(validateRegistration("John", "test@test.com", "123456", "654321"))
                .toBe("Passwords do not match.");
        });

        it("should return error if password is too short (< 6 chars)", () => {
            expect(validateRegistration("John", "test@test.com", "123", "123"))
                .toBe("Password must be at least 6 characters.");
        });

        it("should return null (success) for valid inputs", () => {
            expect(validateRegistration("John", "test@test.com", "123456", "123456"))
                .toBeNull();
        });

        it("should accept emails with subdomains", () => {
            expect(validateRegistration("John", "user@mail.example.com", "pass12", "pass12"))
                .toBeNull();
        });

        it("should return error if password is exactly 5 characters", () => {
            expect(validateRegistration("John", "test@test.com", "12345", "12345"))
                .toBe("Password must be at least 6 characters.");
        });

        it("should return null if password is exactly 6 characters", () => {
            expect(validateRegistration("John", "test@test.com", "123456", "123456"))
                .toBeNull();
        });
    });

    // ─── registerUserLogic ────────────────────────────────────────────────────
    describe("registerUserLogic", () => {
        it("should create auth user and save to Firestore with 'user' role", async () => {
            const mockUser = { uid: "user123", email: "test@test.com" };
            mockCreateUser.mockResolvedValue({ user: mockUser });

            await registerUserLogic("John Doe", "test@test.com", "password123", {}, {});

            expect(mockCreateUser).toHaveBeenCalled();
            expect(mockSetDoc).toHaveBeenCalled();

            const data = mockSetDoc.mock.calls[0][1];
            expect(data.uid).toBe("user123");
            expect(data.name).toBe("John Doe");
            expect(data.role).toBe("user"); // Critical: never 'admin'
        });

        it("should save the correct email to Firestore", async () => {
            const mockUser = { uid: "user456", email: "alice@test.com" };
            mockCreateUser.mockResolvedValue({ user: mockUser });

            await registerUserLogic("Alice", "alice@test.com", "securePass", {}, {});

            const data = mockSetDoc.mock.calls[0][1];
            expect(data.email).toBe("alice@test.com");
        });

        it("should throw error if Firebase auth fails", async () => {
            mockCreateUser.mockRejectedValue(new Error("Email already in use"));

            await expect(registerUserLogic("John", "test@test.com", "pass", {}, {}))
                .rejects.toThrow("Email already in use");

            // Firestore should NOT be called if auth fails
            expect(mockSetDoc).not.toHaveBeenCalled();
        });

        it("should return the created user on success", async () => {
            const mockUser = { uid: "user789", email: "bob@test.com" };
            mockCreateUser.mockResolvedValue({ user: mockUser });

            const result = await registerUserLogic("Bob", "bob@test.com", "bobpass", {}, {});
            expect(result.uid).toBe("user789");
        });
    });
});