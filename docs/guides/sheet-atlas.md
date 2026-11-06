# An atlas in a Google Sheet

A Google Sheet can be a whole atlas: its name and starting view, its maps, its pins, and a network of routes between stops. Anyone with edit access to the sheet can add a map or a stop, and amche reads the sheet each time the atlas is opened. Routes drawn and edited on the map can be saved back to the sheet.

Open a sheet as an atlas by giving its link as the `atlas`:

```
https://amche.in/?atlas=https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit
```

The sheet must be shared as **Anyone with the link can view**. Leave off anything after `/edit`, such as `#gid=0`: a browser treats the `#` as the start of the map's own position.

This guide sets up a starter sheet with a script that creates every tab with example rows, then explains each tab.

## 1. Create the starter sheet

1. Create a new Google Sheet at [sheets.new](https://sheets.new) and give it a name.
2. Open **Extensions → Apps Script**, delete the placeholder code, and paste the [starter script](#the-starter-script) below. Save it.
   - So that the tabs become tables, choose **Services +** in the editor's left bar, pick **Google Sheets API** and **Add**. Without it the tabs are plain lists with the same dropdowns and checkboxes.
3. Back in the sheet, reload the page. An **Amche.in** menu appears next to **Help**.
4. Choose **Amche.in → Setup Map Atlas Sheet**. Google asks you to authorise the script the first time: it edits only this sheet, and sets itself to re-check the sheet after each edit.
5. Choose **Share** and set general access to **Anyone with the link → Viewer**.
6. Choose **Amche.in → Visualize Map**. It checks the sheet, shows the **Visualize Map** tab and opens the atlas in a new tab: a cycling route, its stops and two pins in Panjim, Goa. If your browser blocks the new tab, use the link in the dialog.

Each tab is a table (the same as **Convert to table** in the sheet's right-click menu): add a row by typing under the last one, and sort or filter from a column's header. Hover over a column's header to see what goes in it. Select a cell to see its help, and a cell with a value amche can't use gets a red corner. Columns with fixed choices, such as a map's `type` or a route's `profile`, are dropdowns. Yes/no columns are checkboxes.

Replace the example rows with your own. Reload the amche tab to see changes: amche reads the sheet each time the atlas opens.

## 2. The tabs

The starter script creates six tabs. The first, **Visualize Map**, is for people: the map link, what each tab is for, links to these docs, and a table of problems in the sheet. amche ignores it. The other five hold the atlas. Each is optional, and amche finds them by name.

### `Visualize Map`: the link, help and problems

- **Open the map** and **Map link** give the atlas link (`=AMCHE_ATLAS_LINK(AMCHE_BASE_URL)`).
- **Base URL** sets where every link in the sheet opens: `https://amche.in/dev/` to start with, `https://amche.in/`, `localhost` for amche on your own computer, or your own copy of amche. See [the starter script](#the-starter-script).
- Changes to the sheet show on the map in a few minutes, because Google takes a while to publish a sheet's latest data. If a change still doesn't show after that, reload the map with the browser cache cleared (Ctrl+Shift+R, or Cmd+Shift+R on a Mac).
- **Problems** lists every cell amche would trip over, with a link to the cell: an id used twice or with spaces, coordinates out of range, invalid JSON, an unknown map type or travel mode, a route with a stop that isn't in `waypoints`. Each one is also marked red in its tab, with a note. The table updates by itself whenever the sheet is edited or rows are added or removed, so it always matches what the map link will show. **Amche.in → Visualize Map** shows this tab and opens the map in a new tab.

### `atlas`: settings

Two columns, `key` and `value`, one setting per row.

| key | value |
|---|---|
| `name` | The atlas name, shown on the console and splash card. |
| `description` | One line about the atlas. |
| `color` | The atlas colour, such as `#2563eb`. |
| `center` | The starting view centre as `lng, lat`. Without it the view fits the pins and stops. |
| `zoom`, `pitch`, `bearing` | The starting view. |
| `style` | A basemap style URL, such as `mapbox://styles/mapbox/standard`. |
| `saveUrl` | The `/exec` URL of the route web app (see [Saving routes from amche](#4-saving-routes-from-amche)). Without it the routes are read only. |
| `routesTitle` | The name of the routes map. Defaults to `Routes`. |
| `config` | Any other [atlas field](?page=curating-atlas) as JSON, such as `{"areaOfInterest": "Goa"}`. |

### `layers`: maps

One row per map, first row on top, the same order as in an atlas file.

- A row with only an `id` uses a map that already exists in amche's atlases, such as `mapbox-satellite`, `osm-places` or `local-body`. Tick `initiallyChecked` to turn it on when the atlas opens.
- A row with a `type` is a new map. Its columns are the layer fields in [Layer Source Formats](?page=url-api#layer-source-formats): `id`, `title`, `type`, `url`, `description`, `attribution`, `tags`, `opacity`, `minzoom`, `maxzoom`, `sourceLayer`.
- `style` and `inspect` hold JSON, such as `{"line-color": "#e11d48", "line-width": 2}`.
- `config` holds JSON for any field without a column of its own, such as `{"legendImage": "https://…/legend.png"}`. It is applied last.
- `tags` is comma-separated.
- `read-only` is ticked by default: amche never writes back to that map's data. Untick it on a `routes` map to let route edits be saved to its sheet (it also needs a `saveUrl`). Rows you type in yourself start unticked.
- An `enabled` column set to `FALSE` leaves a row out without deleting it.

**Amche.in → Insert a map row** asks for a type and adds a row with the fields that type needs.

### `markers`: pins

Pins that are not stops on a route: offices, viewpoints, notes for a survey. Columns `id`, `name`, `lng`, `lat`, `description`, `pinned`. An `id` keeps to letters, digits and `_`. `pinned` ticked opens the pin's panel when the atlas loads.

### `waypoints` and `routes`: a route network

`waypoints` lists the stops (`id`, `name`, `lng`, `lat`, `description`). `routes` lists the routes (`id`, `name`, `profile`, `service`, `color`, `waypoints`): `profile` is `driving`, `walking` or `cycling`, and `waypoints` is the stop ids in order, comma-separated. A stop can be on any number of routes.

The two tabs become one routes map at the top of the atlas, with a card for every route in Find's Routes tab and in the map's legend. The columns and the `version` / `updated_at` columns are described in [Route networks in a Google Sheet](?page=route-sheets).

## 3. Links from the sheet

The script adds two formulas you can use in any cell:

- `=AMCHE_ATLAS_LINK(AMCHE_BASE_URL)` is the link that opens this sheet as an atlas.
- `=AMCHE_ROUTE_LINK("R1", AMCHE_BASE_URL)` is a link to one route on its own, with its stops as pins: `?markers=…&layers=route-R1:…`. It works without the sheet being shared, so it can go in a message or a QR code.

Both use the **Base URL** on the **Visualize Map** tab; passing `AMCHE_BASE_URL` makes them update as soon as it changes. The starter `routes` tab has a `link` column filled with `AMCHE_ROUTE_LINK`.

## 4. Saving routes from amche

Routes can be edited on the map: reverse one, take out a stop, drop a pin on the line to add one, change the travel mode or colour. Amche writes edits back to the sheet when you press **Save** in the routes map's legend. It checks the sheet for changes made since it was loaded, and never overwrites them.

To turn this on:

1. In the Apps Script editor, paste the web app script from [Route networks in a Google Sheet → The Apps Script web app](?page=route-sheets#3-the-apps-script-web-app) below the starter script, in the same file.
2. Choose **Deploy → New deployment → Web app**, with **Execute as: Me** and **Who has access: Anyone**, and copy its URL.
3. Paste the URL as the `saveUrl` value in the `atlas` tab.

Anyone who opens the atlas can then save route edits. Writes go through the script as you, so only share the atlas link with people you trust to edit, and keep the sheet's version history in mind for undoing a change.

## 5. From amche back to the sheet

Routes drawn in amche can start a sheet too. Open a route's card, choose **⋯ → Download**, pick **GeoCSV** and **Route sheet**. Amche downloads a waypoints CSV and a routes CSV in this layout. Paste them into the `waypoints` and `routes` tabs with **File → Import → Append to current sheet**.

## The starter script

Where map links and docs open is the **Base URL** cell on the **Visualize Map** tab (named `AMCHE_BASE_URL`). It starts as `https://amche.in/dev/`, where new features such as sheet atlases arrive first, and `BASE_URL` near the top of the script is the value setup puts there. Pick `https://amche.in/` for the main site or `http://localhost/` for amche running on your own computer (add its port, such as `localhost:<port>`, if it has one), or type the address of your own copy of amche. Without `http://` or `https://`, `localhost` and IP addresses get `http://` and anything else `https://`. Every link in the sheet changes as soon as the cell does.

A local address only opens on the computer running amche: share a link built from a public address.

```javascript
// Amche starter sheet - see https://amche.in/dev/docs/?page=sheet-atlas

// Where map links and docs open. Set on the Visualize Map tab (the cell named
// AMCHE_BASE_URL); this is the value setup puts there. For example:
//   'https://amche.in/dev/'   the development site, where sheet atlases arrive first
//   'https://amche.in/'       the main site
//   'http://localhost/'  amche running on your own computer (add its port if it has one)
//   'https://maps.example.org/atlas/'  your own copy of amche
const BASE_URL = 'https://amche.in/dev/';
const BASE_URL_NAME = 'AMCHE_BASE_URL';
const BASE_URL_CHOICES = ['https://amche.in/dev/', 'https://amche.in/', 'http://localhost/'];

// The base URL with its scheme and a trailing slash: localhost and plain IPs default to http
function normalizeBase(value) {
  let url = String(value || BASE_URL).trim();
  if (!/^https?:\/\//i.test(url)) url = (/^(localhost|127\.|\d+\.\d+\.\d+\.\d+)/.test(url) ? 'http://' : 'https://') + url;
  return url.replace(/\/*$/, '/');
}

// `base` as given to a formula, else the Visualize Map tab's cell, else BASE_URL
function amcheBase(base) {
  if (base !== undefined && String(base).trim() !== '') return normalizeBase(base);
  try {
    const cell = SpreadsheetApp.getActive().getRangeByName(BASE_URL_NAME);
    return normalizeBase(cell && cell.getValue());
  } catch (e) {
    return normalizeBase(BASE_URL);
  }
}
const HOME_TAB = 'Visualize Map';

// The fields each layer type needs, from docs/API.md -> Layer Source Formats
const TYPE_TEMPLATES = {
  geojson: { url: 'https://…/data.geojson', style: '{"fill-color": "#2563eb", "line-color": "#1e40af"}', inspect: '{"label": "name"}' },
  csv: { url: 'https://…/points.csv (or a Google Sheet link)', inspect: '{"label": "name"}' },
  sheet: { url: 'https://docs.google.com/spreadsheets/d/…/edit', inspect: '{"label": "name"}' },
  vector: { url: 'https://…/{z}/{x}/{y}.pbf', sourceLayer: 'layer_name', style: '{"line-color": "#e11d48"}' },
  tms: { url: 'https://…/{z}/{x}/{y}.png', opacity: 1 },
  wms: { url: 'https://…/wms', config: '{"layers": "workspace:layer"}' },
  wmts: { url: 'https://…/WMTSCapabilities.xml', config: '{"layer": "layer_id"}' },
  cog: { url: 'https://…/image.tif' },
  img: { url: 'https://…/scan.png', config: '{"coordinates": [[lng, lat], [lng, lat], [lng, lat], [lng, lat]]}' },
  style: { url: 'mapbox://styles/…' },
  routes: { url: 'https://docs.google.com/spreadsheets/d/…/edit', config: '{"saveUrl": ""}' }
};
const LAYER_TYPES = Object.keys(TYPE_TEMPLATES).concat(['js', 'overpass', 'arcgis', 'raster-style-layer', 'layer-group']);
const JSON_COLUMNS = ['style', 'inspect', 'config'];

const ATLAS_KEYS = {
  name: 'The atlas name, shown on the console and splash card',
  description: 'One line about the atlas',
  color: 'The atlas colour, such as #2563eb',
  center: 'The starting view centre as lng, lat. Leave it out to fit the pins and stops',
  zoom: 'The starting zoom, 0 to 22',
  pitch: 'The starting tilt in degrees, 0 to 85',
  bearing: 'The starting rotation in degrees',
  style: 'A basemap style URL, such as mapbox://styles/mapbox/standard',
  saveUrl: 'The /exec URL of the route web app. Without it routes are read only',
  routesTitle: 'The name of the routes map',
  config: 'Any other atlas field as JSON, such as {"areaOfInterest": "Goa"}'
};

// Formula checks: `c` is the cell, such as A2. A cell that fails is flagged
// (not refused) and its help shows when it is selected.
const ID_RULE = c => `=AND(REGEXMATCH(TO_TEXT(${c}), "^[A-Za-z0-9_.-]+$"), COUNTIF($${c.replace(/\d+$/, '')}$2:$${c.replace(/\d+$/, '')}, ${c}) = 1)`;
const COLOR_RULE = c => `=OR(${c} = "", REGEXMATCH(TO_TEXT(${c}), "^#?[0-9A-Fa-f]{6}$"))`;
const STOPS_RULE = c => `=OR(${c} = "", SUMPRODUCT(--ISNA(MATCH(TRIM(SPLIT(${c}, ", ")), INDIRECT("waypoints!A2:A"), 0))) = 0)`;

// Each tab's columns: `type` makes a table column of checkboxes or numbers,
// `choices` a dropdown, `rule` / `between` a check; `help` is the header's
// note and the help shown on a selected cell.
const COLUMNS = {
  atlas: {
    key: { choices: Object.keys(ATLAS_KEYS), help: 'The setting. Pick one from the list.' },
    value: { help: 'The value of the setting. The about column says what it takes.' },
    about: { help: 'What each setting does. amche ignores this column.' }
  },
  layers: {
    id: { rule: ID_RULE, help: 'An amche map id, such as osm-places, mapbox-satellite or local-body, to use that map as it is. Or a new id with a type, for a map of your own. Letters, digits, - and _ only, each id once.' },
    title: { help: 'The map name shown in amche. Needed for a new map.' },
    type: { choices: LAYER_TYPES, help: 'Leave blank to use an existing amche map. Pick a type for a new map; Amche.in → Insert a map row fills in what that type needs.' },
    url: { help: 'Where the data is: a .geojson or .csv file, a tile URL with {z}/{x}/{y}, a WMS endpoint, a Google Sheet link…' },
    initiallyChecked: { type: 'BOOLEAN', help: 'Tick to turn the map on when the atlas opens.' },
    tags: { help: 'Comma-separated tags for filtering maps in Find.' },
    description: { help: 'A line about the map, shown in its details.' },
    attribution: { help: 'Who made the data, shown on the map.' },
    opacity: { type: 'DOUBLE', between: [0, 1], help: 'Opacity, 0 (invisible) to 1 (solid).' },
    sourceLayer: { help: 'For vector tiles: the layer name inside the tiles.' },
    style: { help: 'Mapbox style properties as JSON, such as {"line-color": "#e11d48", "line-width": 2}.' },
    inspect: { help: 'What clicking a feature shows, as JSON, such as {"label": "name"}.' },
    config: { help: 'Any other layer field as JSON. Applied last.' },
    'read-only': { type: 'BOOLEAN', help: 'Ticked: amche never writes back to this map\'s data. Untick on a routes map with a saveUrl to save route edits to its sheet.' }
  },
  markers: {
    id: { rule: ID_RULE, help: 'A short id for the pin: letters, digits, _ . and -, each id once.' },
    name: { help: 'The pin title.' },
    lng: { type: 'DOUBLE', between: [-180, 180], help: 'Longitude, -180 to 180. Right-click a place in Google Maps to copy its lat, lng.' },
    lat: { type: 'DOUBLE', between: [-90, 90], help: 'Latitude, -90 to 90.' },
    description: { help: 'A line of text under the name.' },
    pinned: { type: 'BOOLEAN', help: 'Tick to open the pin panel when the atlas opens.' }
  },
  waypoints: {
    id: { rule: ID_RULE, help: 'The stop id that routes list in their waypoints column. Letters, digits, _ . and -, each id once.' },
    name: { help: 'The stop name.' },
    lng: { type: 'DOUBLE', between: [-180, 180], help: 'Longitude, -180 to 180.' },
    lat: { type: 'DOUBLE', between: [-90, 90], help: 'Latitude, -90 to 90.' },
    description: { help: 'A line of text under the name.' },
    version: { type: 'DOUBLE', help: 'Written when amche saves. Leave it alone.' },
    updated_at: { help: 'Written when amche saves. Leave it alone.' }
  },
  routes: {
    id: { rule: ID_RULE, help: 'The route id, such as R3. Letters, digits and _, each id once.' },
    name: { help: 'The route name shown on its card.' },
    profile: { choices: ['cycling', 'walking', 'driving'], help: 'How the route is travelled.' },
    service: { choices: ['mapbox', 'osrm'], help: 'The routing service. mapbox unless you have a reason.' },
    color: { rule: COLOR_RULE, help: 'The line colour as #rrggbb. Blank uses the route default.' },
    waypoints: { rule: STOPS_RULE, help: 'Stop ids from the waypoints tab in travel order, separated by commas: start first, destination last.' },
    version: { type: 'DOUBLE', help: 'Written when amche saves. Leave it alone.' },
    updated_at: { help: 'Written when amche saves. Leave it alone.' },
    link: { help: 'A link to this route on its own. Filled by =AMCHE_ROUTE_LINK.' }
  }
};

const TABS = {
  atlas: [['key', 'value', 'about'],
    ['name', 'Panjim cycle network'],
    ['description', 'Cycle routes and stops, kept in a Google Sheet'],
    ['color', '#e32017'],
    ['center', '73.8278, 15.4970'],
    ['zoom', 14],
    ['saveUrl', ''],
    ['routesTitle', 'Cycle routes'],
    ['config', '{"areaOfInterest": "Panjim, Goa"}']].map((row, i) => i ? [row[0], row[1], ATLAS_KEYS[row[0]]] : row),
  layers: [['id', 'title', 'type', 'url', 'initiallyChecked', 'tags', 'description', 'attribution', 'opacity', 'sourceLayer', 'style', 'inspect', 'config', 'read-only'],
    ['osm-places', '', '', '', true, '', '', '', '', '', '', '', '', true],
    ['mapbox-satellite', '', '', '', true, '', '', '', '', '', '', '', '', true],
    ['parks', 'Parks', 'geojson', 'https://example.com/parks.geojson', false, 'green spaces', 'Replace with your own data', '', 0.8, '', '{"fill-color": "#16a34a"}', '{"label": "name"}', '', true]],
  markers: [['id', 'name', 'lng', 'lat', 'description', 'pinned'],
    ['bike_repair', 'Bike repair shop', 73.8262, 15.4985, 'Open 9 to 7', false],
    ['viewpoint', 'Altinho viewpoint', 73.8321, 15.4935, 'Best at sunset', true]],
  waypoints: [['id', 'name', 'lng', 'lat', 'description', 'version', 'updated_at'],
    ['church', 'Immaculate Conception Church', 73.8301, 15.4986, '', '', ''],
    ['fontainhas', 'Fontainhas', 73.8341, 15.4971, 'Latin quarter', '', ''],
    ['market', 'Panjim Market', 73.8278, 15.4989, '', '', ''],
    ['promenade', 'Miramar promenade', 73.8135, 15.4847, '', '', '']],
  routes: [['id', 'name', 'profile', 'service', 'color', 'waypoints', 'version', 'updated_at', 'link'],
    ['R1', 'Heritage loop', 'cycling', 'mapbox', '#e32017', 'church,fontainhas,market', '', '', `=AMCHE_ROUTE_LINK(A2, ${BASE_URL_NAME})`],
    ['R2', 'To the sea', 'walking', 'mapbox', '', 'market,promenade', '', '', `=AMCHE_ROUTE_LINK(A3, ${BASE_URL_NAME})`]]
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Amche.in')
    .addItem('🧰 Setup Map Atlas Sheet', 'setUpStarterSheet')
    .addItem('➕ Insert a map row', 'insertLayerRow')
    .addSeparator()
    .addItem('🗺️ Visualize Map', 'visualizeMap')
    .addItem('❓ Help', 'showHelp')
    .addToUi();
}

// Tables need the Sheets API service: Services (+) in the Apps Script editor.
const hasTables = () => typeof Sheets !== 'undefined';

function setUpStarterSheet() {
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  const existing = Object.keys(TABS).concat(HOME_TAB).filter(name => ss.getSheetByName(name));
  if (existing.length && ui.alert(`Replace the tabs ${existing.join(', ')}?`, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const tables = hasTables();
  buildHomeTab(ss);
  Object.entries(TABS).forEach(([name, rows], index) => {
    // A new tab each time: a table can't be laid over an old one.
    const old = ss.getSheetByName(name);
    if (old) old.setName(`${name}_old_${Date.now()}`);
    const sheet = ss.insertSheet(name, index + 1);
    if (old) ss.deleteSheet(old);
    const width = rows[0].length;
    sheet.getRange(1, 1, rows.length, width).setValues(rows.map(row => row.concat(Array(width - row.length).fill(''))));
    if (tables) addTable(sheet, name, rows.length, width);
    else styleAsList(sheet, name, rows.length, width);
    addHelp(sheet, name, tables);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, width);
  });
  watchEdits(ss);
  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
  checkSheet();
  ss.setActiveSheet(ss.getSheetByName(HOME_TAB));
  ui.alert('Done. Share the sheet as "Anyone with the link can view", then choose Amche.in → Visualize Map.' +
    (tables ? '' : '\n\nTip: add the Google Sheets API under Services in the Apps Script editor and run this again to get tables.'));
}

function addTable(sheet, name, height, width) {
  const columnProperties = TABS[name][0].map((column, columnIndex) => {
    const spec = COLUMNS[name][column] || {};
    const property = { columnIndex, columnName: column, columnType: spec.choices ? 'DROPDOWN' : spec.type || 'TEXT' };
    if (spec.choices) property.dataValidationRule = { condition: { type: 'ONE_OF_LIST', values: spec.choices.map(v => ({ userEnteredValue: v })) } };
    return property;
  });
  Sheets.Spreadsheets.batchUpdate({ requests: [{ addTable: { table: {
    name, columnProperties,
    range: { sheetId: sheet.getSheetId(), startRowIndex: 0, endRowIndex: height, startColumnIndex: 0, endColumnIndex: width }
  } } }] }, SpreadsheetApp.getActive().getId());
}

// Without tables: a bold header, banded rows, a filter, and the dropdowns and
// checkboxes a table column would give.
function styleAsList(sheet, name, height, width) {
  sheet.getRange(1, 1, 1, width).setFontWeight('bold');
  sheet.getRange(1, 1, Math.max(height, 2), width).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);
  sheet.getRange(1, 1, Math.max(height, 2), width).createFilter();
  TABS[name][0].forEach((column, i) => {
    const spec = COLUMNS[name][column] || {};
    const cells = sheet.getRange(2, i + 1, sheet.getMaxRows() - 1);
    if (spec.choices) cells.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(spec.choices, true).setAllowInvalid(false).setHelpText(spec.help).build());
    else if (spec.type === 'BOOLEAN') cells.insertCheckboxes();
  });
}

// Each header's note, and the checks with help text on the cells below it.
function addHelp(sheet, name, tables) {
  TABS[name][0].forEach((column, i) => {
    const spec = COLUMNS[name][column];
    if (!spec) return;
    sheet.getRange(1, i + 1).setNote(spec.help);
    let rule = null;
    if (spec.rule) rule = SpreadsheetApp.newDataValidation().requireFormulaSatisfied(spec.rule(sheet.getRange(2, i + 1).getA1Notation()));
    else if (spec.between) rule = SpreadsheetApp.newDataValidation().requireNumberBetween(spec.between[0], spec.between[1]);
    if (!rule) return;
    try {
      sheet.getRange(2, i + 1, sheet.getMaxRows() - 1).setDataValidation(rule.setAllowInvalid(true).setHelpText(spec.help).build());
    } catch (e) {
      console.warn(`No check on ${name}.${column}${tables ? ' (table column)' : ''}: ${e.message}`);
    }
  });
}

// The table on a tab, if it has one.
function tableOf(sheet) {
  if (!hasTables()) return null;
  try {
    const found = Sheets.Spreadsheets.get(SpreadsheetApp.getActive().getId(), { fields: 'sheets(properties.sheetId,tables(tableId))' })
      .sheets.find(s => s.properties.sheetId === sheet.getSheetId());
    return found && found.tables ? found.tables[0] : null;
  } catch (e) {
    return null;
  }
}

// Adds a row at the end of a tab's table, growing the table, or after the
// last row of a tab without one.
function appendRow(sheet, values) {
  const table = tableOf(sheet);
  if (!table) return sheet.appendRow(values);
  const cell = v => ({ userEnteredValue: typeof v === 'boolean' ? { boolValue: v } : typeof v === 'number' ? { numberValue: v }
    : String(v).startsWith('=') ? { formulaValue: String(v) } : { stringValue: String(v) } });
  Sheets.Spreadsheets.batchUpdate({ requests: [{ appendCells: {
    sheetId: sheet.getSheetId(), tableId: table.tableId, rows: [{ values: values.map(cell) }], fields: 'userEnteredValue'
  } }] }, SpreadsheetApp.getActive().getId());
}

function insertLayerRow() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.prompt('Insert a map row', `Type of map: ${Object.keys(TYPE_TEMPLATES).join(', ')}`, ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  const type = answer.getResponseText().trim().toLowerCase();
  if (!TYPE_TEMPLATES[type]) return ui.alert(`Unknown type "${type}"`);
  const sheet = SpreadsheetApp.getActive().getSheetByName('layers');
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const values = Object.assign({ id: `new_${type}_${sheet.getLastRow()}`, title: `New ${type} map`, type, initiallyChecked: true, 'read-only': true }, TYPE_TEMPLATES[type]);
  appendRow(sheet, header.map(column => values[column] === undefined ? '' : values[column]));
  SpreadsheetApp.flush();
  sheet.activate();
  sheet.setActiveRange(sheet.getRange(sheet.getLastRow(), 1));
}

// The first tab: the map link, how the sheet works, and the problems in the sheet.
const HOME_ROWS = [
  ['Amche.in map atlas', ''],
  ['', ''],
  ['Open the map', `=HYPERLINK(AMCHE_ATLAS_LINK(${BASE_URL_NAME}), "Open the map ↗")`],
  ['Map link', `=AMCHE_ATLAS_LINK(${BASE_URL_NAME})`],
  ['Base URL', BASE_URL],
  ['', 'Where map links and docs open: https://amche.in/dev/ (new features first), https://amche.in/, localhost for amche on your own computer, or the address of your own copy. Every link in this sheet follows it. A local address only opens on the computer running amche.'],
  ['Sharing', 'Share this sheet as "Anyone with the link can view" (Share → General access), or amche can\'t read it.'],
  ['Updates', 'Changes to this sheet show on the map in a few minutes: Google takes a while to publish a sheet\'s latest data. If a change still doesn\'t show after that, reload the map with the browser cache cleared (Ctrl+Shift+R, or Cmd+Shift+R on a Mac).'],
  ['', ''],
  ['How this sheet works', ''],
  ['atlas', 'Settings for the whole map: its name, colour, starting view. One setting per row; the about column says what each does.'],
  ['layers', 'The maps, one per row, first row on top. An id alone uses a map amche already has; a type makes a new one. Amche.in → Insert a map row fills in what a type needs.'],
  ['markers', 'Pins that are not route stops: offices, viewpoints, survey notes.'],
  ['waypoints', 'The stops routes pass through. Routes list them by id.'],
  ['routes', 'Routes through the stops, in travel order, with how they are travelled.'],
  ['Help', 'Hover over a column header for what goes in it. Select a cell for its help. Problems below update by themselves whenever the sheet is edited.'],
  ['', ''],
  ['Docs', ''],
  ['Guide', `=HYPERLINK(AMCHE_BASE(${BASE_URL_NAME}) & "docs/?page=sheet-atlas", "An atlas in a Google Sheet")`],
  ['Layer settings', `=HYPERLINK(AMCHE_BASE(${BASE_URL_NAME}) & "docs/?page=url-api#layer-source-formats", "Layer Source Formats (URL API)")`],
  ['URL API', `=HYPERLINK(AMCHE_BASE(${BASE_URL_NAME}) & "docs/?page=url-api", "Using the URL API")`],
  ['Routes', `=HYPERLINK(AMCHE_BASE(${BASE_URL_NAME}) & "docs/?page=route-sheets", "Route networks in a Google Sheet")`],
  ['', ''],
  ['Problems', ''],
  ['Status', 'Not checked yet: edit any cell, or choose Amche.in → Visualize Map']
];
const STATUS_ROW = HOME_ROWS.length;
const PROBLEM_HEADER_ROW = STATUS_ROW + 2;
const PROBLEM_COLUMNS = ['Tab', 'Cell', 'Value', 'Problem'];

function buildHomeTab(ss) {
  const old = ss.getSheetByName(HOME_TAB);
  if (old) old.setName(`${HOME_TAB}_old_${Date.now()}`);
  const sheet = ss.insertSheet(HOME_TAB, 0);
  if (old) ss.deleteSheet(old);
  sheet.getRange(1, 1, HOME_ROWS.length, 2).setValues(HOME_ROWS);
  sheet.getRange(1, 1).setFontSize(16).setFontWeight('bold');
  ['How this sheet works', 'Docs', 'Problems'].forEach(title => {
    sheet.getRange(HOME_ROWS.findIndex(row => row[0] === title) + 1, 1).setFontSize(12).setFontWeight('bold');
  });
  sheet.getRange(3, 1, HOME_ROWS.length - 2, 1).setFontWeight('bold').setVerticalAlignment('top');
  sheet.getRange(3, 2).setFontSize(13).setFontWeight('bold');
  sheet.getRange(1, 2, HOME_ROWS.length, 1).setWrap(true).setVerticalAlignment('top');
  const base = sheet.getRange(HOME_ROWS.findIndex(row => row[0] === 'Base URL') + 1, 2);
  ss.setNamedRange(BASE_URL_NAME, base);
  base.setFontFamily('monospace').setBackground('#fef9c3').setNote('Where map links and docs open. Pick one or type your own.')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(BASE_URL_CHOICES, true).setAllowInvalid(true)
      .setHelpText('Pick one, or type the address of your own copy of amche, such as localhost').build());
  sheet.getRange(PROBLEM_HEADER_ROW, 1, 1, PROBLEM_COLUMNS.length).setValues([PROBLEM_COLUMNS]).setFontWeight('bold').setBackground('#e5e7eb');
  sheet.setColumnWidth(1, 140);
  sheet.setColumnWidth(2, 420);
  sheet.setColumnWidth(3, 200);
  sheet.setColumnWidth(4, 420);
  sheet.setHiddenGridlines(true);
  return sheet;
}

// Every problem amche would trip over, one entry per cell: {tab, row, column, value, problem}.
function findProblems() {
  const ss = SpreadsheetApp.getActive();
  const problems = [];
  const read = name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 1) return null;
    const values = sheet.getDataRange().getValues();
    const header = values[0].map(h => String(h).trim());
    return { sheet, header, rows: values.slice(1), col: field => header.indexOf(field) };
  };
  const text = v => String(v === undefined || v === null ? '' : v).trim();
  const add = (tab, t, i, field, problem) => {
    const column = Math.max(t.col(field), 0);
    problems.push({ tab, sheet: t.sheet, row: i + 2, column: column + 1, value: text(t.rows[i][column]), problem });
  };
  const ids = (tab, t, pattern, hint) => {
    const seen = {};
    t.rows.forEach((row, i) => {
      const id = text(row[t.col('id')]);
      if (!id) return;
      if (!pattern.test(id)) add(tab, t, i, 'id', hint);
      if (seen[id]) add(tab, t, i, 'id', `Duplicate id, also on row ${seen[id]}`);
      seen[id] = seen[id] || i + 2;
    });
  };
  const json = (tab, t, i, field) => {
    const value = t.col(field) >= 0 ? text(t.rows[i][t.col(field)]) : '';
    if (!value) return;
    try { JSON.parse(value); } catch (e) { add(tab, t, i, field, `Not valid JSON: ${e.message}`); }
  };
  const lngLat = (tab, t) => t.rows.forEach((row, i) => {
    if (!text(row[t.col('id')])) return;
    [['lng', 180], ['lat', 90]].forEach(([field, limit]) => {
      const value = text(row[t.col(field)]);
      if (value === '' || !isFinite(Number(value)) || Math.abs(Number(value)) > limit) add(tab, t, i, field, `Needs a number from -${limit} to ${limit}`);
    });
  });

  const atlas = read('atlas');
  if (atlas) atlas.rows.forEach((row, i) => {
    const key = text(row[atlas.col('key')]);
    const value = text(row[atlas.col('value')]);
    if (!key || !value) return;
    if (key === 'center' && !/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(value)) add('atlas', atlas, i, 'value', 'center is "lng, lat", such as 73.82, 15.49');
    if (['zoom', 'pitch', 'bearing'].includes(key) && !isFinite(Number(value))) add('atlas', atlas, i, 'value', `${key} must be a number`);
    if (key === 'color' && !/^#[0-9A-Fa-f]{6}$/.test(value)) add('atlas', atlas, i, 'value', 'A colour as #rrggbb');
    if (key === 'saveUrl' && !/^https:\/\/script\.google\.com\/.+\/exec$/.test(value)) add('atlas', atlas, i, 'value', 'The Apps Script web app URL ending in /exec');
    if (key === 'config') json('atlas', atlas, i, 'value');
  });

  const layers = read('layers');
  if (layers) {
    ids('layers', layers, /^[A-Za-z0-9_-]+$/, 'Use letters, digits, - and _ only');
    layers.rows.forEach((row, i) => {
      if (!text(row[layers.col('id')])) return;
      const type = text(row[layers.col('type')]);
      if (type && !LAYER_TYPES.includes(type)) add('layers', layers, i, 'type', 'Unknown type: see Layer Source Formats');
      if (type && type !== 'layer-group' && layers.col('url') >= 0 && !text(row[layers.col('url')])) add('layers', layers, i, 'url', `A ${type} map needs a url`);
      if (type && !text(row[layers.col('title')])) add('layers', layers, i, 'title', 'A new map needs a title');
      JSON_COLUMNS.forEach(field => json('layers', layers, i, field));
    });
  }

  const markers = read('markers');
  if (markers) { ids('markers', markers, /^[A-Za-z0-9_.-]+$/, 'Use letters, digits, _ . and - only'); lngLat('markers', markers); }

  const waypoints = read('waypoints');
  const stopIds = {};
  if (waypoints) {
    ids('waypoints', waypoints, /^[A-Za-z0-9_.-]+$/, 'Use letters, digits, _ . and - only');
    lngLat('waypoints', waypoints);
    waypoints.rows.forEach(row => { stopIds[text(row[waypoints.col('id')])] = true; });
  }

  const routes = read('routes');
  if (routes) {
    ids('routes', routes, /^[A-Za-z0-9_]+$/, 'Use letters, digits and _ only');
    routes.rows.forEach((row, i) => {
      if (!text(row[routes.col('id')])) return;
      const profile = text(row[routes.col('profile')]);
      const service = text(row[routes.col('service')]);
      const color = text(row[routes.col('color')]);
      const stops = text(row[routes.col('waypoints')]).split(/[\s,;]+/).filter(String);
      if (profile && !COLUMNS.routes.profile.choices.includes(profile)) add('routes', routes, i, 'profile', `One of ${COLUMNS.routes.profile.choices.join(', ')}`);
      if (service && !COLUMNS.routes.service.choices.includes(service)) add('routes', routes, i, 'service', `One of ${COLUMNS.routes.service.choices.join(', ')}`);
      if (color && !/^#?[0-9A-Fa-f]{6}$/.test(color)) add('routes', routes, i, 'color', 'A colour as #rrggbb');
      if (stops.length < 2) add('routes', routes, i, 'waypoints', 'A route needs at least two stops');
      const missing = stops.filter(id => !stopIds[id]);
      if (missing.length) add('routes', routes, i, 'waypoints', `Not in the waypoints tab: ${missing.join(', ')}`);
    });
  }
  return problems;
}

// Re-checks the sheet after every edit and every added or removed row. An
// installable trigger rather than onEdit(), which the route web app script
// (docs/route-sheets.md) already defines in the same project.
function watchEdits(ss) {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'onSheetChanged')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('onSheetChanged').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('onSheetChanged').forSpreadsheet(ss).onChange().create();
}

function onSheetChanged(e) {
  const name = e && e.range ? e.range.getSheet().getName() : '';
  if (name === HOME_TAB) return;
  checkSheet();
}

// Checks the sheet: problem cells turn red with a note, and the problems are listed on the Visualize Map tab.
function checkSheet() {
  const ss = SpreadsheetApp.getActive();
  const problems = findProblems();
  Object.keys(TABS).forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet && sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).setBackground(null).clearNote();
  });
  problems.forEach(p => p.sheet.getRange(p.row, p.column).setBackground('#fecaca').setNote(p.problem));

  const home = ss.getSheetByName(HOME_TAB) || buildHomeTab(ss);
  const first = PROBLEM_HEADER_ROW + 1;
  if (home.getMaxRows() >= first) home.getRange(first, 1, home.getMaxRows() - first + 1, PROBLEM_COLUMNS.length).clearContent().setBackground(null);
  if (problems.length) {
    home.getRange(first, 1, problems.length, PROBLEM_COLUMNS.length).setValues(problems.map(p => {
      const cell = p.sheet.getRange(p.row, p.column).getA1Notation();
      return [p.tab, `=HYPERLINK("#gid=${p.sheet.getSheetId()}&range=${cell}", "${p.tab}!${cell}")`, p.value, p.problem];
    })).setBackground('#fef2f2').setWrap(true);
  }
  const status = home.getRange(STATUS_ROW, 2);
  status.setValue(problems.length
    ? `⚠️ ${problems.length} problem${problems.length === 1 ? '' : 's'} found ${new Date().toLocaleString()}: fix them below, then check again`
    : `✅ No problems found ${new Date().toLocaleString()}`)
    .setFontWeight('bold').setFontColor(problems.length ? '#b91c1c' : '#15803d');
  return problems;
}

// Visualize Map: check the sheet, show the Visualize Map tab, and open the map in a new tab.
function visualizeMap() {
  const ss = SpreadsheetApp.getActive();
  const problems = checkSheet();
  ss.setActiveSheet(ss.getSheetByName(HOME_TAB));
  const url = AMCHE_ATLAS_LINK();
  const warning = problems.length ? `<p style="color:#b91c1c">⚠️ ${problems.length} problem(s) in the sheet - listed on the ${HOME_TAB} tab.</p>` : '';
  const html = HtmlService.createHtmlOutput(`<script>window.open(${JSON.stringify(url)}, '_blank');</script>` +
    `<p style="font-family:sans-serif"><a href="${url}" target="_blank">Open the map ↗</a> (if it didn't open by itself)</p>${warning}` +
    `<p style="font:12px sans-serif;color:#555">Changes take a few minutes to reach the map. Still not there? Reload the map with the cache cleared (Ctrl+Shift+R).</p>`)
    .setWidth(420).setHeight(problems.length ? 190 : 150);
  SpreadsheetApp.getUi().showModalDialog(html, 'Visualize Map');
}

function showHelp() {
  const url = `${amcheBase()}docs/?page=sheet-atlas`;
  const html = HtmlService.createHtmlOutput(`<script>window.open(${JSON.stringify(url)}, '_blank');</script><p><a href="${url}" target="_blank">Open the guide: An atlas in a Google Sheet</a></p>`).setWidth(360).setHeight(90);
  SpreadsheetApp.getUi().showModalDialog(html, 'Amche.in help');
}

/** The base URL from the Visualize Map tab, cleaned up, e.g. =AMCHE_BASE(AMCHE_BASE_URL). @customfunction */
function AMCHE_BASE(base) {
  return amcheBase(base);
}

/** The link that opens this sheet as an amche atlas, e.g. =AMCHE_ATLAS_LINK(AMCHE_BASE_URL). @customfunction */
function AMCHE_ATLAS_LINK(base) {
  return `${amcheBase(base)}?atlas=https://docs.google.com/spreadsheets/d/${SpreadsheetApp.getActive().getId()}/edit`;
}

/** A standalone link to one route and its stops, e.g. =AMCHE_ROUTE_LINK("R1", AMCHE_BASE_URL). @customfunction */
function AMCHE_ROUTE_LINK(routeId, base) {
  const ss = SpreadsheetApp.getActive();
  const read = name => {
    const values = ss.getSheetByName(name).getDataRange().getValues();
    const header = values[0].map(String);
    return values.slice(1).map(row => Object.fromEntries(header.map((h, i) => [h, row[i]])));
  };
  const route = read('routes').find(r => String(r.id) === String(routeId));
  if (!route) return '';
  const stops = read('waypoints');
  const ids = String(route.waypoints).split(/[\s,]+/).filter(Boolean);
  // As amche writes names: the characters a link splits on escaped once more
  const guard = { '%': '%25', ',': '%2C', '(': '%28', ')': '%29' };
  const escape = text => encodeURIComponent(String(text || '').replace(/[%,()]/g, ch => guard[ch]));
  const markers = ids.map(id => stops.find(s => String(s.id) === id)).filter(Boolean)
    .map(s => `${s.id}(${s.lng},${s.lat}${s.name ? `,${escape(s.name)}` : ''})`).join(',');
  const color = /^#?[0-9a-f]{6}$/i.test(String(route.color)) ? `,%23${String(route.color).replace('#', '')}` : '';
  const token = `${route.service || 'mapbox'}-${route.profile || 'driving'}`;
  return `${amcheBase(base)}?markers=${markers}&layers=route-${route.id}:${token}(${ids.join(',')}${color})`;
}
```
