import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkAdminRole, handleFormSubmit, sanitizeInput, logActivity } from "./Add_Product.js";

const { mockGetDoc, mockAddDoc, mockGetDocs, mockDoc, mockCollection, mockQuery } = vi.hoisted(() => ({
    mockGetDoc: vi.fn(),
    mockAddDoc: vi.fn(),
    mockGetDocs: vi.fn(),
    mockDoc: vi.fn(),
    mockCollection: vi.fn(),
    mockQuery: vi.fn()
}));

vi.mock("firebase/firestore", () => ({
    getFirestore: vi.fn(),
    collection: mockCollection,
    addDoc: mockAddDoc,
    serverTimestamp: () => "MOCK_TIMESTAMP",
    query: mockQuery,
    where: vi.fn(),
    getDocs: mockGetDocs,
    doc: mockDoc,
    getDoc: mockGetDoc,
    initializeApp: vi.fn()
}));

vi.mock("firebase/auth", () => ({
    getAuth: vi.fn(),
    onAuthStateChanged: vi.fn(),
    signOut: vi.fn()
}));

describe("Add Product Logic", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = `
            <form>
                <input name="productName" value="Test Product" />
                <input name="price" type="number" value="100" />
                <input name="stock" type="number" value="50" />
                <input name="threshold" type="number" value="5" />
                <textarea>Test Description</textarea>
                <select><option value="Gaming" selected>Gaming</option></select>
                <button class="btn-submit">Add Product</button>
            </form>
        `;
        window.alert   = vi.fn();
        window.confirm = vi.fn(() => true);
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    // ─── checkAdminRole ───────────────────────────────────────────────────────
    describe("checkAdminRole", () => {
        it("should return true for 'admin' role", async () => {
            mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: 'admin' }) });
            expect(await checkAdminRole("uid123", {})).toBe(true);
        });

        it("should return false for 'user' role", async () => {
            mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: 'user' }) });
            expect(await checkAdminRole("uid123", {})).toBe(false);
        });

        it("should return false when user document missing", async () => {
            mockGetDoc.mockResolvedValue({ exists: () => false });
            expect(await checkAdminRole("uid123", {})).toBe(false);
        });

        it("should return false on Firestore error", async () => {
            mockGetDoc.mockRejectedValue(new Error("err"));
            expect(await checkAdminRole("uid123", {})).toBe(false);
        });
    });

    // ─── handleFormSubmit ─────────────────────────────────────────────────────
    describe("handleFormSubmit", () => {
        const mockAuth = { currentUser: { uid: "123", email: "admin@test.com" } };
        const mockDb   = {};

        it("should successfully save a product when data is valid", async () => {
            mockGetDocs.mockResolvedValue({ empty: true });
            const result = await handleFormSubmit(null, mockAuth, mockDb);

            expect(result.success).toBe(true);
            // Once for product, once for activity log
            expect(mockAddDoc).toHaveBeenCalledTimes(2);
        });

        it("should throw when product name already exists", async () => {
            mockGetDocs.mockResolvedValue({ empty: false });
            await expect(handleFormSubmit(null, mockAuth, mockDb))
                .rejects.toThrow(/already exists/);
            expect(mockAddDoc).not.toHaveBeenCalled();
        });

        it("should throw when price is negative", async () => {
            document.querySelector('input[name="price"]').value = "-10";
            mockGetDocs.mockResolvedValue({ empty: true });
            await expect(handleFormSubmit(null, mockAuth, mockDb))
                .rejects.toThrow("Price and Stock values cannot be negative.");
        });

        it("should throw when stock is negative", async () => {
            document.querySelector('input[name="stock"]').value = "-5";
            mockGetDocs.mockResolvedValue({ empty: true });
            await expect(handleFormSubmit(null, mockAuth, mockDb))
                .rejects.toThrow("Price and Stock values cannot be negative.");
        });

        it("should proceed with zero price when user confirms", async () => {
            document.querySelector('input[name="price"]').value = "0";
            window.confirm = vi.fn(() => true);
            mockGetDocs.mockResolvedValue({ empty: true });
            const result = await handleFormSubmit(null, mockAuth, mockDb);
            expect(result.success).toBe(true);
        });

        it("should include the correct category in saved data", async () => {
            mockGetDocs.mockResolvedValue({ empty: true });
            const result = await handleFormSubmit(null, mockAuth, mockDb);
            expect(result.data.category).toBe("Gaming");
        });
    });

    // ─── sanitizeInput ────────────────────────────────────────────────────────
    describe("sanitizeInput", () => {
        it("should escape HTML tags to prevent XSS", () => {
            expect(sanitizeInput("<script>alert('xss')</script>"))
                .toBe("&lt;script&gt;alert('xss')&lt;/script&gt;");
        });

        it("should return empty string for null/undefined", () => {
            expect(sanitizeInput(null)).toBe("");
            expect(sanitizeInput(undefined)).toBe("");
        });

        it("should convert numbers to string safely", () => {
            expect(sanitizeInput(42)).toBe("42");
        });

        it("should not alter strings without HTML", () => {
            expect(sanitizeInput("Clean input")).toBe("Clean input");
        });
    });

    // ─── logActivity ──────────────────────────────────────────────────────────
    describe("logActivity", () => {
        it("should call addDoc with correct action and target", async () => {
            const mockUser = { email: "admin@test.com" };
            mockAddDoc.mockResolvedValue({});

            const result = await logActivity("Added Product", "Gaming Chair", mockUser, {});
            expect(result).toBe(true);
            expect(mockAddDoc).toHaveBeenCalled();

            const logData = mockAddDoc.mock.calls[0][1];
            expect(logData.action).toBe("Added Product");
            expect(logData.target).toBe("Gaming Chair");
            expect(logData.user).toBe("admin@test.com");
        });

        it("should use 'Admin' as user when user is null", async () => {
            mockAddDoc.mockResolvedValue({});
            await logActivity("Added Product", "Test Item", null, {});
            const logData = mockAddDoc.mock.calls[0][1];
            expect(logData.user).toBe("Admin");
        });

        it("should return false when addDoc throws", async () => {
            mockAddDoc.mockRejectedValue(new Error("Firestore error"));
            const result = await logActivity("Test", "Item", null, {});
            expect(result).toBe(false);
        });
    });
});