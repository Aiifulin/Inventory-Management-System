import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// CHANGE: Import from your local file, not the URL version
// Ensure your source file is named 'Add_Product.js' and exports the functions
import { checkAdminRole, handleFormSubmit, sanitizeInput } from "./Add_Product.js";

// 1. SETUP HOISTED MOCKS
// We create the mock functions here so they exist BEFORE vi.mock runs
const { 
    mockGetDoc, 
    mockAddDoc, 
    mockGetDocs, 
    mockDoc, 
    mockCollection, 
    mockQuery 
} = vi.hoisted(() => {
    return {
        mockGetDoc: vi.fn(),
        mockAddDoc: vi.fn(),
        mockGetDocs: vi.fn(),
        mockDoc: vi.fn(),
        mockCollection: vi.fn(),
        mockQuery: vi.fn()
    };
});

// 2. MOCK FIREBASE
vi.mock("firebase/firestore", async () => {
    return {
        getFirestore: vi.fn(),
        collection: mockCollection,     // Now this variable exists!
        addDoc: mockAddDoc,
        serverTimestamp: () => "MOCK_TIMESTAMP",
        query: mockQuery,
        where: vi.fn(),
        getDocs: mockGetDocs,
        doc: mockDoc,
        getDoc: mockGetDoc,
        initializeApp: vi.fn()
    };
});

vi.mock("firebase/auth", () => ({
    getAuth: vi.fn(),
    onAuthStateChanged: vi.fn(),
    signOut: vi.fn()
}));

// 3. TEST SUITE
describe("Product Management Logic", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        
        // Setup a Mock DOM for form tests
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
        
        // Mock window methods that might cause crashes
        window.alert = vi.fn();
        window.confirm = vi.fn(() => true);
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    // --- TEST: Admin Role Checking ---
    describe("checkAdminRole", () => {
        it("should return true if user role is 'admin'", async () => {
            // Mock DB response
            mockGetDoc.mockResolvedValue({
                exists: () => true,
                data: () => ({ role: 'admin' })
            });

            const isAdmin = await checkAdminRole("user123", {});
            expect(isAdmin).toBe(true);
        });

        it("should return false if user role is 'user'", async () => {
            mockGetDoc.mockResolvedValue({
                exists: () => true,
                data: () => ({ role: 'user' })
            });

            const isAdmin = await checkAdminRole("user123", {});
            expect(isAdmin).toBe(false);
        });
    });

    // --- TEST: Form Submission ---
    describe("handleFormSubmit", () => {
        const mockAuth = { currentUser: { uid: "123", email: "admin@test.com" } };
        const mockDb = {};

        it("should successfully add a product if data is valid", async () => {
            // Mock "No duplicates found"
            mockGetDocs.mockResolvedValue({ empty: true });
            
            // Execute
            const result = await handleFormSubmit(null, mockAuth, mockDb);

            // Assertions
            expect(result.success).toBe(true);
            expect(mockAddDoc).toHaveBeenCalledTimes(2); // Once for product, once for activity log
        });

        it("should throw error if product name already exists", async () => {
            // Mock "Duplicate found"
            mockGetDocs.mockResolvedValue({ empty: false });

            await expect(handleFormSubmit(null, mockAuth, mockDb))
                .rejects
                .toThrow(/already exists/); // Regex matching strictly or loosely
            
            expect(mockAddDoc).not.toHaveBeenCalled();
        });
    });

    // --- TEST: Sanitization ---
    describe("sanitizeInput", () => {
        it("should escape HTML tags", () => {
            const unsafe = "<script>alert('xss')</script>";
            const safe = sanitizeInput(unsafe);
            expect(safe).toBe("&lt;script&gt;alert('xss')&lt;/script&gt;");
        });
    });
});