# DXF Export Feature

This document describes the DXF (Drawing Exchange Format) export functionality added to the map export control.

## Overview

The DXF export feature allows users to export map data in AutoCAD-compatible format (DXF R12) with support for both vector-only and hybrid (vector + raster) modes.

## Features

### Export Modes

1. **Vector Only Mode**
   - Exports selected features or all visible features as CAD entities
   - Similar to KML/GeoJSON export
   - Smaller file size
   - Best for feature extraction

2. **Hybrid Mode (Vector + Raster)**
   - Captures the frame area as a raster image
   - Exports vector features within the frame bounds
   - Combines raster basemap with vector data
   - Best for creating georeferenced CAD drawings

### Coordinate Systems

1. **Local (Default)**
   - Meters from frame center
   - Origin at (0,0)
   - Most intuitive for CAD users
   - Preserves relative scale

2. **WGS84**
   - Preserves latitude/longitude coordinates
   - Good for import into GIS software
   - Units in decimal degrees

3. **UTM (Universal Transverse Mercator)**
   - Auto-detects UTM zone based on map center
   - Professional standard
   - Units in meters
   - Includes hemisphere (N/S)

## DXF File Structure

The exported DXF file uses **DXF R14 (AC1014)** format and contains:

- **Header Section**: Drawing metadata, units, extents
- **Tables Section**: Layers, line types
- **Blocks Section**: Reusable components (empty for now)
- **Entities Section**:
  - POINT entities for point features
  - POLYLINE entities for lines (open)
  - POLYLINE entities for polygons (closed)
  - TEXT entities for feature labels
  - IMAGE entity for raster layers (hybrid mode)
- **Objects Section**: IMAGEDEF objects for raster image references (hybrid mode)
- **End Section**: EOF marker

### Hybrid Mode Files

When exporting in hybrid mode, **three files** are generated:

1. **`filename.dxf`** - Main DXF file with vector features and IMAGE entity
2. **`filename_raster.png`** - Georeferenced raster image
3. **`filename_raster.pgw`** - World file for georeferencing (ESRI format)

All three files must be in the same directory for proper display in QGIS and other GIS software.

## Geometry Conversion

- **Point** → DXF POINT entity + optional TEXT label
- **LineString** → DXF POLYLINE (open, flag 0)
- **Polygon** → DXF POLYLINE (closed, flag 1)
  - Outer ring and holes are separate polylines
- **MultiGeometry** → Multiple entities

## Layer Organization

Features are organized into DXF layers based on:
1. `properties.layer` (if present)
2. `properties.layerName` (if present)
3. `sourceLayer` (for vector tiles)
4. "DEFAULT" (fallback)

Each layer is assigned a unique AutoCAD Color Index (1-255).

## Usage

### Vector-Only Export

1. Open the export panel (download button)
2. Select "DXF" format
3. Choose coordinate system (Local, WGS84, or UTM)
4. Select "Vector only" mode
5. Check "Export only selected features" if needed
6. Click "Download"

### Hybrid Export (Vector + Raster)

1. Open the export panel
2. Select "DXF" format
3. Choose coordinate system
4. Select "Vector + Raster layers" mode
5. Adjust frame size and position
6. Set page settings (size, DPI, orientation)
7. Click "Download"

**Note:** The raster is captured with a top-down view (bearing=0, pitch=0) and with 3D terrain disabled to ensure proper alignment with vector features. Your camera view is automatically restored after export.

## File Compatibility

The DXF export uses **DXF R12 ASCII** format for maximum compatibility:

### Compatible Software
- **AutoCAD** (all versions from R12 onwards)
- **FreeCAD** (open source CAD)
- **LibreCAD** (open source 2D CAD)
- **QGIS** (with DXF import plugin)
- **DraftSight** (2D/3D CAD)
- **BricsCAD** (AutoCAD alternative)

### Import Instructions

#### AutoCAD
1. File → Open → Select DXF file
2. Or: File → Import → Select DXF file

#### FreeCAD
1. File → Import → Select DXF file
2. Choose import options (keep defaults)

#### QGIS

**Vector-Only Mode:**
1. Layer → Add Layer → Add Vector Layer
2. Select DXF file
3. Geometries will be imported with attributes

**Hybrid Mode (with raster):**
1. Ensure all three files are in the same directory:
   - `filename.dxf`
   - `filename_raster.png`
   - `filename_raster.pgw`
2. Layer → Add Layer → Add Raster Layer
3. Select `filename_raster.png` (the .pgw file will be automatically detected)
4. The raster will be georeferenced and displayed
5. Then add the DXF: Layer → Add Layer → Add Vector Layer
6. Select `filename.dxf` for vector features
7. Vector features will overlay the raster correctly

## Technical Details

### Coordinate Transformation

**Local Coordinates:**
```javascript
x = (lng - origin.lng) * metersPerDegreeLng
y = (lat - origin.lat) * metersPerDegreeLat
```

Where:
- `metersPerDegreeLat = 111,319.9 meters` (constant)
- `metersPerDegreeLng = 111,319.9 * cos(latitude)` (varies with latitude)

**UTM Coordinates:**
- Zone calculation: `floor((lng + 180) / 6) + 1`
- Hemisphere: `lat >= 0 ? 'N' : 'S'`
- Simplified projection (Mercator approximation)
- For production use, consider integrating proj4js for accurate transformation

### Ground Resolution

For hybrid mode, ground resolution is calculated as:
```javascript
resolution = (40,075,017 * cos(lat)) / (256 * 2^zoom)
```

This determines the real-world dimensions of the captured raster image.

## Limitations

1. **Multiple Files**: In hybrid mode, three files are exported (DXF + PNG + PGW). Keep all files in the same directory for proper display. Some browsers may require allowing multiple downloads.

2. **3D Support**: Currently exports 2D coordinates. Elevation data (z-coordinates) is preserved but not visualized in most CAD software without explicit 3D view settings.

3. **Feature Limit**: For very large datasets (>10,000 features), export may be slow. Consider using "Export only selected features" option.

4. **Coordinate Precision**: Coordinates are written with full precision (no rounding). This ensures accuracy but may result in large file sizes.

5. **Browser Permissions**: Multiple file downloads (hybrid mode) may be blocked by browser popup blockers. Allow downloads from this site if prompted.

## Files

### Core Modules
- `js/dxf-converter.js` - DXF R12 generator
- `js/dxf-coordinate-transformer.js` - Coordinate system transformations
- `js/map-export-control.js` - UI integration and export orchestration

### Tests
- `js/tests/dxf-export.test.js` - Unit tests for DXF converter and transformer

## Future Enhancements

1. **DXF Import**: Reverse operation to load DXF files into the map
2. **DXF R14+ Support**: Use LWPOLYLINE for better efficiency
3. **Georeferenced Rasters**: Proper IMAGE entity support with external references
4. **Block Definitions**: Reusable symbols for repeated features
5. **Advanced Styling**: Line types (dashed, dotted), hatches, colors from layer config
6. **3D Terrain**: Export elevation data from 3D terrain layers
7. **proj4js Integration**: Accurate UTM and other coordinate system transformations

## Examples

### Export Selected Building Footprints
1. Use feature inspector to select buildings
2. Open export panel
3. Select DXF format, Local coordinates, Vector only
4. Export creates: `Buildings_FeatureName1_FeatureName2.dxf`

### Export Map Area for CAD Drawing
1. Position map at desired location
2. Open export panel, select DXF format
3. Choose Hybrid mode, adjust frame to desired area
4. Set A4 landscape, 150 DPI for high quality
5. Export creates georeferenced DXF with raster + vectors

### Export to QGIS for Analysis
1. Select features of interest
2. Export as DXF with WGS84 coordinates
3. Import DXF into QGIS
4. Features appear with all properties preserved

## Support

For issues or questions:
- Check GitHub Issues: https://github.com/anthropics/claude-code/issues
- Review test file: `js/tests/dxf-export.test.js`
- Consult DXF R12 specification for format details
