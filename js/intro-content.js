/**
 * Intro Modal Content Manager
 * Handles the full-screen intro modal with multilingual support and auto-close functionality
 */

class IntroContentManager {
  constructor(options = {}) {
    this.currentLanguage = 'en';
    this.autoCloseTimer = null;
    this.countdownTimer = null;
    this.autoCloseDelay = 10000; // 10 seconds
    this.markedLoaded = false;
    
    // Track if this is the first time showing the modal
    // Auto-close should only happen on the very first load
    this.autoCloseEnabled = options.enableAutoClose !== false && !IntroContentManager.hasBeenShown;
    
    // Generate unique IDs for this instance to avoid conflicts
    this.modalId = `intro-modal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.contentId = `intro-content-${this.modalId}`;
    this.closeBtnId = `close-modal-btn-${this.modalId}`;
    
    // Configuration for intro content files
    this.config = {
      languages: {
        en: 'English',
        kok: 'कोंकणी'
      },
      contentFiles: [
        {
          en: 'docs/1_intro.en.md',
          kok: 'docs/1_intro.kok.md',
          titles: {
            en: 'About',
            kok: 'वळख'
          }
        },
        {
          en: 'docs/0_controls.en.md',
          kok: 'docs/0_controls.kok.md',
          titles: {
            en: 'Help',
            kok: 'नकाशाचेर नियंत्रण दवरतात'
          }
        }
        
      ]
    };
    
    this.init();
  }

  async init() {
    await this.loadMarkdownParser();
    this.createModalHTML();
    this.setupEventListeners();
    await this.loadContent();
    this.showModal();
  }

  async loadMarkdownParser() {
    if (this.markedLoaded || window.marked) {
      this.markedLoaded = true;
      return;
    }

    try {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/marked@14.1.3/marked.min.js';
      script.onload = () => {
        this.markedLoaded = true;
        // Configure marked globally when it loads
        if (window.marked) {
          marked.setOptions({
            breaks: true,
            gfm: true,
            sanitize: false,
            smartLists: true,
            smartypants: false
          });
          
          // For newer versions of marked, we need to configure the renderer to allow HTML
          const renderer = new marked.Renderer();
          renderer.html = function(html) {
            return html;
          };
          
          marked.setOptions({
            renderer: renderer,
            breaks: true,
            gfm: true,
            sanitize: false,
            smartLists: true,
            smartypants: false
          });
        }
      };
      document.head.appendChild(script);
      
      // Wait for script to load
      await new Promise((resolve) => {
        script.onload = resolve;
      });
    } catch (error) {
      console.error('Failed to load marked.js:', error);
    }
  }

  createModalHTML() {
    const modalHTML = `
      <sl-dialog id="${this.modalId}" label="Welcome to Amche Goa Map" class="intro-modal" no-header>
        <div class="h-full flex flex-col">
          <!-- Header with help title and language switcher -->
          <div class="flex justify-between items-center">
          <div class="flex gap-2 items-center">
              ${Object.entries(this.config.languages).map(([code, name]) => 
                `<button class="lang-btn px-2 py-1 rounded transition-all duration-200 cursor-pointer border-none ${code === this.currentLanguage ? 'bg-blue-600 text-white' : 'bg-transparent text-blue-600 hover:bg-blue-100'}" data-lang="${code}">${name}</button>`
              ).join(' | ')}
            </div>  
          <div class="flex items-center gap-2 text-xl font-semibold text-gray-800">
              <span>amche.in - Welcome to Goa's 3D Atlas</span>
            </div>
            
            <div class="flex items-center gap-4">
              <sl-button variant="default" size="small" id="${this.closeBtnId}">
                <sl-icon slot="prefix" name="x-lg"></sl-icon>
                <span class="close-btn-text text-sm">Close</span>
              </sl-button>
            </div>
          </div>

          <!-- Content area -->
          <div class="flex-1 overflow-y-auto mt-4" id="${this.contentId}">
            <div class="flex items-center justify-center h-48 text-gray-500">Loading content...</div>
          </div>
        </div>
      </sl-dialog>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
  }

  setupEventListeners() {
    const modal = document.getElementById(this.modalId);
    const closeBtn = document.getElementById(this.closeBtnId);
    const langButtons = modal.querySelectorAll('.lang-btn');

    // Close button
    closeBtn.addEventListener('click', () => {
      this.closeModal();
    });

    // Language switcher
    langButtons.forEach(btn => {
      btn.addEventListener('click', (event) => {
        const newLang = event.target.dataset.lang;
        if (newLang !== this.currentLanguage) {
          this.switchLanguage(newLang);
        }
      });
    });

    // Handle clicking outside the close button to cancel auto-close
    modal.addEventListener('click', (event) => {
      // Check if click is outside the close button
      if (!closeBtn.contains(event.target)) {
        this.cancelAutoClose();
      }
    });

    // Allow modal to close when clicking outside
    modal.addEventListener('sl-request-close', (event) => {
      // Don't prevent the close event - allow clicking outside to close
      this.closeModal();
    });
  }

  async loadContent() {
    try {
      const contentPromises = this.config.contentFiles.map(async (fileConfig) => {
        const filePath = fileConfig[this.currentLanguage];
        const response = await fetch(filePath);
        if (!response.ok) throw new Error(`Failed to load ${filePath}`);
        
        const markdownContent = await response.text();
        return {
          content: markdownContent,
          title: fileConfig.titles[this.currentLanguage]
        };
      });
      
      const contentData = await Promise.all(contentPromises);
      this.renderContent(contentData);
    } catch (error) {
      console.error('Error loading intro content:', error);
      this.renderErrorContent();
    }
  }

  renderContent(contentDataArray) {
    const detailsHtml = contentDataArray.map((contentData, index) => {
      const sections = this.parseMarkdownSections(contentData.content);
      
      const sectionsHtml = sections.map(section => {
        const htmlContent = this.markdownToHtml(section.content);
        return `
          <section class="p-4 break-inside-avoid">
            <h3 class="mb-4 text-xl font-semibold m-0">${section.title}</h3>
            <div class="text-sm leading-relaxed prose prose-sm max-w-none prose-headings:text-gray-800 prose-headings:mt-4 prose-headings:mb-2 prose-p:mb-4 prose-ul:mb-4 prose-ol:mb-4 prose-ul:pl-6 prose-ol:pl-6 prose-li:mb-1 prose-strong:text-gray-900 prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:font-mono prose-img:max-w-full prose-img:h-auto prose-img:rounded prose-img:my-2 prose-img:mx-1 prose-img:inline prose-img:align-middle prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline">${htmlContent}</div>
          </section>
        `;
      }).join('');
      
      // Second details section (controls) is open by default
      const isOpen = index === 1 ? 'open' : '';
      
      return `
        <sl-details summary="${contentData.title}" ${isOpen}>
          <div class="leading-relaxed text-gray-700">
            <div class="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
              ${sectionsHtml}
            </div>
          </div>
        </sl-details>
      `;
    }).join('');
    
    const html = `
      <div class="details-group-example space-y-1">
        ${detailsHtml}
      </div>
    `;
    
    document.getElementById(this.contentId).innerHTML = html;
    
    // Set up accordion behavior - close all other details when one is shown
    const container = document.querySelector('.details-group-example');
    if (container) {
      container.addEventListener('sl-show', event => {
        if (event.target.localName === 'sl-details') {
          [...container.querySelectorAll('sl-details')].forEach(details => {
            details.open = event.target === details;
          });
        }
      });
    }
  }

  parseMarkdownSections(markdown) {
    const sections = [];
    const lines = markdown.split('\n');
    let currentSection = null;
    let introContent = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.startsWith('## ')) {
        // Save any intro content before first heading
        if (!currentSection && introContent.trim()) {
          sections.push({
            title: 'Introduction',
            content: introContent.trim()
          });
          introContent = '';
        }
        
        // Save previous section if exists
        if (currentSection) {
          sections.push({
            title: currentSection.title,
            content: currentSection.content.trim()
          });
        }
        
        // Start new section
        currentSection = {
          title: line.replace(/^## /, '').trim(),
          content: ''
        };
      } else if (currentSection) {
        currentSection.content += line + '\n';
      } else {
        // Content before first heading
        introContent += line + '\n';
      }
    }
    
    // Add any remaining intro content
    if (!currentSection && introContent.trim()) {
      sections.push({
        title: 'Introduction',
        content: introContent.trim()
      });
    }
    
    // Add the last section
    if (currentSection) {
      sections.push({
        title: currentSection.title,
        content: currentSection.content.trim()
      });
    }
    
    return sections;
  }


  markdownToHtml(markdown) {
    if (window.marked) {
      try {
        let html = marked.parse(markdown);
         
        // Post-process to unescape HTML entities in specific cases
        html = html.replace(/&lt;span([^&]*?)&gt;/g, '<span$1>');
        html = html.replace(/&lt;\/span&gt;/g, '</span>');
        html = html.replace(/&lt;button([^&]*?)&gt;/g, '<button$1>');
        html = html.replace(/&lt;\/button&gt;/g, '</button>');
        html = html.replace(/&quot;/g, '"');
        
        return html;
      } catch (error) {
        console.error('Error parsing markdown:', error);
        return this.fallbackMarkdownToHtml(markdown);
      }
    } else {
      return this.fallbackMarkdownToHtml(markdown);
    }
  }

  fallbackMarkdownToHtml(markdown) {
    // Simple fallback markdown to HTML conversion
    return markdown
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(.+)$/gm, '<p>$1</p>')
      .replace(/\n/g, '<br>');
    // Note: HTML elements like <button> and <span> are preserved as-is in fallback
  }

  renderErrorContent() {
    document.getElementById(this.contentId).innerHTML = `
      <div class="flex items-center justify-center h-48 text-red-600">
        <p>Unable to load intro content. Please try refreshing the page.</p>
      </div>
    `;
  }

  async switchLanguage(langCode) {
    this.currentLanguage = langCode;
    
    // Update active language button
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === langCode);
    });
    
    // Reload content
    await this.loadContent();
  }

  showModal() {
    const modal = document.getElementById(this.modalId);
    modal.show();
    
    if (this.autoCloseEnabled) {
      this.startAutoCloseTimer();
    }
  }

  closeModal() {
    const modal = document.getElementById(this.modalId);
    modal.hide();
    this.stopAutoCloseTimer();
    this.stopCountdownTimer();
    
    // Mark that the modal has been shown at least once
    // This prevents auto-close from being enabled on subsequent opens
    IntroContentManager.hasBeenShown = true;
  }

  startAutoCloseTimer() {
    this.stopAutoCloseTimer(); // Clear any existing timer
    this.stopCountdownTimer(); // Clear any existing countdown
    
    let remainingTime = this.autoCloseDelay / 1000; // Convert to seconds
    const closeBtnText = document.querySelector(`#${this.closeBtnId} .close-btn-text`);
    
    // Update countdown every second
    this.countdownTimer = setInterval(() => {
      remainingTime--;
      if (remainingTime > 0) {
        closeBtnText.textContent = `Closing in ${remainingTime}s...`;
      } else {
        clearInterval(this.countdownTimer);
      }
    }, 1000);
    
    // Set main timer to close modal
    this.autoCloseTimer = setTimeout(() => {
      this.closeModal();
    }, this.autoCloseDelay);
  }

  stopAutoCloseTimer() {
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
  }

  stopCountdownTimer() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  cancelAutoClose() {
    this.stopAutoCloseTimer();
    this.stopCountdownTimer();
    
    // Reset button text to normal
    const closeBtnText = document.querySelector(`#${this.closeBtnId} .close-btn-text`);
    if (closeBtnText) {
      closeBtnText.textContent = 'Close';
    }
    
    // Disable auto-close for this session
    this.autoCloseEnabled = false;
  }
}

// Static property to track if modal has been shown before
IntroContentManager.hasBeenShown = false;

// Minimal CSS for elements that can't be handled with Tailwind alone
const styles = `
<style>
.intro-modal::part(panel) {
  max-width: 95vw;
  max-height: 95vh;
  width: 100%;
  height: 100%;
}

/* GPS icon styling for background images */
.prose span[style*="background-image"] {
  display: inline-block;
  width: 20px;
  height: 20px;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  vertical-align: middle;
  margin: 0 4px;
}

/* Accordion spacing */
.details-group-example sl-details:not(:last-of-type) {
  margin-bottom: var(--sl-spacing-2x-small);
}
</style>
`;

// Add styles to document
document.head.insertAdjacentHTML('beforeend', styles);

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new IntroContentManager();
  });
} else {
  new IntroContentManager();
}

// Export for manual initialization if needed
window.IntroContentManager = IntroContentManager;