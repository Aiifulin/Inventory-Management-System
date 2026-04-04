import { describe, it, expect, vi, beforeEach } from "vitest";
import { 
    checkAdminRole, 
    fetchProductsLogic, 
    deleteProductLogic, 
    filterProductsLogic, 
    sortProductsLogic 
} from "./Products.js";

// --- HOISTED MOCKS ---
const { mockGetDocs, mockDeleteDoc, mockAddDoc, mockDoc, mockCollection, mockGetDoc } = vi.hoisted(() => ({
    mockGetDocs: vi.fn(),
    mockDeleteDoc: vi.fn(),
    mockAddDoc: vi.fn(),
    mockDoc: vi.fn(),
    mockCollection: vi.fn(),
    mockGetDoc: vi.fn()
}));

// --- MOCK FIREBASE ---
vi.mock("firebase/firestore", () => ({
    getFirestore: vi.fn(),
    collection: mockCollection,
    getDocs: mockGetDocs,
    deleteDoc: mockDeleteDoc,
    doc: mockDoc,
    addDoc: mockAddDoc,
    getDoc: mockGetDoc,
    serverTimestamp: () => "MOCK_TIME"
}));

describe("Product List Logic", () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    // TEST 1: Admin Check
    it("should return true for admin role", async () => {
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ role: 'admin' })
        });
        const result = await checkAdminRole("uid1", {});
        expect(result).toBe(true);
    });

    // TEST 2: Fetching Data
    it("should fetch and format products", async () => {
        const mockData = [
            { id: "1", data: () => ({ name: "Apple", price: 10 }) },
            { id: "2", data: () => ({ name: "Banana", price: 5 }) }
        ];
        mockGetDocs.mockResolvedValue({
            forEach: (cb) => mockData.forEach(cb)
        });

        const products = await fetchProductsLogic({});
        expect(products.length).toBe(2);
        expect(products[0].name).toBe("Apple");
        expect(products[0].id).toBe("1");
    });

    // TEST 3: Deletion Logic
    it("should delete doc and log activity", async () => {
        const mockAllProducts = [{ id: "123", name: "Old Phone" }];
        const mockAuth = { currentUser: { email: "admin@test.com" } };

        await deleteProductLogic("123", mockAllProducts, {}, mockAuth);

        expect(mockDeleteDoc).toHaveBeenCalled();
        expect(mockAddDoc).toHaveBeenCalled(); // Activity Log
        
        // --- FIX IS HERE: Use .mock.calls instead of .calls ---
        const logCallArgs = mockAddDoc.mock.calls[0];
        const logData = logCallArgs[1]; // The second argument is the data object

        expect(logData.action).toBe("Deleted Product");
        expect(logData.target).toBe("Old Phone");
    });

    // TEST 4: Filtering Logic
    it("should filter by search text correctly", () => {
        const products = [
            { name: "Gaming Mouse", category: "Electronics" },
            { name: "Office Chair", category: "Furniture" }
        ];
        
        const filters = { 
            searchVal: "mouse", 
            catVal: "", 
            priceRangeVal: "", 
            statusVal: "" 
        };

        const result = filterProductsLogic(products, filters);
        expect(result.length).toBe(1);
        expect(result[0].name).toBe("Gaming Mouse");
    });

    // TEST 5: Sorting Logic
    it("should sort by price ascending", () => {
        const products = [
            { name: "A", price: 100 },
            { name: "B", price: 50 },
            { name: "C", price: 200 }
        ];

        const sorted = sortProductsLogic(products, 'price', 'asc');
        
        expect(sorted[0].price).toBe(50);  // Lowest
        expect(sorted[1].price).toBe(100);
        expect(sorted[2].price).toBe(200); // Highest
    });
});