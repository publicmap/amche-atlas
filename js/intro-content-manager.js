/**
 * Intro Modal Content Manager
 * Handles the full-screen intro modal with multilingual support and auto-close functionality
 */

export class IntroContentManager {
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
        en: 'En',
        kok: 'कों'
      },
      contentFiles: [
        {
          en: 'docs/1_intro.en.md',
          kok: 'docs/1_intro.kok.md',
          titles: {
            en: '1.About',
            kok: '1.वळख'
          }
        },
        {
          en: 'docs/2_controls.en.md',
          kok: 'docs/2_controls.kok.md',
          titles: {
            en: '2. Help',
            kok: '2. नकाशाचेर नियंत्रण दवरतात'
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
          renderer.html = function (html) {
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
  }

  createModalHTML() {
    const modalHTML = `
      <sl-dialog id="${this.modalId}" label="Welcome to Amche Goa Map" class="intro-modal" no-header>
        <div class="h-full flex flex-col">
          <!-- Header with help title and language switcher -->
          <div class="flex justify-between items-center">
          <div class="flex gap-2 items-center">
              <sl-radio-group id="language-selector-${this.modalId}" size="small" value="${this.currentLanguage}" class="language-radio-group">
                ${Object.entries(this.config.languages).map(([code, name]) => 
                  `<sl-radio-button value="${code}">${name}</sl-radio-button>`
                ).join('')}
              </sl-radio-group>
            </div>  
          <div class="flex items-center gap-2 text-xl intro-title">
              <div class="text-center">
                <div class="text-base font-normal">amche.in</div>
                <div class="text-xl font-bold">Interactive 3D Atlas</div>
              </div>
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
    const languageSelector = modal.querySelector(`#language-selector-${this.modalId}`);

    // Close button
    closeBtn.addEventListener('click', () => {
      this.closeModal();
    });

    // Language switcher - handle both hover and click
    const radioButtons = languageSelector.querySelectorAll('sl-radio-button');
    let hoverTimeout = null;
    let originalLanguage = this.currentLanguage;

    // Handle hover for quick preview
    radioButtons.forEach(button => {
      button.addEventListener('mouseenter', () => {
        const previewLang = button.value;
        if (previewLang !== this.currentLanguage) {
          // Clear any existing timeout
          if (hoverTimeout) {
            clearTimeout(hoverTimeout);
          }
          
          // Switch language after a short delay to avoid rapid switching
          hoverTimeout = setTimeout(() => {
            this.switchLanguage(previewLang);
          }, 200);
        }
      });

      button.addEventListener('mouseleave', () => {
        // Clear timeout if mouse leaves before delay
        if (hoverTimeout) {
          clearTimeout(hoverTimeout);
          hoverTimeout = null;
        }
      });
    });

    // Handle mouse leave from entire radio group - revert if not clicked
    languageSelector.addEventListener('mouseleave', () => {
      if (hoverTimeout) {
        clearTimeout(hoverTimeout);
        hoverTimeout = null;
      }
      
      // Only revert if the current language is different from the originally selected one
      // and no actual selection was made (radio group value hasn't changed)
      if (this.currentLanguage !== originalLanguage && languageSelector.value === originalLanguage) {
        this.switchLanguage(originalLanguage);
      }
    });

    // Handle actual selection (click) - commit the change
    languageSelector.addEventListener('sl-change', (event) => {
      const newLang = event.target.value;
      originalLanguage = newLang; // Update the "committed" language
      if (newLang !== this.currentLanguage) {
        this.switchLanguage(newLang);
      }
    });

    // Handle clicking outside the close button to cancel auto-close
    modal.addEventListener('click', (event) => {
      // Check if click is outside the close button
      if (!closeBtn.contains(event.target)) {
        this.cancelAutoClose();
      }
    });

    // Handle scrolling in the content area to cancel auto-close
    const contentArea = document.getElementById(this.contentId);
    if (contentArea) {
      contentArea.addEventListener('scroll', () => {
        this.cancelAutoClose();
      });
    }

    // Allow modal to close when clicking outside
    modal.addEventListener('sl-request-close', (event) => {
      // Don't prevent the close event - allow clicking outside to close
      this.closeModal();
    });

    // Keyboard shortcut 'x' to force close the modal
    this.keyboardHandler = (event) => {
      if (event.key === 'x' || event.key === 'X') {
        this.closeModal();
      }
    };
    
    // Add keyboard event listener when modal is shown
    document.addEventListener('keydown', this.keyboardHandler);
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
        
        // For intro sections, don't add the redundant h3 title since the content already has h1
        if (section.isIntroSection) {
          return `
            <section class="p-4 break-inside-avoid">
              <div class="text-sm leading-relaxed max-w-none intro-section-content markdown-content">${htmlContent}</div>
            </section>
          `;
        } else {
          return `
            <section class="p-4 break-inside-avoid">
              <h3 class="mb-4 text-xl font-semibold m-0">${section.title}</h3>
              <div class="text-sm leading-relaxed max-w-none markdown-content">${htmlContent}</div>
            </section>
          `;
        }
      }).join('');
      
      // First details section (about) is open by default
      const isOpen = index === 0 ? 'open' : '';
      
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
      
      if (line.startsWith('# ')) {
        // Handle h1 headings - extract title from first h1 and include it in intro content
        if (!currentSection && introContent.trim() === '') {
          // This is the first h1, use it as the section title but keep the content
          const h1Title = line.replace(/^# /, '').trim();
          introContent += line + '\n';
        } else {
          introContent += line + '\n';
        }
      } else if (line.startsWith('## ')) {
        // Save any intro content before first h2 heading
        if (!currentSection && introContent.trim()) {
          // Extract the first h1 title if it exists, otherwise use a default
          const firstH1Match = introContent.match(/^# (.+)$/m);
          const sectionTitle = firstH1Match ? firstH1Match[1].trim() : 'Introduction';
          
          sections.push({
            title: sectionTitle,
            content: introContent.trim(),
            isIntroSection: true
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
        // Content before first h2 heading
        introContent += line + '\n';
      }
    }
    
    // Add any remaining intro content
    if (!currentSection && introContent.trim()) {
      // Extract the first h1 title if it exists, otherwise use a default
      const firstH1Match = introContent.match(/^# (.+)$/m);
      const sectionTitle = firstH1Match ? firstH1Match[1].trim() : 'Introduction';
      
      sections.push({
        title: sectionTitle,
        content: introContent.trim(),
        isIntroSection: true
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
        
        // Fix relative image paths to be relative to the site root
        html = this.fixImagePaths(html);
        
        return html;
      } catch (error) {
        console.error('Error parsing markdown:', error);
        return this.fallbackMarkdownToHtml(markdown);
      }
    } else {
      return this.fallbackMarkdownToHtml(markdown);
    }
  }

  fixImagePaths(html) {
    // Get the current base path from the window location
    // This handles both local development and deployed environments
    const currentPath = window.location.pathname;
    let basePath = '';
    
    // If we're in a subdirectory (like /dev/), extract that as the base path
    if (currentPath !== '/' && currentPath !== '') {
      const pathParts = currentPath.split('/').filter(part => part !== '');
      if (pathParts.length > 0 && pathParts[pathParts.length - 1] !== 'index.html') {
        // If the last part is not index.html, it might be a directory
        if (!currentPath.endsWith('/')) {
          // Remove the last part if it's likely a file
          pathParts.pop();
        }
        basePath = '/' + pathParts.join('/');
        if (basePath !== '/' && !basePath.endsWith('/')) {
          basePath += '/';
        }
      }
    }
    
    // Fix relative image paths that start with ../
    // Convert ../assets/img/file.gif to /dev/assets/img/file.gif (or just /assets/img/file.gif for root)
    html = html.replace(/src="\.\.\/([^"]+)"/g, (match, relativePath) => {
      const fixedPath = basePath + relativePath;
      return `src="${fixedPath}"`;
    });
    
    // Also handle markdown image syntax in case it wasn't converted yet
    html = html.replace(/!\[([^\]]*)\]\(\.\.\/([^)]+)\)/g, (match, alt, relativePath) => {
      const fixedPath = basePath + relativePath;
      return `![${alt}](${fixedPath})`;
    });
    
    return html;
  }

  fallbackMarkdownToHtml(markdown) {
    // Simple fallback markdown to HTML conversion
    let html = markdown
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(.+)$/gm, '<p>$1</p>')
      .replace(/\n/g, '<br>');
    
    // Fix image paths in fallback mode too
    html = this.fixImagePaths(html);
    
    return html;
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
    
    // Update active language radio button
    const languageSelector = document.querySelector(`#language-selector-${this.modalId}`);
    if (languageSelector) {
      languageSelector.value = langCode;
    }
    
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
    
    // Clean up animation classes
    const closeBtn = document.getElementById(this.closeBtnId);
    if (closeBtn) {
      closeBtn.classList.remove('auto-close-button', 'draining');
    }
    
    // Remove keyboard event listener to prevent memory leaks
    if (this.keyboardHandler) {
      document.removeEventListener('keydown', this.keyboardHandler);
      this.keyboardHandler = null;
    }
    
    // Mark that the modal has been shown at least once
    // This prevents auto-close from being enabled on subsequent opens
    IntroContentManager.hasBeenShown = true;
  }

  startAutoCloseTimer() {
    this.stopAutoCloseTimer(); // Clear any existing timer
    this.stopCountdownTimer(); // Clear any existing countdown
    
    let remainingTime = this.autoCloseDelay / 1000; // Convert to seconds
    const closeBtnText = document.querySelector(`#${this.closeBtnId} .close-btn-text`);
    const closeBtn = document.getElementById(this.closeBtnId);
    
    // Add animation classes to the button
    closeBtn.classList.add('auto-close-button', 'draining');
    
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
    const closeBtn = document.getElementById(this.closeBtnId);
    
    if (closeBtnText) {
      closeBtnText.textContent = 'Close';
    }
    
    // Remove animation classes
    if (closeBtn) {
      closeBtn.classList.remove('auto-close-button', 'draining');
    }
    
    // Disable auto-close for this session
    this.autoCloseEnabled = false;
  }
}

// Static property to track if modal has been shown before
IntroContentManager.hasBeenShown = false;
