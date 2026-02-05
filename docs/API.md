# URL API Documentation

The Amche Atlas application supports URL parameters for deep linking and sharing specific map configurations. All parameters can be combined to create comprehensive map states.

## Parameters

### `atlas`

Load a specific atlas configuration.

**Format:** `?atlas=<value>`

**Values:**
- `filename` - Load local config file (e.g., `?atlas=villages`)
- `https://...` - Load remote config URL
- `{"name":"..."}` - Inline JSON config

**Examples:**
```
?atlas=villages
?atlas=https://example.com/map-config.json
?atlas={"name":"Custom Map","layers":[{"id":"mapbox-streets"}]}
```

### `layers`

Override visible layers from the atlas configuration.

**Format:** `?layers=<layer1>,<layer2>,...`

**Values:**
- Comma-separated list of layer IDs
- Supports inline JSON layer definitions with `{...}` syntax
- Can include opacity: `{"id":"layer-name","opacity":0.5}`

**Examples:**
```
?layers=mapbox-streets,forests
?layers=goa-plots,{"id":"custom-layer","opacity":0.7}
```

### `selected`

Deep link to specific selected features on the map.

**Format:** `?selected=<layerId>:<featureId1>,<featureId2>;<layerId2>:<featureId3>`

**Syntax:**
- Multiple layers separated by semicolons (`;`)
- Each layer segment: `layerId:featureId1,featureId2,...`
- Multiple features from the same layer separated by commas (`,`)
- Feature IDs are the raw IDs from the data source (feature.id, properties.id, or properties.fid)

**Examples:**
```
Single feature:
?selected=goa-plots:12345

Multiple features from one layer:
?selected=goa-plots:12345,67890,11111

Multiple features across layers:
?selected=goa-plots:12345,67890;goa-buildings:11111,22222;roads:999

Combined with layers:
?layers=goa-plots,goa-buildings&selected=goa-plots:12345;goa-buildings:67890
```

**Notes:**
- Features are automatically selected when the page loads
- Selections persist across map interactions
- Use Cmd/Ctrl+Click to add to existing selections
- Click empty area to clear all selections

### `geolocate`

Trigger geolocation to center the map on the user's current location.

**Format:** `?geolocate=true`

**Example:**
```
?geolocate=true
```

### `q`

Pre-populate the search query and trigger a location search.

**Format:** `?q=<search-term>`

**Example:**
```
?q=Panaji
?q=Cabo de Rama Fort
```

### `terrain`

Control 3D terrain visualization and exaggeration level.

**Format:** `?terrain=<exaggeration>`

**Values:**
- `0` - Disable terrain
- `0.5` to `3.0` - Terrain exaggeration multiplier (default: `1.5`)

**Examples:**
```
?terrain=0        (disable terrain)
?terrain=1.5      (default exaggeration)
?terrain=2.5      (more dramatic terrain)
```

### `animate`

Enable automatic camera animation around the terrain.

**Format:** `?animate=true`

**Example:**
```
?terrain=2&animate=true
```

### `fog`

Control atmospheric fog rendering in 3D view.

**Format:** `?fog=false` (fog is enabled by default)

**Example:**
```
?terrain=2&fog=false
```

### `wireframe`

Display terrain as a wireframe mesh for debugging.

**Format:** `?wireframe=true`

**Example:**
```
?terrain=2&wireframe=true
```

### `terrainSource`

Select the terrain data source (default: `mapbox`).

**Format:** `?terrainSource=<source>`

**Values:**
- `mapbox` (default)
- `maptiler`
- Other configured terrain sources

**Example:**
```
?terrain=2&terrainSource=maptiler
```

## Complete Examples

### Basic Map with Layers
```
?atlas=villages&layers=mapbox-streets,forests,water-bodies
```

### Map with Feature Selection
```
?atlas=goa&layers=goa-plots,goa-buildings&selected=goa-plots:12345,67890
```

### 3D Terrain Visualization
```
?atlas=topography&terrain=2.5&animate=true&wireframe=false
```

### Search Location with Terrain
```
?q=Dudhsagar Falls&terrain=2&geolocate=true
```

### Complex Configuration
```
?atlas=environmental&layers=protected-areas,mining-leases,forests&selected=mining-leases:L001,L002;protected-areas:PA123&terrain=1.5&q=Mollem
```

## URL Generation

The application automatically updates the URL as you interact with the map:
- Layer visibility changes update the `layers` parameter
- Feature selections update the `selected` parameter
- Terrain controls update terrain-related parameters
- Search queries update the `q` parameter

Use the share button to copy the current URL with all active parameters.

## Technical Notes

### Parameter Persistence
- URL parameters are debounced (300ms) to prevent excessive history entries
- Browser back/forward buttons restore previous map states
- Parameters are preserved during map interactions

### Feature ID Resolution
The `selected` parameter uses feature IDs in this priority order:
1. `feature.id` (if available in the data source)
2. `feature.properties.id`
3. `feature.properties.fid` (common in vector tiles)
4. Other layer-specific identifiers

When creating deep links, use the IDs directly from your data source.

### URL Encoding
- Layer IDs and simple values are not URL-encoded for readability
- Special characters in JSON objects are automatically encoded
- Semicolons and colons in the `selected` parameter are not encoded
