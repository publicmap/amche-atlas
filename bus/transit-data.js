// Transit Data Models and Configuration
// Contains data schemas, styling configuration, and data model classes

// Configuration for tileset schema mapping
export const TILESET_SCHEMA = {
    routes: {
        layer: 'mumbai-routes',
        fields: {
            id: 'route_id',
            shortName: 'route_short_name',
            longName: 'route_name',
            description: 'route_desc',
            color: 'route_color',
            textColor: 'route_text_color',
            isLive: 'is_live',
            agency: 'agency_name',
            city: 'city_name',
            routeType: 'route_type',
            fareType: 'fare_type'
        }
    },
    stops: {
        layer: 'mumbai-stops',
        fields: {
            id: ['id', 'stop_id'], // Try both field names
            name: 'name',
            timetable: 'stop_timetable',
            routeList: 'route_name_list',
            tripCount: 'trip_count',
            avgWaitTime: 'avg_wait_time',
            description: 'stop_description',
            towardsStop: 'towards_stop',
        }
    }
};

// Transit Agency styling configuration
export const AGENCY_STYLES = {
    'BEST': {
        name: 'Brihanmumbai Electric Supply and Transport',
        colors: {
            'AC': {
                background: '#2563eb',      // Blue-600
                text: '#ffffff',
                mapLine: '#3b82f6'          // Blue-500
            },
            'Regular': {
                background: '#dc2626',      // Red-600
                text: '#ffffff', 
                mapLine: '#ef4444'          // Red-500
            },
            'default': {
                background: '#059669',      // Green-600
                text: '#ffffff',
                mapLine: '#10b981'          // Green-500
            }
        }
    },
    'default': {
        name: 'Transit Agency',
        colors: {
            'default': {
                background: '#059669',      // Green-600
                text: '#ffffff',
                mapLine: '#10b981'          // Green-500
            }
        }
    }
};

// Transit Agency data class
export class TransitAgency {
    constructor(agencyName) {
        this.name = agencyName || 'default';
        this.config = AGENCY_STYLES[this.name] || AGENCY_STYLES['default'];
    }
    
    getRouteStyle(fareType = null, routeType = null) {
        // Determine the service type for styling
        let serviceType = 'default';
        
        if (fareType) {
            serviceType = fareType;
        } else if (routeType) {
            // Map route types to service types if needed
            serviceType = this.mapRouteTypeToService(routeType);
        }
        
        // Get colors for the service type, fallback to default
        const colors = this.config.colors[serviceType] || this.config.colors['default'];
        
        return {
            backgroundColor: colors.background,
            textColor: colors.text,
            mapLineColor: colors.mapLine,
            serviceType: serviceType
        };
    }
    
    mapRouteTypeToService(routeType) {
        // Map GTFS route types or custom route types to service types
        const routeTypeMap = {
            'AC': 'AC',
            'ac': 'AC',
            'Air Conditioned': 'AC',
            'Regular': 'Regular',
            'regular': 'Regular',
            'Ordinary': 'Regular',
            'Express': 'Regular',
            'Limited': 'Regular'
        };
        
        return routeTypeMap[routeType] || 'default';
    }
    
    getAllServiceTypes() {
        return Object.keys(this.config.colors);
    }
    
    getDisplayInfo() {
        return {
            name: this.config.name,
            shortName: this.name,
            serviceTypes: this.getAllServiceTypes()
        };
    }
}

// Bus Route data class
export class BusRoute {
    constructor(feature, schema = TILESET_SCHEMA.routes) {
        this.feature = feature;
        this.schema = schema;
        this.properties = feature.properties || {};
        
        // Map schema fields to properties
        this.id = this.getProperty('id');
        this.shortName = this.getProperty('shortName');
        this.longName = this.getProperty('longName');
        this.description = this.getProperty('description');
        this.color = this.getProperty('color');
        this.textColor = this.getProperty('textColor');
        this.isLive = this.getBooleanProperty('isLive');
        this.agency = this.getProperty('agency');
        this.city = this.getProperty('city');
        this.routeType = this.getProperty('routeType');
        this.fareType = this.getProperty('fareType');
        
        // Computed properties
        this.displayName = this.shortName || this.longName || this.id;
        this.fullDescription = this.description || this.longName || '';
        
        // Initialize agency styling
        this.transitAgency = new TransitAgency(this.agency);
        this.styling = this.transitAgency.getRouteStyle(this.fareType, this.routeType);
    }
    
    getProperty(schemaKey) {
        const fieldName = this.schema.fields[schemaKey];
        return fieldName ? this.properties[fieldName] : null;
    }
    
    getBooleanProperty(schemaKey) {
        const value = this.getProperty(schemaKey);
        return value === true || value === 'true' || value === 1 || value === '1';
    }
    
    getDisplayInfo() {
        return {
            name: this.displayName,
            description: this.fullDescription,
            status: this.isLive ? 'Live Tracking' : 'Scheduled',
            agency: this.agency,
            city: this.city,
            serviceType: this.styling.serviceType,
            styling: this.styling
        };
    }
    
    getMapLineColor() {
        // Use agency styling if available, fallback to manual color or default
        return this.styling.mapLineColor || this.color || '#10b981';
    }
    
    getRouteHtml(size = 'normal') {
        const sizeClasses = {
            small: 'px-1.5 py-0.5 text-xs',
            normal: 'px-2 py-1 text-xs',
            large: 'px-3 py-1.5 text-sm'
        };
        
        const sizeClass = sizeClasses[size] || sizeClasses.normal;
        
        return `
            <span class="route-badge ${sizeClass} rounded font-bold" 
                  style="background-color: ${this.styling.backgroundColor}; color: ${this.styling.textColor};">
                <span class="route-badge-text">${this.displayName}</span>
                ${this.fareType === 'AC' ? '<span class="text-blue-200 text-xs ml-1">AC</span>' : ''}
            </span>
        `;
    }
}

// Bus Stop data class
export class BusStop {
    constructor(feature, schema = TILESET_SCHEMA.stops) {
        this.feature = feature;
        this.schema = schema;
        this.properties = feature.properties || {};
        
        // Map schema fields to properties
        this.id = this.getProperty('id');
        this.name = this.getProperty('name');
        this.description = this.getProperty('description');
        this.lat = this.getNumericProperty('lat');
        this.lon = this.getNumericProperty('lon');
        this.timetable = this.getProperty('timetable');
        this.routeList = this.getProperty('routeList');
        this.tripCount = this.getNumericProperty('tripCount');
        this.avgWaitTime = this.getNumericProperty('avgWaitTime');
        this.zoneId = this.getProperty('zoneId');
        this.stopUrl = this.getProperty('stopUrl');
        this.locationType = this.getProperty('locationType');
        
        // Computed properties
        this.coordinates = feature.geometry ? feature.geometry.coordinates : [this.lon, this.lat];
        this.routes = this.parseRouteList();
        this.hasLiveData = this.id && this.id.length > 0;
    }
    
    getProperty(schemaKey) {
        const fieldName = this.schema.fields[schemaKey];
        if (!fieldName) return null;
        
        // Handle array of field names (try each one)
        if (Array.isArray(fieldName)) {
            for (const field of fieldName) {
                if (this.properties[field] !== undefined) {
                    return this.properties[field];
                }
            }
            return null;
        }
        
        // Handle single field name
        return fieldName ? this.properties[fieldName] : null;
    }
    
    getNumericProperty(schemaKey) {
        const value = this.getProperty(schemaKey);
        return value ? parseFloat(value) : null;
    }
    
    parseRouteList() {
        if (!this.routeList) return [];
        
        try {
            // Handle semicolon-separated route list (most common format)
            if (typeof this.routeList === 'string') {
                return this.routeList.split(/[;,]/).map(route => route.trim()).filter(Boolean);
            }
            return Array.isArray(this.routeList) ? this.routeList : [];
        } catch (error) {
            console.warn('Error parsing route list:', error);
            return [];
        }
    }
    
    getRoutesFromTimetable() {
        // Extract route information from timetable data
        const timetableData = this.parseTimetable();
        const routeMap = new Map();
        
        timetableData.forEach(routeInfo => {
            if (routeInfo.route_short_name || routeInfo.route_name) {
                const routeName = routeInfo.route_short_name || routeInfo.route_name;
                
                // Extract destination from various possible fields
                const destination = this.extractDestination(routeInfo);
                
                routeMap.set(routeName, {
                    name: routeName,
                    agency: routeInfo.agency_name || 'BEST',
                    fareType: this.detectFareType(routeName),
                    isAC: this.isACRoute(routeName),
                    destination: destination,
                    // Include all timetable info for debugging
                    timetableInfo: routeInfo
                });
            }
        });
        
        return Array.from(routeMap.values());
    }

    extractDestination(routeInfo) {
        // Try various possible destination fields in order of preference
        const destinationFields = [
            'last_stop_name',
            'trip_headsign', 
            'headsign',
            'towards_stop',
            'destination',
            'route_long_name',
            'route_desc'
        ];
        
        for (const field of destinationFields) {
            if (routeInfo[field] && routeInfo[field].trim()) {
                return routeInfo[field].trim();
            }
        }
        
        // Fallback to generic destination based on route name
        return this.generateFallbackDestination(routeInfo.route_short_name || routeInfo.route_name);
    }

    generateFallbackDestination(routeName) {
        // Generate plausible destinations based on route patterns
        const patterns = {
            // AC routes (starting with A)
            'A': ['Airport Terminal', 'Central Station', 'Business District'],
            // Limited routes (ending with LTD)
            'LTD': ['Express Terminal', 'Limited Stop', 'Fast Service'],
            // Circular routes (C prefix)
            'C': ['Circular Route', 'City Center', 'Loop Service']
        };
        
        // Check route name patterns
        const routeUpper = routeName.toUpperCase();
        for (const [pattern, destinations] of Object.entries(patterns)) {
            if (routeUpper.startsWith(pattern) || routeUpper.includes(pattern)) {
                return destinations[Math.floor(Math.random() * destinations.length)];
            }
        }
        
        // Default fallback
        return 'Main Terminal';
    }

    detectFareType(routeName) {
        const name = routeName.toLowerCase();
        if (name.includes('ac') || name.includes('a-') || name.includes('a/c')) {
            return 'AC';
        }
        return 'Regular';
    }

    isACRoute(routeName) {
        return this.detectFareType(routeName) === 'AC';
    }
    
    parseTimetable() {
        if (!this.timetable) return [];
        
        try {
            let timetableData = typeof this.timetable === 'string' ? 
                JSON.parse(this.timetable) : this.timetable;
            
            return Array.isArray(timetableData) ? timetableData : [];
        } catch (error) {
            console.warn('Error parsing timetable:', error);
            return [];
        }
    }
    
    getDistance(userLocation) {
        if (!userLocation || !this.coordinates) return null;
        
        const R = 6371; // Earth's radius in kilometers
        const dLat = this.toRadians(this.lat - userLocation.lat);
        const dLon = this.toRadians(this.lon - userLocation.lng);
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(this.toRadians(userLocation.lat)) * Math.cos(this.toRadians(this.lat)) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }
    
    toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }
    
    getDisplayInfo(userLocation = null) {
        const distance = userLocation ? this.getDistance(userLocation) : null;
        
        return {
            name: this.name || 'Bus Stop',
            description: this.description,
            distance: distance ? `${(distance * 1000).toFixed(0)}m` : null,
            routeCount: this.routes.length,
            routes: this.routes.slice(0, 5), // Show first 5 routes
            moreRoutes: Math.max(0, this.routes.length - 5),
            tripCount: this.tripCount,
            avgWaitTime: this.avgWaitTime,
            hasLiveData: this.hasLiveData,
            coordinates: this.coordinates
        };
    }

    // New method to get upcoming departures for current time
    getUpcomingDepartures(currentTime, limit = 12) {
        const timetableData = this.parseTimetable();
        const allDepartures = [];
        
        timetableData.forEach(routeInfo => {
            if (!routeInfo.stop_times || !Array.isArray(routeInfo.stop_times)) {
                return;
            }
            
            const routeName = routeInfo.route_short_name || routeInfo.route_name;
            const destination = routeInfo.last_stop_name || 'Terminal';
            const agencyName = routeInfo.agency_name || 'BEST';
            const headway = routeInfo.trip_headway || 30;
            
            // Process each scheduled time
            routeInfo.stop_times.forEach(timeStr => {
                const departureTime = DataUtils.parseTimeString(timeStr, currentTime);
                if (departureTime) {
                    const timeDiffMinutes = (departureTime.getTime() - currentTime.getTime()) / (1000 * 60);
                    
                    // Include departures within next 3 hours or recently departed (last 5 minutes)
                    if (timeDiffMinutes >= -5 && timeDiffMinutes <= 180) {
                        allDepartures.push({
                            route: routeName,
                            routeId: routeInfo.route_id || `route_${routeName}`,
                            time: departureTime,
                            destination: destination,
                            agencyName: agencyName,
                            headway: headway,
                            isLive: routeInfo.is_live === true || routeInfo.is_live === 'true',
                            fareType: this.detectFareType(routeName),
                            sortTime: departureTime.getTime()
                        });
                    }
                }
            });
        });
        
        // Sort by time and limit results
        return allDepartures
            .sort((a, b) => a.sortTime - b.sortTime)
            .slice(0, limit);
    }
}

// Utility functions for data parsing
export class DataUtils {
    static parseTimeString(timeStr, baseDate) {
        try {
            // Parse "HH:MM" format
            const [hours, minutes] = timeStr.split(':').map(Number);
            
            if (isNaN(hours) || isNaN(minutes)) {
                return null;
            }

            const departure = new Date(baseDate);
            departure.setHours(hours, minutes, 0, 0);

            // Handle next day scenarios (for times after midnight)
            if (departure < baseDate) {
                departure.setDate(departure.getDate() + 1);
            }

            return departure;
        } catch (error) {
            return null;
        }
    }

    static isWithinNext60Minutes(departureTime, currentTime) {
        const timeDiff = departureTime - currentTime;
        // Within next 60 minutes (3.6 million milliseconds)
        return timeDiff >= 0 && timeDiff <= 60 * 60 * 1000;
    }

    static calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in kilometers
        const dLat = this.toRadians(lat2 - lat1);
        const dLon = this.toRadians(lon2 - lon1);
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }
    
    static toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    static detectFareTypeFromRoute(routeName) {
        const name = routeName.toLowerCase();
        if (name.includes('ac') || name.includes('a-') || name.includes('a/c')) {
            return 'AC';
        }
        return 'Regular';
    }

    static getStyledRouteBadge(routeName, routeInfo = null, size = 'normal') {
        const sizeClasses = {
            small: 'px-1.5 py-0.5 text-xs',
            normal: 'px-2 py-1 text-xs',
            large: 'px-3 py-1.5 text-sm'
        };
        
        const sizeClass = sizeClasses[size] || sizeClasses.normal;
        
        // Intelligent fallback based on route name patterns
        let backgroundColor = '#059669'; // Default green
        let textColor = '#ffffff';
        let isAC = false;
        
        if (routeInfo) {
            const transitAgency = new TransitAgency(routeInfo.agency || 'BEST');
            const styling = transitAgency.getRouteStyle(routeInfo.fareType);
            backgroundColor = styling.backgroundColor;
            textColor = styling.textColor;
            isAC = routeInfo.fareType === 'AC';
        } else {
            // Detect AC routes from name patterns
            const routeNameLower = routeName.toLowerCase();
            if (routeNameLower.includes('a-') || 
                routeNameLower.includes('ac') || 
                routeNameLower.includes('a/c') ||
                routeNameLower.includes('air con')) {
                backgroundColor = '#2563eb'; // Blue for AC
                isAC = true;
            } else {
                // Assume Regular BEST service gets red
                backgroundColor = '#dc2626'; // Red for Regular
            }
        }
        
        const acIndicator = isAC ? '<span class="text-blue-200 text-xs ml-1">AC</span>' : '';
        
        return `<span class="route-badge ${sizeClass} rounded font-bold" style="background-color: ${backgroundColor}; color: ${textColor};">
                    <span class="route-badge-text">${routeName}</span>${acIndicator}
                </span>`;
    }
} 