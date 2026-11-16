/**
 * DataTable Plugin for Warper Tool
 * Lists every mapwarper / WMF warper map referenced by the atlas configs
 */

class WarperDataTable {
    constructor(options) {
        this.options = {
            configBase: '../config/',
            title: 'Data Table',
            name: ['Name'],
            click: 'URL',
            ...options
        };
        
        this.rows = null;
        this.dataTable = null;
        this.modal = null;
        this.isInitializing = false;
        this.isShowing = false; // Flag to prevent multiple shows
        
        this.init();
    }
    
    async init() {
        if (typeof DataTable === 'undefined' && typeof $.fn.dataTable === 'undefined') {
            console.error('DataTables library not found. Please include DataTables CSS and JS files.');
            return;
        }
        const modalCreated = await this.createModal();
        if (!modalCreated) {
            console.error('Failed to create modal during initialization');
            return;
        }
        this.setupEventListeners();
    }

    async loadAtlasData() {
        const configBase = new URL(this.options.configBase, window.location.href);
        const resolve = (entry) => /^https?:\/\//.test(entry)
            ? entry
            : new URL(`${entry}.atlas.json`, configBase).href;
        try {
            const index = await fetch(new URL('index.atlas.json', configBase)).then(r => r.json());
            const entries = Array.isArray(index.atlases) ? index.atlases : [];
            const atlases = await Promise.all(entries.map(async entry => {
                try {
                    const res = await fetch(resolve(entry));
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    return { id: entry, config: await res.json() };
                } catch (error) {
                    console.warn('Failed to load atlas', entry, error);
                    return null;
                }
            }));
            this.rows = this.extractWarperMaps(atlases.filter(Boolean));
        } catch (error) {
            console.error('Error loading atlas configs:', error);
            this.rows = [];
        }
    }

    extractWarperMaps(atlases) {
        const pattern = /https?:\/\/(mapwarper\.net|warper\.wmflabs\.org)\/(maps|layers|mosaics)\/(?:tile\/|wms\/)?(\d+)/;
        const rows = new Map();
        const walk = (layers, atlasName) => {
            (layers || []).forEach(layer => {
                if (!layer || typeof layer !== 'object') return;
                const match = [layer.url, layer.attribution]
                    .filter(v => typeof v === 'string')
                    .map(v => v.match(pattern))
                    .find(Boolean);
                if (match) {
                    const [, host, kind, id] = match;
                    const isMap = kind === 'maps';
                    const url = `https://${host}/${isMap ? 'maps' : 'layers'}/${id}`;
                    const existing = rows.get(url);
                    if (existing) {
                        if (!existing.Atlas.split(', ').includes(atlasName)) existing.Atlas += `, ${atlasName}`;
                    } else {
                        rows.set(url, {
                            Title: layer.title || layer.id || '',
                            Atlas: atlasName,
                            Type: isMap ? 'Map' : 'Mosaic',
                            Server: host,
                            ID: id,
                            Layer: layer.id || '',
                            URL: url
                        });
                    }
                }
                if (Array.isArray(layer.layers)) walk(layer.layers, atlasName);
            });
        };
        atlases.forEach(({ id, config }) => {
            const atlasId = /^https?:/.test(id) ? id.split('/').pop().replace('.atlas.json', '') : id;
            walk(config.layers, config.name || atlasId);
        });
        return [...rows.values()];
    }

    createModal() {
        // Remove existing modal if it exists
        const existingModal = document.getElementById('warper-datatable-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Clean up any existing event listeners
        this.removeEventListeners();
        
        // Create modal using DOM methods for better reliability
        const modal = document.createElement('div');
        modal.id = 'warper-datatable-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-[9999] hidden';
        
        modal.innerHTML = `
                <div class="flex items-center justify-center min-h-screen p-4">
                    <div class="bg-white rounded-lg shadow-xl w-full max-w-7xl max-h-[90vh] overflow-hidden">
                        <!-- Header -->
                        <div class="bg-blue-600 text-white px-6 py-4 flex justify-between items-center">
                            <div class="flex items-center space-x-4">
                                <h1 class="text-xl font-bold">${this.options.title}</h1>
                            </div>
                            <button id="warper-datatable-close-x" 
                                    class="text-white hover:text-gray-300 text-2xl font-bold">
                                ×
                            </button>
                        </div>
                        
                        <!-- Table Container -->
                        <div class="p-6">
                            <div class="overflow-auto max-h-[calc(90vh-200px)]">
                                <table id="warper-datatable" class="display compact stripe hover cell-border" style="width:100%">
                                    <thead class="bg-gray-50 sticky top-0">
                                        <tr id="warper-datatable-header"></tr>
                                    </thead>
                                    <tbody id="warper-datatable-body"></tbody>
                                </table>
                            </div>
                        </div>
                        
                        <!-- Footer -->
                        <div class="bg-gray-50 px-6 py-3 border-t">
                            <!-- Info row for dataTables_info -->
                            <div id="warper-datatable-info-container" class="mb-3 text-sm text-gray-600">
                                <!-- DataTables info will be moved here -->
                            </div>
                            <!-- Close button row -->
                            <div class="flex justify-end">
                                <button id="warper-datatable-close" 
                                        class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded">
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
        `;
        
        // Append to body
        document.body.appendChild(modal);
        
        // Force DOM reflow to ensure HTML is processed
        document.body.offsetHeight;
        
        this.modal = modal;
        
        // Small delay to ensure DOM is fully processed
        return new Promise((resolve) => {
            setTimeout(() => {
                // Verify table element exists in the modal
                const tableElement = document.getElementById('warper-datatable');
                if (!tableElement) {
                    console.error('Table element not found in created modal');
                    console.log('Modal HTML:', this.modal.innerHTML);
                    resolve(false);
                } else {
                    console.log('Modal created successfully with table element');
                    resolve(true);
                }
            }, 20); // Slightly longer delay
        });
    }
    
    setupEventListeners() {
        // Don't set up listeners if they already exist
        if (this.closeHandler) {
            console.log('Event listeners already exist, skipping setup');
            return;
        }
        
        // Remove any existing listeners first to prevent duplicates
        this.removeEventListeners();
        
        // Store references for removal later
        this.closeHandler = () => this.hide();
        this.backdropHandler = (e) => {
            if (e.target === this.modal) {
                this.hide();
            }
        };
        this.escapeHandler = (e) => {
            if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
                this.hide();
            }
        };
        this.buttonHandler = (event) => {
            if (event.target.classList.contains('load-map-btn')) {
                event.stopPropagation();
                const url = event.target.getAttribute('data-url');
                if (url) {
                    // Unescape the URL
                    const decodedUrl = url.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
                    
                    // Fire custom event for loading map
                    const customEvent = new CustomEvent('loadMapwarperUrl', {
                        detail: { url: decodedUrl }
                    });
                    document.dispatchEvent(customEvent);
                    
                    // Auto-close modal
                    this.hide();
                }
            } else if (event.target.classList.contains('view-map-btn')) {
                event.stopPropagation();
                const url = event.target.getAttribute('data-url');
                if (url) {
                    // Unescape the URL
                    const decodedUrl = url.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
                    
                    // Open mapwarper URL in new tab
                    window.open(decodedUrl, '_blank');
                }
            }
        };
        
        // Set up listeners with stored references
        const closeButton = document.getElementById('warper-datatable-close');
        const closeXButton = document.getElementById('warper-datatable-close-x');
        
        closeButton?.addEventListener('click', this.closeHandler);
        closeXButton?.addEventListener('click', this.closeHandler);
        this.modal?.addEventListener('click', this.backdropHandler);
        document.addEventListener('keydown', this.escapeHandler);
        this.modal?.addEventListener('click', this.buttonHandler);
        
        console.log('Event listeners set up successfully');
    }
    
    removeEventListeners() {
        // Remove existing listeners to prevent duplicates
        if (this.closeHandler) {
            const closeButton = document.getElementById('warper-datatable-close');
            const closeXButton = document.getElementById('warper-datatable-close-x');
            
            closeButton?.removeEventListener('click', this.closeHandler);
            closeXButton?.removeEventListener('click', this.closeHandler);
            this.modal?.removeEventListener('click', this.backdropHandler);
            document.removeEventListener('keydown', this.escapeHandler);
            this.modal?.removeEventListener('click', this.buttonHandler);
            
            // Clear handler references
            this.closeHandler = null;
            this.backdropHandler = null;
            this.escapeHandler = null;
            this.buttonHandler = null;
            
            console.log('Event listeners removed');
        }
    }
    
    async show() {
        // Prevent multiple simultaneous shows
        if (this.isShowing) {
            console.log('Modal is already being shown, skipping duplicate call');
            return;
        }
        
        this.isShowing = true;

        if (!this.rows) await this.loadAtlasData();
        if (this.rows.length === 0) {
            this.isShowing = false;
            alert('No mapwarper maps found in the atlas configs.');
            return;
        }
        
        try {
            // Always ensure modal exists and is properly set up
            const existingModal = document.getElementById('warper-datatable-modal');
            if (!existingModal || !this.modal) {
                console.log('Creating/recreating modal...');
                const modalCreated = await this.createModal();
                if (!modalCreated) {
                    console.error('Failed to create modal, aborting show');
                    this.isShowing = false;
                    return;
                }
                this.setupEventListeners();
            }
            
            console.log('Showing modal with', this.rows.length, 'data rows');
            this.modal.classList.remove('hidden');
            
            // Larger delay to ensure modal DOM is fully ready before populating table
            setTimeout(async () => {
                try {
                    await this.populateTable();
                } finally {
                    this.isShowing = false;
                }
            }, 100);
        } catch (error) {
            console.error('Error in show():', error);
            this.isShowing = false;
        }
    }
    
    hide() {
        console.log('hide() called');
        
        if (this.modal) {
            this.modal.classList.add('hidden');
        }
        
        // Reset showing flag
        this.isShowing = false;
        
        // Properly destroy existing DataTable instance
        this.destroyDataTable();
    }
    
    destroyDataTable() {
        if (this.dataTable) {
            try {
                // Destroy DataTable instance
                this.dataTable.destroy(true); // true removes from DOM completely
                this.dataTable = null;
            } catch (error) {
                console.warn('Error destroying DataTable:', error);
                this.dataTable = null;
            }
        }
        
        // Reset initialization flag
        this.isInitializing = false;
    }
    
    async ensureTableStructure() {
        const table = document.getElementById('warper-datatable');
        if (!table) {
            console.error('Table element not found - modal may not be ready yet');
            
            // Check if modal exists at all
            const modal = document.getElementById('warper-datatable-modal');
            if (!modal) {
                console.error('Modal not found in DOM, recreating...');
                const modalCreated = await this.createModal();
                if (!modalCreated) {
                    console.error('Failed to create modal in ensureTableStructure');
                    return false;
                }
                this.setupEventListeners();
                
                // Try again after modal recreation
                const newTable = document.getElementById('warper-datatable');
                if (!newTable) {
                    console.error('Still cannot find table element after modal recreation');
                    return false;
                }
            } else {
                console.error('Modal exists but table element is missing');
                console.log('Modal content:', modal.innerHTML);
                
                // The table element is missing from the modal, let's recreate it directly
                console.log('Recreating table element in existing modal...');
                const tableContainer = modal.querySelector('.overflow-auto');
                if (tableContainer) {
                    tableContainer.innerHTML = `
                        <table id="warper-datatable" class="display compact stripe hover cell-border" style="width:100%">
                            <thead class="bg-gray-50 sticky top-0">
                                <tr id="warper-datatable-header"></tr>
                            </thead>
                            <tbody id="warper-datatable-body"></tbody>
                        </table>
                    `;
                    console.log('Table element recreated in existing modal');
                } else {
                    console.error('Could not find table container in modal');
                    return false;
                }
            }
        }
        
        const currentTable = document.getElementById('warper-datatable');
        if (currentTable) {
            // Clear and recreate the table structure
            currentTable.innerHTML = `
                <thead class="bg-gray-50 sticky top-0">
                    <tr id="warper-datatable-header"></tr>
                </thead>
                <tbody id="warper-datatable-body"></tbody>
            `;
            
            console.log('Table structure recreated successfully');
            return true;
        }
        
        return false;
    }
    
    async populateTable() {
        if (!this.rows || this.rows.length === 0) return;
        
        // Ensure we start with a clean table
        this.destroyDataTable();
        
        // Ensure table structure exists
        const structureReady = await this.ensureTableStructure();
        if (!structureReady) {
            console.error('Cannot ensure table structure exists, aborting populate');
            return;
        }
        
        // Get all unique column names from the data
        const allColumns = new Set();
        this.rows.forEach(row => {
            Object.keys(row).forEach(key => allColumns.add(key));
        });
        const dataColumns = Array.from(allColumns);
        
        // Add action column as first column
        const columns = ['Actions', ...dataColumns];
        
        // Create table header
        let headerRow = document.getElementById('warper-datatable-header');
        if (!headerRow) {
            console.error('Header row element not found, retrying table structure creation');
            const structureReady = await this.ensureTableStructure();
            if (!structureReady) {
                console.error('Failed to recreate table structure');
                return;
            }
            headerRow = document.getElementById('warper-datatable-header');
            if (!headerRow) {
                console.error('Still cannot find header row after recreation');
                return;
            }
        }
        
        headerRow.innerHTML = '';
        columns.forEach(col => {
            const th = document.createElement('th');
            th.textContent = col;
            if (col === 'Actions') {
                th.style.width = '140px';
                th.classList.add('text-center');
            }
            headerRow.appendChild(th);
        });
        
        // Create table body
        let tbody = document.getElementById('warper-datatable-body');
        if (!tbody) {
            console.error('Body element not found, retrying table structure creation');
            const structureReady = await this.ensureTableStructure();
            if (!structureReady) {
                console.error('Failed to recreate table structure');
                return;
            }
            tbody = document.getElementById('warper-datatable-body');
            if (!tbody) {
                console.error('Still cannot find table body after recreation');
                return;
            }
        }
        
        tbody.innerHTML = '';
        this.rows.forEach(row => {
            const tr = document.createElement('tr');
            tr.classList.add('hover:bg-gray-100');
            
            columns.forEach(col => {
                const td = document.createElement('td');
                
                if (col === 'Actions') {
                    // Actions column will be handled by DataTables render function
                    td.innerHTML = ''; // Empty, will be populated by DataTables
                    td.classList.add('text-center');
                } else {
                    td.textContent = row[col] || '';
                }
                tr.appendChild(td);
            });
            
            tbody.appendChild(tr);
        });
        
        // Initialize DataTables with a small delay to ensure DOM is ready
        setTimeout(async () => {
            await this.initDataTable(columns);
        }, 100);
    }
    
    async initDataTable(columns) {
        // Prevent concurrent initializations
        if (this.isInitializing) {
            console.warn('DataTable initialization already in progress, skipping...');
            return;
        }
        
        this.isInitializing = true;
        
        // Destroy existing instance if it exists
        this.destroyDataTable();
        
        // Ensure table structure exists
        const structureReady = await this.ensureTableStructure();
        if (!structureReady) {
            console.error('Cannot create table structure for DataTable initialization');
            this.isInitializing = false;
            return;
        }
        
        // Check if table element already has DataTables initialized
        const tableElement = document.getElementById('warper-datatable');
        if (!tableElement) {
            console.error('Table element not found during DataTable initialization after structure creation');
            this.isInitializing = false;
            return;
        }
        
        if ($.fn.DataTable.isDataTable(tableElement)) {
            console.warn('DataTable already initialized, destroying first...');
            $(tableElement).DataTable().destroy(true);
        }
        
        // Create column definitions for DataTables
        const columnDefs = columns.map((col, index) => {
            const def = {
                title: col,
                targets: index,
                className: 'text-sm'
            };
            
            if (col === 'Actions') {
                // Actions column is not sortable or searchable
                def.data = null;
                def.orderable = false;
                def.searchable = false;
                def.className = 'text-center text-sm';
                def.width = '140px';
                def.render = (data, type, row) => {
                    const mapwarperUrl = row[this.options.click];
                    if (mapwarperUrl && type === 'display') {
                        // Escape the URL for safe HTML attribute usage
                        const escapedUrl = mapwarperUrl.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                        return `
                            <div class="flex space-x-1 justify-center">
                                <button class="load-map-btn bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs font-medium" 
                                        data-url="${escapedUrl}">
                                    Load Map
                                </button>
                                <button class="view-map-btn bg-gray-600 hover:bg-gray-700 text-white px-2 py-1 rounded text-xs font-medium" 
                                        data-url="${escapedUrl}">
                                    View Map
                                </button>
                            </div>
                        `;
                    } else if (type === 'display') {
                        return '<span class="text-gray-400 text-xs">No URL</span>';
                    }
                    return '';
                };
            } else {
                // Regular data columns
                def.data = col;
                // Add search functionality for specified name columns
                if (this.options.name.includes(col)) {
                    def.searchable = true;
                }
            }
            
            return def;
        });
        
        // Initialize DataTables with proper configuration
        const DataTableConstructor = window.DataTable || $.fn.dataTable;
        
        try {
            console.log('Initializing DataTable with', this.rows.length, 'rows and', columns.length, 'columns');
            
            // Store nameColumns for the initComplete function
            const nameColumns = this.options.name;
            
            // First try with simplified configuration to avoid column filter issues
            this.dataTable = new DataTableConstructor('#warper-datatable', {
                data: this.rows,
                columns: columnDefs,
                paging: false, // Show all entries
                searching: true,
                ordering: true,
                info: true,
                responsive: true,
                order: [[1, 'asc']], // Order by first data column (skip action column)
                scrollY: '400px',
                scrollCollapse: true,
                scrollX: true,
                autoWidth: false,
                dom: '<"flex justify-between items-center mb-4"<"flex-1"f><"flex-shrink-0"B>>rtip', // Custom layout: search left, buttons right
                buttons: [
                    {
                        extend: 'colvis',
                        text: 'Show/Hide Columns',
                        className: 'btn btn-secondary btn-sm'
                    }
                ],
                language: {
                    search: "<strong>Search:</strong>",
                    searchPlaceholder: `${this.options.name.join(', ')}...`,
                    info: "Showing all _TOTAL_ entries",
                    infoEmpty: "No entries found",
                    infoFiltered: "(filtered from _MAX_ total entries)",
                    emptyTable: "No data available in table",
                    zeroRecords: "No matching records found"
                },
                columnDefs: [
                    {
                        targets: '_all',
                        className: 'text-sm'
                    }
                ],
                initComplete: function() {
                    try {
                        const api = this.api();
                        console.log('DataTable initComplete called successfully');
                        
                        // Auto-focus the search input and apply custom styling
                        setTimeout(() => {
                            const searchInput = $(api.table().container()).find('.dataTables_filter input');
                            if (searchInput.length) {
                                searchInput.focus();
                                console.log('Search input focused');
                            }
                            
                            // Apply float:left to the filter container
                            $('#warper-datatable_filter').css('float', 'left');
                        }, 100);
                        
                        // Move the dataTables_info element to the footer container
                        setTimeout(() => {
                            const infoElement = $(api.table().container()).find('.dataTables_info');
                            const infoContainer = $('#warper-datatable-info-container');
                            
                            if (infoElement.length && infoContainer.length) {
                                // Move the info element to our custom footer container
                                infoContainer.empty().append(infoElement);
                                
                                // Hide any empty containers that may have held the info element
                                $(api.table().container()).find('.dataTables_wrapper .dataTables_info').parent().each(function() {
                                    if ($(this).is(':empty') || $(this).children().length === 0) {
                                        $(this).hide();
                                    }
                                });
                                
                                console.log('DataTables info element moved to footer');
                            } else {
                                console.warn('Could not find info element or container for moving');
                            }
                        }, 200);
                        
                        // Only add column filters if we have nameColumns defined
                        if (nameColumns && nameColumns.length > 0) {
                            // Create a row for column filters
                            const headerRow = $(api.table().header()).find('tr');
                            const filterRow = $('<tr class="filter-row"></tr>');
                            headerRow.after(filterRow);
                            
                            api.columns().every(function(index) {
                                const column = this;
                                const columnName = columns[index];
                                const isSearchableColumn = columnName && nameColumns.includes(columnName);
                                
                                if (isSearchableColumn) {
                                    // Create search dropdown for specified columns
                                    const select = $(`<select class="w-full p-1 text-xs border border-gray-300 rounded">
                                        <option value="">All ${columnName}</option>
                                    </select>`);
                                    
                                    // Get unique values for this column
                                    const uniqueValues = [];
                                    try {
                                        column.data().unique().sort().each(function(d) {
                                            if (d && d.toString().trim()) {
                                                uniqueValues.push(d.toString().trim());
                                            }
                                        });
                                        
                                        // Add options to select
                                        uniqueValues.forEach(value => {
                                            select.append(`<option value="${value}">${value}</option>`);
                                        });
                                        
                                        // Add change event listener
                                        select.on('change', function() {
                                            const val = $(this).val();
                                            column.search(val ? '^' + $.fn.dataTable.util.escapeRegex(val) + '$' : '', true, false).draw();
                                        });
                                        
                                        filterRow.append($('<th class="p-2"></th>').append(select));
                                    } catch (columnError) {
                                        console.warn('Error processing column:', columnName, columnError);
                                        filterRow.append('<th class="p-2"></th>');
                                    }
                                } else {
                                    // Add empty cell for non-searchable columns (including Actions column)
                                    filterRow.append('<th class="p-2"></th>');
                                }
                            });
                        }
                    } catch (error) {
                        console.warn('Error in initComplete, skipping column filters:', error);
                    }
                }
            });
            
            console.log('DataTable initialized successfully with', this.rows.length, 'rows and', columns.length, 'columns');
        } catch (error) {
            console.error('Error initializing DataTable:', error);
            
            // Don't show the error alert to user, just log it
            console.warn('Main DataTable initialization failed, trying fallback. Error:', error.message);
            
            // Try a much simpler fallback initialization without complex features
            try {
                // Clear any existing DataTable classes or state
                const tableElement = $('#warper-datatable');
                tableElement.removeClass('dataTable');
                
                // Remove any existing DataTable wrapper if present
                if (tableElement.parent().hasClass('dataTables_wrapper')) {
                    tableElement.unwrap();
                }
                
                // Ensure table structure exists before fallback
                const structureReady = await this.ensureTableStructure();
                if (!structureReady) {
                    console.error('Cannot ensure table structure for fallback initialization');
                    throw new Error('Table structure creation failed');
                }
                
                // Try to initialize without complex column definitions
                this.dataTable = tableElement.DataTable({
                    paging: false, // Show all entries
                    searching: true,
                    ordering: true,
                    info: true,
                    destroy: true,
                    responsive: true,
                    scrollY: '400px',
                    scrollCollapse: true,
                    language: {
                        search: "<strong>Search:</strong>",
                        info: "Showing all _TOTAL_ entries",
                        infoFiltered: "(filtered from _MAX_ total entries)",
                        emptyTable: "No data available",
                        zeroRecords: "No matching records found"
                    },
                    initComplete: function() {
                        // Auto-focus search input in fallback mode too
                        setTimeout(() => {
                            const searchInput = $(this.api().table().container()).find('.dataTables_filter input');
                            if (searchInput.length) {
                                searchInput.focus();
                            }
                            
                            // Apply float:left to the filter container in fallback mode
                            $('#warper-datatable_filter').css('float', 'left');
                        }, 100);
                    }
                });
                console.log('Fallback DataTable initialized successfully');
                
            } catch (fallbackError) {
                console.error('Fallback DataTable initialization also failed:', fallbackError);
                
                // Last resort: try the most basic initialization possible
                try {
                    // Ensure table structure exists for basic fallback
                    const structureReady = await this.ensureTableStructure();
                    if (!structureReady) {
                        console.error('Cannot ensure table structure for basic fallback');
                        throw new Error('Table structure creation failed for basic fallback');
                    }
                    
                    this.dataTable = $('#warper-datatable').dataTable({
                        destroy: true,
                        searching: true,
                        paging: false
                    });
                    console.log('Basic DataTable fallback successful');
                } catch (basicError) {
                    console.error('All DataTable initialization methods failed:', basicError);
                    console.log('Table will remain functional as plain HTML table');
                }
            }
        } finally {
            // Always reset the initialization flag
            this.isInitializing = false;
        }
    }
}

// Make it available globally
window.WarperDataTable = WarperDataTable;