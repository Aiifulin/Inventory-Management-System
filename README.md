[![Run Tests](https://github.com/Aiifulin/Inventory-Management-System/actions/workflows/test.yml/badge.svg)](https://github.com/Aiifulin/Inventory-Management-System/actions/workflows/test.yml)

# S/N Variety Inventory Management System 📦

[![Live Demo](https://img.shields.io/badge/Status-Live%20on%20Firebase-039be5?style=for-the-badge&logo=firebase)](https://grouprokuinventorymanagement.web.app/index.html)
[![Vanilla JS](https://img.shields.io/badge/JavaScript-ES6+-yellow?style=for-the-badge&logo=javascript)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Vitest](https://img.shields.io/badge/Testing-Verified-64b5f6?style=for-the-badge&logo=vitest)](https://vitest.dev/)

A comprehensive, full-featured inventory management solution designed for small to medium-sized businesses. Built with a focus on real-time data synchronization, robust security, and a seamless user experience using Vanilla JavaScript and the Firebase suite.

---

## 🌐 Live Access
The system is officially deployed and fully functional at the production URL below:
👉 **[Launch Inventory System](https://grouprokuinventorymanagement.web.app/index.html)**

---

## 🎯 Key Features

### 📦 Product Management
- **Complete CRUD Operations** – Add, edit, archive, and restore products with real-time cloud updates.
- **Bulk Upload Mode** – A specialized queue for efficient batch-adding of multiple items.
- **Dynamic Variations** – Support for custom attributes (size, color, etc.) and integrated cloud storage for images.
- **Stock Intelligence** – Automated low-stock alerts based on user-defined thresholds.

### 📁 Category Organization
- **Dynamic Cataloging** – Organize inventory into custom categories for enhanced searchability.
- **Safe Archiving** – Soft-delete logic for both products and categories to maintain data integrity.

### 🔐 Security & Access Control
- **Secure Authentication** – Robust login and registration workflows powered by Firebase.
- **Role-Based Access (RBAC)** – Sophisticated permission levels distinguishing between **Admin** and **Staff** roles.
- **Route Protection** – Global middleware logic to prevent unauthorized access to restricted views.

### 🛡️ Data Safety & Auditing
- **Activity Logging** – A detailed audit trail tracking every modification with user IDs and timestamps.
- **Recovery Environment** – A dedicated Archive module to prevent accidental permanent data loss.

---

## 🛠️ Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | HTML5, CSS3 (Modern Responsive UI), Vanilla JavaScript |
| **Database** | Google Firebase Firestore (NoSQL) |
| **Auth & Hosting** | Firebase Authentication & Firebase Hosting |
| **Storage** | Firebase Cloud Storage |
| **Testing** | Vitest (Unit & Integration Testing) |
| **CI/CD** | GitHub Actions |

---

## 📂 Project Structure

```text
├── .github/workflows/    # CI/CD pipelines (Testing & Auto-Deploy)
├── public/               # Main Application Source
│   ├── index.html        # Entry point (Login Page)
│   ├── Dashboard.html    # System Overview
│   ├── Products.html     # Inventory Management
│   ├── Archives.html     # Soft-deleted items & recovery
│   ├── css/              # Module-specific stylesheets
│   └── js/               # Application logic & Firebase integration
├── tests/                # Automated Vitest suite
│   ├── *.test.js         # Feature-specific test files
│   └── *.js              # Test helpers and mocks
├── firebase.json         # Firebase Hosting & Security configuration
├── vite.config.js        # Build tool & Vitest configuration
├── package.json          # Dependencies & scripts
└── README.md             # Project documentation
```

---

## 👨‍💻 Project Proponents

* **Justine G. Mendoza** – *Lead Developer*
* **Charles Reuben Dimalaluan** – *Developer*
* **Seanne Stiffel T. Sintay** – *Developer*
* **Michael Daniel M. Milallos** – *Quality Assurance*

---

## 📄 Project Context
Developed as a project for the **Bachelor of Science in Computer Science** curriculum at **Taguig City University**.
