export class LocationDataLoader {
    constructor(dataLookup) {
        this.dataLookup = dataLookup;
        this.currentMatch = null;
    }

    getBestMatch(bounds) {
        if (!bounds) {
            return { changed: false, match: null };
        }

        const mapBounds = {
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest()
        };

        const mapCenter = {
            lng: (mapBounds.east + mapBounds.west) / 2,
            lat: (mapBounds.north + mapBounds.south) / 2
        };

        let bestMatch = null;
        let maxOverlapArea = 0;

        for (const region of this.dataLookup) {
            if (this.isPointInBounds(mapCenter, region.bounds)) {
                const overlapArea = this.calculateOverlapArea(mapBounds, region.bounds);

                if (overlapArea > maxOverlapArea) {
                    maxOverlapArea = overlapArea;
                    bestMatch = region;
                }
            }
        }

        if (!bestMatch && this.dataLookup.length > 0) {
            let minDistance = Infinity;

            for (const region of this.dataLookup) {
                const distance = this.distanceToRegion(mapCenter, region);
                if (distance < minDistance) {
                    minDistance = distance;
                    bestMatch = region;
                }
            }
        }

        const changed = !this.currentMatch ||
                       (bestMatch && this.currentMatch.name !== bestMatch.name);

        if (changed) {
            this.currentMatch = bestMatch;
        }

        return {
            changed,
            match: bestMatch
        };
    }

    isPointInBounds(point, bounds) {
        return point.lat >= bounds.south &&
               point.lat <= bounds.north &&
               point.lng >= bounds.west &&
               point.lng <= bounds.east;
    }

    calculateOverlapArea(bounds1, bounds2) {
        const overlapWest = Math.max(bounds1.west, bounds2.west);
        const overlapEast = Math.min(bounds1.east, bounds2.east);
        const overlapSouth = Math.max(bounds1.south, bounds2.south);
        const overlapNorth = Math.min(bounds1.north, bounds2.north);

        if (overlapWest >= overlapEast || overlapSouth >= overlapNorth) {
            return 0;
        }

        const width = overlapEast - overlapWest;
        const height = overlapNorth - overlapSouth;
        return width * height;
    }

    distanceToRegion(point, region) {
        const regionCenter = region.center || [
            (region.bounds.west + region.bounds.east) / 2,
            (region.bounds.south + region.bounds.north) / 2
        ];

        const dx = point.lng - regionCenter[0];
        const dy = point.lat - regionCenter[1];
        return Math.sqrt(dx * dx + dy * dy);
    }

    getCurrentMatch() {
        return this.currentMatch;
    }
}
