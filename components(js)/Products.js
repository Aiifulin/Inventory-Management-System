const products = [
    {
        name: "test product",
        variations: ["Medium", "Small"],
        category: "Kitchenware",
        price: 13.00,
        stock: 233,
        status: "in-stock",
        added: "Dec 5, 2025"
    },
    {
        name: "Ceramic Vase",
        variations: ["Large"],
        category: "Decor",
        price: 24.50,
        stock: 15,
        status: "in-stock",
        added: "Dec 6, 2025"
    }
];

function loadProducts() {
    const tableBody = document.getElementById("productTableBody");
    const mobileList = document.getElementById("mobileProductList");
    
    // Clear both
    tableBody.innerHTML = "";
    mobileList.innerHTML = "";

    products.forEach(p => {
        // Shared Logic
        const tagsHtml = p.variations.map(tag => `<span class="v-tag">${tag}</span>`).join('');
        const statusText = p.status === 'in-stock' ? 'In Stock' : 'Out of Stock';
        
        // -----------------------------
        // 1. RENDER DESKTOP ROW
        // -----------------------------
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>
                <div class="product-cell">
                    <div class="product-img-placeholder"><i class="fa-regular fa-image"></i></div>
                    <div class="product-info">
                        <h4>${p.name}</h4>
                        <div class="variation-tags">${tagsHtml}</div>
                    </div>
                </div>
            </td>
            <td>${p.category}</td>
            <td>$${p.price.toFixed(2)}</td>
            <td>${p.stock}</td>
            <td><span class="status-pill ${p.status}">${statusText}</span></td>
            <td>${p.added}</td>
            <td class="actions">
                <i class="fa-regular fa-eye" title="View"></i>
                <i class="fa-regular fa-pen-to-square" title="Edit"></i>
                <i class="fa-regular fa-trash-can" title="Delete"></i>
            </td>
        `;
        tableBody.appendChild(row);

        // -----------------------------
        // 2. RENDER MOBILE CARD
        // -----------------------------
        const card = document.createElement("div");
        card.className = "mobile-card";
        card.innerHTML = `
            <div class="card-top">
                <div class="card-img"><i class="fa-regular fa-image"></i></div>
                <div class="card-header-text">
                    <h3 class="card-title">${p.name}</h3>
                </div>
                <div class="card-badge">
                    <span class="status-pill ${p.status}">${statusText}</span>
                </div>
            </div>

            <div class="card-tags">
                ${tagsHtml}
            </div>

            <div class="card-details-grid">
                <div class="detail-item">
                    <label>Category:</label>
                    <span>${p.category}</span>
                </div>
                <div class="detail-item">
                    <label>Price:</label>
                    <span>$${p.price.toFixed(2)}</span>
                </div>
                <div class="detail-item">
                    <label>Stock:</label>
                    <span>${p.stock}</span>
                </div>
                <div class="detail-item">
                    <label>Added:</label>
                    <span>${p.added}</span>
                </div>
            </div>

            <div class="card-actions">
                <button class="btn-card-action">
                    <i class="fa-regular fa-eye"></i> View
                </button>
                <button class="btn-card-action">
                    <i class="fa-regular fa-pen-to-square"></i> Edit
                </button>
                <button class="btn-card-action btn-card-delete">
                    <i class="fa-regular fa-trash-can"></i>
                </button>
            </div>
        `;
        mobileList.appendChild(card);
    });
}

document.addEventListener("DOMContentLoaded", loadProducts);