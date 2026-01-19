# Map Configuration Guide

**🎯 Quick Start**: Want to create your own custom map? Just edit `config/index.atlas.json` - it's now super easy!

## What is this?

The Amche Goa map can be customized to show different layers and focus on different areas. You can create your own version by simply editing a configuration file.

## 📋 Easy Configuration with `index.atlas.json`

The main configuration file is `config/index.atlas.json`. Here's what it looks like:

```json
{
  "name": "My Custom Map",
  "areaOfInterest": "Goa, India", 
  "map": {
    "center": [73.8, 15.47],
    "zoom": 11.4
  },
  "layers": [
    {
      "id": "mapbox-streets",
      "title": "Street Map",
      "initiallyChecked": true
    },
    {
      "id": "village"
    },
    {
      "id": "forests"
    }
  ]
}
```

That's it! 🎉

## 🎯 How It Works (The Magic!)

1. **Layer Definitions**: Each atlas file (`*.atlas.json`) contains complete layer definitions
2. **Shared Layers**: Layers can be reused across multiple atlases by referencing them with prefixed IDs (e.g., `india-bhuvan-satellite`)
3. **Easy Customization**: Override properties like opacity and visibility when referencing layers

## 📝 Step-by-Step: Create Your Own Map

### 1. Choose Your Layers

Pick from these popular layer IDs:

**Basic Maps:**
- `mapbox-streets` - Street map
- `osm` - OpenStreetMap

**Boundaries:**
- `village` - Village boundaries  
- `pincode` - Pincode boundaries
- `local-body` - Panchayat/Municipal boundaries
- `assembly-constituencies` - MLA constituencies

**Environment:**
- `forests` - Forest areas
- `rivers` - Rivers and streams
- `water-bodies` - Lakes and ponds
- `wetland` - Wetlands and mangroves
- `mining` - Mining lease areas

**Land Use:**
- `plot` - Property/survey boundaries
- `landcover` - Satellite-based land cover
- `osm-landuse` - Detailed land use from OpenStreetMap

**Historical Maps:**
- `goa-soi-map` - Survey of India topographic maps
- `regional-plan` - Regional Development Plan 2021
- `1906-india-atlas` - Historical 1906 atlas

[See layers in each atlas file: `india.atlas.json`, `goa.atlas.json`, `osm.atlas.json`, etc.]

### 2. Edit Your Configuration

Copy `config/index.atlas.json` and modify it:

```json
{
  "name": "My Environmental Map",
  "map": {
    "center": [73.9, 15.4],
    "zoom": 12
  },
  "layers": [
    {
      "id": "mapbox-streets",
      "initiallyChecked": true
    },
    {
      "id": "forests",
      "title": "Protected Forests"
    },
    {
      "id": "rivers"
    },
    {
      "id": "mining",
      "title": "Mining Areas (⚠️ Environmental Impact)"
    }
  ]
}
```

### 3. Customize Individual Layers (Optional)

Want to change how a layer looks? Override specific properties:

```json
{
  "id": "forests",
  "title": "My Custom Forest Layer",
  "initiallyChecked": true,
  "style": {
    "fill-color": "darkgreen",
    "fill-opacity": 0.8
  }
}
```

### 4. Set Your Map Center and Zoom

```json
{
  "map": {
    "center": [73.8274, 15.4406],  // [longitude, latitude]
    "zoom": 11.4                   // Higher = more zoomed in
  }
}
```

**Finding Coordinates:**
1. Go to [amche.goa.in](https://amche.goa.in)
2. Navigate to your area of interest
3. Look at the URL: `#11.4/15.4406/73.8274` 
4. Use those numbers: `[73.8274, 15.4406]`

## 🚀 Testing Your Configuration

### Using the `?atlas=` URL Parameter

The map supports three different ways to load configurations via the URL parameter:

#### 1. **Local filename**: `?atlas=maphub`
- Loads `config/maphub.atlas.json` from the local server
- Example: `https://amche.goa.in/?atlas=maphub`
- Best for: Development and predefined configs

#### 2. **Remote URL**: `?atlas=https://...`
- Fetches configuration directly from any URL
- Example: `https://amche.goa.in/?atlas=https://gist.githubusercontent.com/user/abc123/raw/config.json`
- Best for: Sharing configs via GitHub Gists, external servers

#### 3. **Serialized JSON**: `?atlas={"name":"..."}`
- Parses the JSON configuration directly from the URL
- Example: `https://amche.goa.in/?atlas={"name":"My Map","layers":[{"id":"mapbox-streets"}]}`
- Best for: Quick testing, embedding full configs in URLs

**Example** [CRZ Line layer with additional datasets](http://localhost:4035/?config={%22version%22:%220.1.0%22,%22name%22:%22Example%20map%20configuration%20template%20curated%20by%20the%20amche-goa%20community%22,%22areaOfInterest%22:%22India%22,%22startDate%22:%222010%22,%22endDate%22:%222025%22,%22map%22:{%22center%22:[72.8,18.93],%22zoom%22:12.4},%22layers%22:[{%22id%22:%22mapbox-streets%22},{%22id%22:%22open-buildings%22},{%22initiallyChecked%22:true,%22title%22:%22Coastal%20Regulation%20Zone%20Lines%22,%22description%22:%22Regulatory%20lines%20for%20Coastal%20Regulation%20Zones%22,%22headerImage%22:%22assets/map-layers/map-layer-crz-line.png%22,%22type%22:%22vector%22,%22id%22:%22crz-line%22,%22url%22:%22https://indianopenmaps.fly.dev/not-so-open/coastal/regulation-lines/parivesh/{z}/{x}/{y}.pbf%22,%22sourceLayer%22:%22Bharatmaps_Parivesh_CRZ_Regulatory_Lines%22,%22maxzoom%22:14,%22attribution%22:%22%3Ca%20href=%27https://bharatmaps.gov.in/BharatMaps/Home/Map%27%3EBharatmaps/Parivesh%3C/a%3E%20-%20Collected%20by%20%3Ca%20href=%27https://datameet.org%27%3EDatameet%20Community%3C/a%3E%22,%22style%22:{%22line-color%22:[%22match%22,[%22get%22,%22class%22],%22CRZ%20Boundary%22,%22blue%22,%22High%20Tide%20Line%22,%22blue%22,%22Low%20Tide%20Line%22,%22blue%22,%22orange%22],%22line-width%22:[%22match%22,[%22get%22,%22class%22],%22CRZ%20Boundary%22,3,%22High%20Tide%20Line%22,3,1]},%22inspect%22:{%22id%22:%22class%22,%22title%22:%22CRZ%20Class%22,%22label%22:%22class%22,%22fields%22:[%22state%22]}},{%22id%22:%22osm%22},{%22initiallyChecked%22:false,%22id%22:%223d-terrain%22}]}&layers=crz-line#12.4/18.93/72.8)

### Additional Testing Methods

### Method 1: GitHub Gist (Recommended for Sharing)
1. Save your config as a GitHub Gist
2. Get the "Raw" URL 
3. Test: `https://amche.goa.in/?atlas=YOUR_RAW_URL`

### Method 2: Replace the Main Config
1. Replace `config/index.atlas.json` with your version
2. Visit the map normally

### Method 3: Create Named Config
1. Save as `config/my-map.atlas.json`
2. Test: `https://amche.goa.in/?atlas=my-map`

## 💡 Pro Tips

### For Beginners:
- Start by copying `index.atlas.json` and just changing the layer list
- Remove layers you don't want, add layers you do want
- Only specify `id` for most layers - the system handles the rest!

### Common Customizations:
```json
{
  "id": "layer-name",
  "title": "Custom Title",           // Change display name
  "initiallyChecked": true,         // Turn on by default
  "description": "Custom description",  // Change description
  "clusterSeparateBy": "category",      // if there are too many points and clustering is required
  "clusterStyles": {
    "A": { "color": "red" },
    "B": { "color": "blue" }
  },
  ...
}
}
```

### Multiple Areas:
Create different configs for different regions:
- `config/north-goa.atlas.json` - Focus on North Goa
- `config/panaji.atlas.json` - Focus on Panaji city  
- `config/mining.atlas.json` - Mining-focused map

## 🔍 Example Configurations

### Environmental Focus:
```json
{
  "name": "Goa Environmental Map",
  "layers": [
    {"id": "mapbox-streets", "initiallyChecked": true},
    {"id": "forests"},
    {"id": "wetland"}, 
    {"id": "water-bodies"},
    {"id": "mining"},
    {"id": "esz"}
  ]
}
```

### Urban Planning:
```json
{
  "name": "Urban Planning Map", 
  "layers": [
    {"id": "mapbox-streets", "initiallyChecked": true},
    {"id": "plot"},
    {"id": "village"},
    {"id": "local-body"},
    {"id": "regional-plan"},
    {"id": "landuse-panjim"}
  ]
}
```

### Historical Research:
```json
{
  "name": "Historical Goa",
  "layers": [
    {"id": "1906-india-atlas", "initiallyChecked": true},
    {"id": "1855-geology"},
    {"id": "1814-lambton-survey"},
    {"id": "village"},
    {"id": "rivers"}
  ]
}
```

## ❓ FAQ

**Q: I want to add a completely new layer, not from the library**
A: You can still define custom layers with full properties. See the [Advanced Configuration](#advanced-configuration) section below.

**Q: Can I change the styling of existing layers?**  
A: Yes! Just add a `style` property to override the default styling.

**Q: My JSON has an error**
A: Use a JSON validator like [jsonlint.com](https://jsonlint.com) to check for syntax errors.

**Q: The map doesn't load my config**
A: Check the browser console for errors. The map will fall back to the default config if yours has problems.

## 🏗️ Advanced Configuration

If you need to define completely custom layers (not in the preset library), you can still use the full format:

```json
{
  "id": "my-custom-layer",
  "title": "My Custom Layer", 
  "type": "geojson",
  "url": "https://example.com/my-data.geojson",
  "style": {
    "line-color": "red",
    "line-width": 3
  },
  "inspect": {
    "title": "Feature Info",
    "label": "name"
  }
}
```

## 🎨 Available Layer Types

- `tms` - Tile map service (raster images)
- `vector` - Vector tiles
- `geojson` - GeoJSON data
- `style` - Mapbox style layers  
- `terrain` - 3D terrain controls
- `markers` - Point markers from CSV/spreadsheet
- `img` - Single image overlay

## 📚 Resources

- [Live Example](https://amche.in/dev/?atlas=maphub) - See the config system in action
- [Example Atlas Files](.) - Browse existing atlas configurations for layer examples
- [Default Styling](_defaults.json) - See the default style settings
- [JSON Validator](https://jsonlint.com) - Check your JSON syntax
- [Mapbox Style Specification](https://docs.mapbox.com/style-spec/) - For advanced styling

Need help? Open an issue on GitHub! 🙋‍♀️