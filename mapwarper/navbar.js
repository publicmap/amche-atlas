/**
 * Navbar component for amche/mapwarper
 * Renders a 30px height navbar with clickable title link
 * @param {Object} options - Configuration options for the navbar
 * @param {string} options.titleHtml - HTML content for the title (supports HTML tags like <em>, <strong>, etc.)
 * @param {string} options.href - Link URL for the title (defaults to current page)
 * @param {Function} options.onClick - Click handler function (defaults to page reload)
 * @returns {HTMLElement} The navbar element
 */
function createNavbar(options = {}) {
    // Default configuration
    const config = {
        titleHtml: 'amche warper : align your mapwarper control points easily',
        href: window.location.href,
        onClick: () => window.location.reload(),
        ...options
    };
    
    // Create navbar container
    const navbar = document.createElement('div');
    navbar.className = 'w-full h-8 bg-gray-800 flex items-center px-4 border-b border-gray-700';
    navbar.style.height = '30px'; // Ensure exactly 30px height
    
    // Create clickable title link
    const titleLink = document.createElement('a');
    titleLink.href = config.href;
    titleLink.innerHTML = config.titleHtml; // Use innerHTML to support HTML content
    titleLink.className = 'text-white text-sm hover:text-blue-300 transition-colors duration-200 no-underline cursor-pointer';
    
    // Add click event to refresh page or handle navigation
    titleLink.addEventListener('click', function(e) {
        e.preventDefault();
        // Use configurable onClick handler
        if (typeof config.onClick === 'function') {
            config.onClick(e);
        }
    });
    
    // Append link to navbar
    navbar.appendChild(titleLink);
    
    return navbar;
}

/**
 * Initialize and render the navbar
 * Call this function to add the navbar to the page
 * @param {Element} targetElement - The element to append the navbar to
 * @param {Object} options - Configuration options for the navbar
 * @param {string} options.titleHtml - HTML content for the title (supports HTML tags)
 * @param {string} options.href - Link URL for the title
 * @param {Function} options.onClick - Click handler function
 */
function renderNavbar(targetElement = document.body, options = {}) {
    const navbar = createNavbar(options);
    
    // Insert navbar at the beginning of the target element
    if (targetElement.firstChild) {
        targetElement.insertBefore(navbar, targetElement.firstChild);
    } else {
        targetElement.appendChild(navbar);
    }
    
    return navbar;
}

/**
 * Auto-initialize navbar when DOM is loaded
 */
document.addEventListener('DOMContentLoaded', function() {
    // Only auto-render if this script is included and no navbar exists
    if (!document.querySelector('[data-navbar="mapwarper"]')) {
        const navbar = renderNavbar();
        navbar.setAttribute('data-navbar', 'mapwarper');
    }
});

// Export functions for manual usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        createNavbar,
        renderNavbar
    };
}