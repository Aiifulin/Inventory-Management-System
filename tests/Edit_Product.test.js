import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkAdminRole, updateProductLogic, sanitizeInput } from "./Edit_Product.js";

// --- HOISTED MOCKS ---
const { mockGetDoc, mockGetDocs, mockUpdateDoc, mockAddDoc, mockDoc, mockCollection } = vi.hoisted(() => ({
    mockGetDoc: vi.fn(),
    mockGetDocs: vi.fn(),
    mockUpdateDoc: vi.fn(),
    mockAddDoc: vi.fn(),
    mockDoc: vi.fn(),
    mockCollection: vi.fn()
}));

// --- MOCK FIREBASE ---
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

describe("Edit Product Logic", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // TEST 1: Admin Role Check
    it("should allow admin user", async () => {
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ role: 'Admin' })
        });
        const result = await checkAdminRole("uid1", {});
        expect(result).toBe(true);
    });

    // TEST 2: Successful Update
    it("should update product and log activity", async () => {
        // Mock "No duplicates found"
        mockGetDocs.mockResolvedValue({ empty: true });
        
        const formData = {
            name: "Updated Laptop",
            price: 999,
            stock: 5,
            category: "Tech",
            variations: [],
            attributes: []
        };
        
        const mockAuth = { currentUser: { email: "admin@test.com" } };

        // Run the function
        await updateProductLogic("prod123", formData, {}, mockAuth);

        // Verify Update was called
        expect(mockUpdateDoc).toHaveBeenCalled();
        
        // Verify Activity Log was called
        expect(mockAddDoc).toHaveBeenCalled();
        
        // --- FIX IS HERE: Use .mock.calls instead of .calls ---
        const logCallArgs = mockAddDoc.mock.calls[0]; // Get arguments of the first call
        const logData = logCallArgs[1];               // The second argument is the data object
        
        expect(logData.action).toBe("Updated Product");
        expect(logData.target).toBe("Updated Laptop");
    });

    // TEST 3: Validation Error (Negative Price)
    it("should fail if price is negative", async () => {
        const formData = { price: -10, stock: 10 };
        
        await expect(updateProductLogic("p1", formData, {}, {}))
            .rejects.toThrow("Price and Stock values cannot be negative");
        
        expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    // TEST 4: Duplicate Check
    it("should fail if name exists on another product", async () => {
        // Mock finding a duplicate document with a DIFFERENT ID
        const mockDuplicateDocs = [
            { id: "other_id", data: () => ({ name: "Duplicate Name" }) }
        ];
        
        mockGetDocs.mockResolvedValue({
            empty: false,
            forEach: (cb) => mockDuplicateDocs.forEach(cb)
        });

        const formData = { name: "Duplicate Name", price: 10 };

        await expect(updateProductLogic("current_id", formData, {}, {}))
            .rejects.toThrow(/already exists/);
            
        expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    // TEST 5: Sanitization
    it("should sanitize inputs", () => {
        const dirty = "<script>alert('hack')</script>";
        const clean = sanitizeInput(dirty);
        expect(clean).toBe("&lt;script&gt;alert('hack')&lt;/script&gt;");
    });
});