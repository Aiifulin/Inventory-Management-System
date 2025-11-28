        const hamburger = document.querySelector('.hamburger');
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.overlay');
        const navLinks = document.querySelectorAll('.nav-link');
        const bodyEl = document.body;
        const closeBtn = document.querySelector('.close-btn');
        const isMobile = () => window.matchMedia('(max-width: 768px)').matches; // this returns true if viewport is 768px or less for mobile


        /**It opens the sidebar navigation menu,
         * It applies classes for visual display, disables main body scrolling,
         * hides the hamburger icon, and manages keyboard focus for accessibility. */ 
        function openSidebar() {
            sidebar.classList.add('open');
            overlay.classList.add('show');
            bodyEl.classList.add('no-scroll');
            hamburger.classList.add('hidden');
            closeBtn.focus();
        }

        /**It closes the sidebar navigation menu,
         * removes visual display classes, re-enables main body scrolling,
         * shows the hamburger icon, and returns keyboard focus to the hamburger icon for accessibility. */
        function closeSidebar() {
            sidebar.classList.remove('open');
            overlay.classList.remove('show');
            bodyEl.classList.remove('no-scroll');
            hamburger.classList.remove('hidden');
            hamburger.focus();
        }

        /* --- Event Listeners for Interaction --- */

        // This makes sure the sidebar opens only on mobile devices
        hamburger.addEventListener('click', () => { if (isMobile()) openSidebar(); });

        closeBtn.addEventListener('click', closeSidebar);
        overlay.addEventListener('click', closeSidebar);

        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                navLinks.forEach(l => l.classList.remove('active'));
                link.classList.add('active');
                if (isMobile()) closeSidebar();
            });
        });

        // Close sidebar on 'Escape' key press
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
        });

        /* --- Responsive and Initialization Logic --- */

        // Adjust sidebar and hamburger visibility on window resize
        window.addEventListener('resize', () => {
            if (!isMobile()) {
                // Ensure sidebar is closed and hamburger is hidden on larger screens(desktop)
                sidebar.classList.remove('open');
                overlay.classList.remove('show');
                bodyEl.classList.remove('no-scroll');
                hamburger.classList.add('hidden');
            } else {
                // Show hamburger on mobile screens
                hamburger.classList.remove('hidden');
            }
        });

        // It hides the hamburger icon on initial load if not on mobile
        (function init() {
            if (!isMobile()) hamburger.classList.add('hidden');
        })();