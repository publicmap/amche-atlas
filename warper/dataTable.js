/**
 * DataTable Plugin for Warper Tool
 * Displays CSV data in a searchable DataTable modal
 */

class WarperDataTable {
    constructor(options) {
        this.options = {
            url: '',
            title: 'Data Table',
            name: ['Name'],
            type: 'Type',
            click: 'URL',
            ...options
        };
        
        this.csvData = null;
        this.dataTable = null;
        this.modal = null;
        this.isInitializing = false;
        
        // Set up global handlers for button clicks
        this.setupGlobalHandlers();
        
        this.init();
    }
    
    setupGlobalHandlers() {
        // Set up event delegation for button clicks
        document.addEventListener('click', (event) => {
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
        });
    }
    
    async init() {
        // Check if required dependencies are loaded
        if (typeof DataTable === 'undefined' && typeof $.fn.dataTable === 'undefined') {
            console.error('DataTables library not found. Please include DataTables CSS and JS files.');
            return;
        }
        
        await this.loadCSVData();
        this.createModal();
        this.setupEventListeners();
    }
    
    async loadCSVData() {
        try {
            console.log('Loading CSV data from:', this.options.url);
            const response = await fetch(this.options.url, {
                mode: 'cors',
                headers: {
                    'Accept': 'text/csv,text/plain,*/*'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
            }
            
            const csvText = await response.text();
            this.csvData = this.parseCSV(csvText);
            console.log('CSV data loaded successfully:', this.csvData.length, 'rows');
            
            if (this.csvData.length === 0) {
                console.warn('No data found in CSV or parsing failed');
            }
        } catch (error) {
            console.error('Error loading CSV data:', error);
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                console.error('This might be a CORS issue. Make sure the CSV URL allows cross-origin requests.');
            }
            this.csvData = [];
        }
    }
    
    parseCSV(csvText) {
        const lines = csvText.split('\n');
        if (lines.length < 2) return [];
        
        // Parse CSV with proper handling of quoted fields
        const parseCSVLine = (line) => {
            const result = [];
            let current = '';
            let inQuotes = false;
            
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const nextChar = line[i + 1];
                
                if (char === '"') {
                    if (inQuotes && nextChar === '"') {
                        // Escaped quote
                        current += '"';
                        i++; // Skip next quote
                    } else {
                        // Toggle quote state
                        inQuotes = !inQuotes;
                    }
                } else if (char === ',' && !inQuotes) {
                    // End of field
                    result.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            
            // Add the last field
            result.push(current.trim());
            return result;
        };
        
        // Find the header line (look for line with actual column names)
        let headerLineIndex = 0;
        let headers = [];
        
        for (let i = 0; i < Math.min(5, lines.length); i++) {
            const testHeaders = parseCSVLine(lines[i]).map(h => h.replace(/^"|"$/g, '').trim());
            // Look for a line that contains expected column names
            if (testHeaders.some(h => h && (h.includes('Collection') || h.includes('Name') || h.includes('Mapwarper')))) {
                headers = testHeaders;
                headerLineIndex = i;
                break;
            }
        }
        
        // Filter out empty headers and keep track of their positions
        const validHeaders = [];
        const validColumnIndices = [];
        headers.forEach((header, index) => {
            if (header && header.trim()) {
                validHeaders.push(header.trim());
                validColumnIndices.push(index);
            }
        });
        
        console.log('Found headers:', validHeaders);
        console.log('Column indices:', validColumnIndices);
        
        if (validHeaders.length === 0) {
            console.error('No valid headers found. Raw first line:', lines[0]);
            console.error('All test headers:', headers);
        }
        
        // Parse data rows
        const data = [];
        for (let i = headerLineIndex + 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const allValues = parseCSVLine(line).map(v => v.replace(/^"|"$/g, '').trim());
            const row = {};
            
            // Only extract values from valid column positions
            validHeaders.forEach((header, validIndex) => {
                const actualIndex = validColumnIndices[validIndex];
                row[header] = allValues[actualIndex] || '';
            });
            
            // Only add rows that have at least one non-empty value in valid columns
            if (Object.values(row).some(value => value !== '')) {
                data.push(row);
            }
        }
        
        console.log('Parsed data sample:', data.slice(0, 3));
        return data;
    }
    
    createModal() {
        // Remove existing modal if it exists
        const existingModal = document.getElementById('warper-datatable-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Create modal HTML
        const modalHTML = `
            <div id="warper-datatable-modal" class="fixed inset-0 bg-black bg-opacity-50 z-[9999] hidden">
                <div class="flex items-center justify-center min-h-screen p-4">
                    <div class="bg-white rounded-lg shadow-xl w-full max-w-7xl max-h-[90vh] overflow-hidden">
                        <!-- Header -->
                        <div class="bg-blue-600 text-white px-6 py-4 flex justify-between items-center">
                            <div class="flex items-center space-x-4">
                                <h1 class="text-xl font-bold">${this.options.title}</h1>
                                <a href="${this.getGoogleSheetsEditUrl()}" 
                                   target="_blank" 
                                   class="text-blue-200 hover:text-white underline text-sm">
                                    View Sheet
                                </a>
                            </div>
                            <button id="warper-datatable-close-x" 
                                    class="text-white hover:text-gray-300 text-2xl font-bold">
                                ×
                            </button>
                        </div>
                        
                        <!-- Table Container -->
                        <div class="p-6">
                            <div class="overflow-auto max-h-[calc(90vh-200px)] border border-gray-200 rounded">
                                <table id="warper-datatable" class="display compact stripe hover cell-border" style="width:100%">
                                    <thead class="bg-gray-50 sticky top-0">
                                        <tr id="warper-datatable-header"></tr>
                                    </thead>
                                    <tbody id="warper-datatable-body"></tbody>
                                </table>
                            </div>
                        </div>
                        
                        <!-- Footer -->
                        <div class="bg-gray-50 px-6 py-4 flex justify-end">
                            <button id="warper-datatable-close" 
                                    class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.modal = document.getElementById('warper-datatable-modal');
    }
    
    getGoogleSheetsEditUrl() {
        // For the specific Goa Reference Map Index sheet
        // The CSV URL has a different format than the edit URL
        if (this.options.url.includes('2PACX-1vTChLW_Qr9M9huy7LZIlR3-1_JW_8hmospOHSZmbL0-VRbjyHtTfv2tzh3VVlO-g0LP2GXcyfX8P6Te')) {
            return 'https://docs.google.com/spreadsheets/d/1F_1ntegp-tKhLfwaA4Ygv-cj1NST-fDmqeKuhfl1za8/edit?gid=347636234#gid=347636234';
        }
        
        // Generic fallback for other sheets
        const urlMatch = this.options.url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (urlMatch) {
            const sheetId = urlMatch[1];
            return `https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=0`;
        }
        return '#';
    }
    
    setupEventListeners() {
        // Close button listeners
        const closeButton = document.getElementById('warper-datatable-close');
        const closeXButton = document.getElementById('warper-datatable-close-x');
        
        closeButton?.addEventListener('click', () => this.hide());
        closeXButton?.addEventListener('click', () => this.hide());
        
        // Close on backdrop click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.hide();
            }
        });
        
        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
                this.hide();
            }
        });
    }
    
    show() {
        if (!this.csvData || this.csvData.length === 0) {
            console.error('No CSV data available for display');
            alert('No data available. Please check the CSV URL and your internet connection.');
            return;
        }
        
        console.log('Showing modal with', this.csvData.length, 'data rows');
        this.populateTable();
        this.modal.classList.remove('hidden');
    }
    
    hide() {
        this.modal.classList.add('hidden');
        
        // Properly destroy existing DataTable instance
        this.destroyDataTable();
    }
    
    destroyDataTable() {
        if (this.dataTable) {
            try {
                // Destroy DataTable instance
                this.dataTable.destroy(true); // true removes from DOM completely
                this.dataTable = null;
                
                // Clear the table HTML to reset state
                const table = document.getElementById('warper-datatable');
                if (table) {
                    table.innerHTML = `
                        <thead class="bg-gray-50 sticky top-0">
                            <tr id="warper-datatable-header"></tr>
                        </thead>
                        <tbody id="warper-datatable-body"></tbody>
                    `;
                }
            } catch (error) {
                console.warn('Error destroying DataTable:', error);
                this.dataTable = null;
            }
        }
        
        // Reset initialization flag
        this.isInitializing = false;
    }
    
    populateTable() {
        if (!this.csvData || this.csvData.length === 0) return;
        
        // Ensure we start with a clean table
        this.destroyDataTable();
        
        // Get all unique column names from the data
        const allColumns = new Set();
        this.csvData.forEach(row => {
            Object.keys(row).forEach(key => allColumns.add(key));
        });
        const dataColumns = Array.from(allColumns);
        
        // Add action column as first column
        const columns = ['Actions', ...dataColumns];
        
        // Create table header
        const headerRow = document.getElementById('warper-datatable-header');
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
        const tbody = document.getElementById('warper-datatable-body');
        tbody.innerHTML = '';
        this.csvData.forEach(row => {
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
        setTimeout(() => {
            this.initDataTable(columns);
        }, 100);
    }
    
    initDataTable(columns) {
        // Prevent concurrent initializations
        if (this.isInitializing) {
            console.warn('DataTable initialization already in progress, skipping...');
            return;
        }
        
        this.isInitializing = true;
        
        // Destroy existing instance if it exists
        this.destroyDataTable();
        
        // Check if table element already has DataTables initialized
        const tableElement = document.getElementById('warper-datatable');
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
            console.log('Initializing DataTable with', this.csvData.length, 'rows and', columns.length, 'columns');
            
            // Store nameColumns for the initComplete function
            const nameColumns = this.options.name;
            
            // First try with simplified configuration to avoid column filter issues
            this.dataTable = new DataTableConstructor('#warper-datatable', {
                data: this.csvData,
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
                dom: 'fBrtip', // f=filter, B=buttons - puts search before buttons
                buttons: [
                    {
                        extend: 'colvis',
                        text: 'Show/Hide Columns',
                        className: 'btn btn-secondary btn-sm'
                    }
                ],
                language: {
                    search: "<strong>Search all columns:</strong>",
                    searchPlaceholder: `Search ${this.options.name.join(', ')}...`,
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
                        
                        // Auto-focus the search input
                        setTimeout(() => {
                            const searchInput = $(api.table().container()).find('.dataTables_filter input');
                            if (searchInput.length) {
                                searchInput.focus();
                                console.log('Search input focused');
                            }
                        }, 100);
                        
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
            
            console.log('DataTable initialized successfully with', this.csvData.length, 'rows and', columns.length, 'columns');
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
                        }, 100);
                    }
                });
                console.log('Fallback DataTable initialized successfully');
                
            } catch (fallbackError) {
                console.error('Fallback DataTable initialization also failed:', fallbackError);
                
                // Last resort: try the most basic initialization possible
                try {
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