import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkAdminRole, updateProductLogic, sanitizeInput } from "./Edit_Product.js";

const { mockGetDoc, mockGetDocs, mockUpdateDoc, mockAddDoc, mockDoc, mockCollection } = vi.hoisted(() => ({
    mockGetDoc: vi.fn(),
    mockGetDocs: vi.fn(),
    mockUpdateDoc: vi.fn(),
    mockAddDoc: vi.fn(),
    mockDoc: vi.fn(),
    mockCollection: vi.fn()
}));

vi.mock("firebase/firestore", () => ({
    getFirestore: vi.fn(),
    doc: mockDoc,
    getDoc: mockGetDoc,
    updateDoc: mockUpdateDoc,
    collection: mockCollection,
    getDocs: mockGetDocs,
    addDoc: mockAddDoc,
    query: vi.fn(),
    where: vi.fn(),
    serverTimestamp: () => "MOCK_TIME"
}));

vi.mock("firebase/auth", () => ({
    getAuth: vi.fn(),
    onAuthStateChanged: vi.fn(),
    signOut: vi.fn()
}));

describe("Edit Product Logic", () => {

    beforeEach(() => vi.clearAllMocks());

    // ─── checkAdminRole ───────────────────────────────────────────────────────
    describe("checkAdminRole", () => {
        it("should return true for Admin role (mixed case)", async () => {
            mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: 'Admin' }) });
            expect(await checkAdminRole("uid1", {})).toBe(true);
        });

        it("should return false for non-admin role", async () => {
            mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: 'user' }) });
            expect(await checkAdminRole("uid1", {})).toBe(false);
        });

        it("should return false when document does not exist", async () => {
            mockGetDoc.mockResolvedValue({ exists: () => false });
            expect(await checkAdminRole("uid1", {})).toBe(false);
        });

        it("should return false on Firestore error", async () => {
            mockGetDoc.mockRejectedValue(new Error("Network error"));
            expect(await checkAdminRole("uid1", {})).toBe(false);
        });
    });

    // ─── updateProductLogic ───────────────────────────────────────────────────
    describe("updateProductLogic", () => {
        it("should update product and log activity on success", async () => {
            mockGetDocs.mockResolvedValue({ empty: true });

            const formData = {
                name: "Updated Laptop",
                price: 999,
                stock: 5,
                category: "Tech",
                description: "A great laptop",
                variations: [],
                attributes: []
            };
            const mockAuth = { currentUser: { email: "admin@test.com" } };

            await updateProductLogic("prod123", formData, {}, mockAuth);

            expect(mockUpdateDoc).toHaveBeenCalled();
            expect(mockAddDoc).toHaveBeenCalled();

            const logData = mockAddDoc.mock.calls[0][1];
            expect(logData.action).toBe("Updated Product");
            expect(logData.target).toBe("Updated Laptop");
        });

        it("should throw if price is negative", async () => {
            await expect(updateProductLogic("p1", { price: -10, stock: 5 }, {}, {}))
                .rejects.toThrow("Price and Stock values cannot be negative.");
            expect(mockUpdateDoc).not.toHaveBeenCalled();
        });

        it("should throw if stock is negative", async () => {
            await expect(updateProductLogic("p1", { price: 10, stock: -1 }, {}, {}))
                .rejects.toThrow("Price and Stock values cannot be negative.");
        });

        it("should throw if a duplicate name exists on a different product", async () => {
            const mockDups = [{ id: "other_id", data: () => ({ name: "Duplicate Name" }) }];
            mockGetDocs.mockResolvedValue({
                empty: false,
                forEach: (cb) => mockDups.forEach(cb)
            });

            await expect(updateProductLogic("current_id", { name: "Duplicate Name", price: 10, stock: 5 }, {}, {}))
                .rejects.toThrow(/already exists/);
            expect(mockUpdateDoc).not.toHaveBeenCalled();
        });

        it("should NOT throw for a duplicate name on the SAME product (self-update)", async () => {
            // Same ID returned — not a duplicate
            const mockDups = [{ id: "current_id", data: () => ({ name: "Same Product" }) }];
            mockGetDocs.mockResolvedValue({
                empty: false,
                forEach: (cb) => mockDups.forEach(cb)
            });

            await expect(updateProductLogic("current_id", { name: "Same Product", price: 10, stock: 5, variations: [], attributes: [] }, {}, { currentUser: { email: "a@b.com" } }))
                .resolves.toBeDefined();
        });

        it("should log 'Admin' as user when auth.currentUser is null", async () => {
            mockGetDocs.mockResolvedValue({ empty: true });
            await updateProductLogic("p1", { name: "Item", price: 10, stock: 5, variations: [], attributes: [] }, {}, { currentUser: null });

            const logData = mockAddDoc.mock.calls[0][1];
            expect(logData.user).toBe("Admin");
        });
    });

    // ─── sanitizeInput ────────────────────────────────────────────────────────
    describe("sanitizeInput", () => {
        it("should escape < and > characters", () => {
            expect(sanitizeInput("<script>alert('xss')</script>"))
                .toBe("&lt;script&gt;alert('xss')&lt;/script&gt;");
        });

        it("should return empty string for falsy input", () => {
            expect(sanitizeInput("")).toBe("");
            expect(sanitizeInput(null)).toBe("");
            expect(sanitizeInput(undefined)).toBe("");
        });

        it("should convert non-string types to string", () => {
            expect(sanitizeInput(42)).toBe("42");
            expect(sanitizeInput(true)).toBe("true");
        });

        it("should not alter safe input", () => {
            expect(sanitizeInput("Hello World")).toBe("Hello World");
        });

        it("should handle multiple dangerous characters", () => {
            const result = sanitizeInput("<div><p>Test</p></div>");
            expect(result).not.toContain("<");
            expect(result).not.toContain(">");
        });
    });
});