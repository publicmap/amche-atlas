# Architecture

## Nomenclature

### Thematic map layer

The amche-atlas is an organized collection of thematic maps, each composed of one or more symbolized data sources.

eg. Satellite Basemap, Street Map, Infrastructure, Natural Hazards, Boundaries, Protected Lands, Drainage, Forests, Building Footprints, Landuse and Landcover, Regulatory Plans..


```json
{
"maps": [
  {
    "id": "street",
    "title": "Street Details",
    "layers": ["mapbox-streets","mapbox-traffic"]
    "tags": ["basemap", "mapbox", "openstreetmap"]
  },
  {
    "id": "cadastre",
    "title": "Cadastral Surveys",
    "layers": ["plot", "notified-wetlands","notified-wetlands","private-forest","communidade-bhunaksha","communidade-saligao"]
    "tags": ["basemap", "mapbox", "openstreetmap"]
  }
}

```

### Data layer

Every data source is symbolized on the map using cartographic rules. These rules help render every data feature on the map using one or more overlapping style layers.

**Data Types**

Data layers can be on of these `type` values based on the location of the data:
- `style` uses a source already present in the map style
- `vector` uses vector tiles from a `url` with a `*.pbf` or `*.mvt` extension. A `sourceLayer` is required.
- `geojson` used vector shapes from a `url` with a `*.geojson` extension
- `tms` uses raster tiles from a `url` with a `*.png`,`*.webp` or `*.jpeg` extension
- `csv` uses tabular data from `url` with a `*.csv` extension. The data requires `lat` and `lng` columns to be defined for the location point information.

**Options**

- `refresh` : Integer, defines timeout in milliseconds for refreshing a real time data source



```json
{
"layers": [
  {
    "id": "mapbox-streets",
    "title": "Street Details",
    "layers": ["mapbox-streets","mapbox-traffic"]
    "tags": ["basemap", "mapbox", "openstreetmap"]
  },
  {
    "id": "cadastre",
    "title": "Cadastral Surveys",
    "layers": ["plot", "notified-wetlands","notified-wetlands","private-forest","communidade-bhunaksha","communidade-saligao"]
    "tags": ["basemap", "mapbox", "openstreetmap"]
  }
}

```


- Thematic map layer: is a collection of one or more map data layers that belong to a single theme. eg. Satellite Basemap, Street Map, Infrastructure, Natural Hazards, Boundaries, Protected Lands, Drainage, Forests, Building Footprints, Landuse and Landcover, Regulatory Plans..
  - Data layer: A data source that is visualized using one or mor style layers . eg. roads, wetlands, forests. 
    - Style layer: Individual map style layers with data defined symbology. eg fill, line, text

### Sample atlas.json configuration




## Interaction Patterns

**Primary Interface**

- Web GL Map

**Secondary Interfaces**

- App Navigation menu
- Map controls
  - Map Layer Control: Select theme and data layers
  - Feature Inspector: Inspect details from selected data layers

**Tertiary Interfaces**
