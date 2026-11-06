# Route networks in a Google Sheet

A route network (a set of locations and the routes between them) can be kept in a Google Sheet instead of in a link or an atlas file. The sheet holds two tables: one row per location and one row per route. A location is any place saved on the map. Each route lists the locations it stops at, in order, so one location can be a stop on any number of routes, or on none. Anyone can edit the sheet directly, amche can read it as a layer, and the sheet's own formulas can build an amche link for every route.

The rows map one-to-one onto the URL shorthand amche already uses: a location row is one [`?markers=`](API.md#markers) entry and a route row is one [`route-<rid>:`](API.md#dynamic-layer-shortcuts) layer entry. The same network round-trips through a sheet, a link, an atlas config and a CSV or GeoJSON exported from a route layer.

- [1. Sheet layout](#1-sheet-layout)
- [2. Formulas that build amche links](#2-formulas-that-build-amche-links)
- [3. The Apps Script web app](#3-the-apps-script-web-app)
- [4. The sheet as a route layer](#4-the-sheet-as-a-route-layer)
- [5. CSV and GeoJSON from amche back into the sheet](#5-csv-and-geojson-from-amche-back-into-the-sheet)
- [Code reference](#code-reference)

## 1. Sheet layout

Make two tabs named **locations** and **routes**. Column names are read case-insensitively and in any order. Columns the app doesn't know, such as the formula columns in section 2, are left alone.

### `locations`: one row per location

| Column | Required | Notes |
|---|---|---|
| `id` | yes | The location id. Same rules as a [`markers`](API.md#markers) id: no spaces (a space is read as `_`) and none of `( ) , :`. Unique within the tab. Routes refer to the location by this id. |
| `name` | no | The location's title. Also read from `title`, `label`. |
| `lng` | yes | Longitude, -180 to 180. Also read from `lon`, `long`, `longitude`, `x`. |
| `lat` | yes | Latitude, -90 to 90. Also read from `latitude`, `y`. |
| `description` | no | A line of text under the name. Also read from `desc`, `notes`. |
| `pinned` | no | `TRUE` opens the location's panel when the map loads (a checkbox in the sheet). |
| `version` | no | Written by the Apps Script. Leave it alone. See [conflicts](#how-conflicts-are-detected). |
| `updated_at` | no | Written by the Apps Script, as an ISO timestamp. |

A location that a route lists is a stop on that route. In amche it is still one location: Find's Locations list shows it with a badge for each route it is on.

### `routes`: one row per route

| Column | Required | Notes |
|---|---|---|
| `id` | yes | The route id, the `<rid>` in `route-<rid>:`. Letters, digits and `_` only. A leading `route-` is dropped. |
| `name` | no | The route's name. It isn't carried in a link. |
| `profile` | no | `driving`, `walking` or `cycling`. Defaults to the service's default (`driving`). Also read from `mode`. |
| `service` | no | The routing service: a key of `ROUTING_ENGINES` in `js/search/directions-router.js` (`mapbox`, `osrm`). Defaults to `mapbox`. Also read from `engine`. |
| `color` | no | `#rrggbb`. The `#` is optional. Leave it blank to use the route's default colour. |
| `locations` | yes | Two or more location ids separated by commas or spaces, start first and destination last. Every id must be a row in `locations`. |
| `version`, `updated_at` | no | As in `locations`. |

A row that can't be used is skipped and reported with its sheet line: a missing or duplicate id, coordinates out of range, an unknown service or profile, fewer than two stops, or a stop with no `locations` row. A colour that isn't `#rrggbb` is ignored and the route is kept.

### Example: a small Goa cycling network

**locations**

| id | name | lng | lat | description | pinned | version | updated_at | routes |
|---|---|---|---|---|---|---|---|---|
| panjim_market | Panjim Market | 73.8278 | 15.4989 | Start of every ride | | 1 | 2026-11-05T09:00:00.000Z | heritage, coast |
| miramar | Miramar Beach | 73.8079 | 15.4826 | | | 1 | 2026-11-05T09:00:00.000Z | coast |
| dona_paula | Dona Paula Jetty | 73.8053 | 15.4558 | Viewpoint at the end of the headland | | 1 | 2026-11-05T09:00:00.000Z | coast |
| ribandar | Ribandar Causeway | 73.8597 | 15.5008 | Flat ride along the Mandovi | | 1 | 2026-11-05T09:00:00.000Z | heritage |
| old_goa | Basilica of Bom Jesus | 73.9116 | 15.5009 | | | 1 | 2026-11-05T09:00:00.000Z | heritage |
| betim | Betim Jetty | 73.8238 | 15.5034 | | | 1 | 2026-11-05T09:00:00.000Z | fort |
| reis_magos | Reis Magos Fort | 73.8091 | 15.4967 | | | 1 | 2026-11-05T09:00:00.000Z | fort |
| bike_repair | Bike repair shop | 73.8262 | 15.4985 | Open 9 to 7 | TRUE | 1 | 2026-11-05T09:00:00.000Z | |

`routes` is a formula column (section 2) listing the routes that stop at each location. amche doesn't read it. `bike_repair` is on no route, so it is a plain location.

**routes**

| id | name | profile | service | color | locations | version | updated_at |
|---|---|---|---|---|---|---|---|
| heritage | Panjim to Old Goa | cycling | mapbox | #e32017 | panjim_market ribandar old_goa | 1 | 2026-11-05T09:00:00.000Z |
| coast | Coastal ride | cycling | mapbox | #00a651 | panjim_market, miramar, dona_paula | 1 | 2026-11-05T09:00:00.000Z |
| fort | Fort walk | walking | mapbox | #b933ad | betim reis_magos | 1 | 2026-11-05T09:00:00.000Z |

The `heritage` route opens with this link:

```
https://amche.in/?atlas=goa&markers=panjim_market(73.8278,15.4989,Panjim%20Market,Start%20of%20every%20ride),ribandar(73.8597,15.5008,Ribandar%20Causeway,Flat%20ride%20along%20the%20Mandovi),old_goa(73.9116,15.5009,Basilica%20of%20Bom%20Jesus)&layers=route-heritage:mapbox-cycling(panjim_market,ribandar,old_goa,%23e32017)
```

## 2. Formulas that build amche links

These formulas sit in columns to the right of the data. They use `MAP`/`LAMBDA`, so each one is entered once in row 2 and fills the whole column, including rows the Apps Script adds later. Change `https://amche.in/?atlas=goa` to your own atlas.

**locations!I1** `routes`, and **locations!I2**: the routes that stop at each location, from the `locations` column of the routes tab (`F`).

```
=MAP(A2:A, LAMBDA(id,
  IF(id = "", "",
    IFERROR(TEXTJOIN(", ", TRUE, FILTER(routes!A2:A,
      ISNUMBER(FIND("," & id & ",", "," & REGEXREPLACE(routes!F2:F & "", "[\s,;]+", ",") & ",")))), ""))))
```

**locations!J1** `marker`, and **locations!J2**: each location's `markers=` entry.

```
=MAP(A2:A, B2:B, C2:C, D2:D, E2:E, LAMBDA(id, name, lng, lat, desc,
  IF(id = "", "",
    id & "(" & ROUND(lng, 6) & "," & ROUND(lat, 6) &
    IF(AND(name = "", desc = ""), "",
      "," & ENCODEURL(REGEXREPLACE(name & "", "[,()]", " ")) &
      IF(desc = "", "", "," & ENCODEURL(REGEXREPLACE(desc & "", "[,()]", " ")))) &
    ")")))
```

A link's reader splits on `,` `(` `)` even when they are percent-encoded, so the formula turns them into spaces in names and descriptions. Links built by amche itself (`toAmcheUrl()`, see [Code reference](#code-reference)) keep them by escaping twice.

**routes!I1** `layer`, and **routes!I2**: each route's `route-<rid>:` entry.

```
=MAP(A2:A, C2:C, D2:D, E2:E, F2:F, LAMBDA(id, profile, service, color, stops,
  IF(OR(id = "", stops = ""), "",
    "route-" & id & ":" &
    LOWER(IF(service = "", "mapbox", service)) & "-" & LOWER(IF(profile = "", "driving", profile)) &
    "(" & REGEXREPLACE(TRIM(stops), "[\s,;]+", ",") &
    IF(color = "", "", "," & SUBSTITUTE(IF(LEFT(color, 1) = "#", color, "#" & color), "#", "%23")) &
    ")")))
```

**routes!J1** `link`, and **routes!J2**: a link that opens one route with only the locations it stops at. `VLOOKUP` finds each stop's `marker` entry in the locations tab, `UNIQUE` drops a repeated stop (a loop that returns to its start), and `TEXTJOIN` joins them.

```
=MAP(A2:A, F2:F, I2:I, LAMBDA(id, stops, layer,
  IF(layer = "", "",
    LET(ids, TRANSPOSE(SPLIT(REGEXREPLACE(TRIM(stops), "[\s,;]+", ","), ",")),
        entries, TEXTJOIN(",", TRUE, UNIQUE(IFERROR(VLOOKUP(ids, locations!A:J, 10, FALSE), ""))),
        "https://amche.in/?atlas=goa&markers=" & entries & "&layers=" & layer))))
```

**The whole network** in one link, in any cell, for example on a third `links` tab:

```
="https://amche.in/?atlas=goa&markers=" & TEXTJOIN(",", TRUE, locations!J2:J) & "&layers=" & TEXTJOIN(",", TRUE, routes!I2:I)
```

To make the links clickable, wrap them as `HYPERLINK(<link>, "Open")`. Keep ids to ASCII letters, digits, `_`, `-` and `.` if you build links with these formulas. amche accepts any id, but the formulas don't percent-encode them.

## 3. The Apps Script web app

Writes go through a small Google Apps Script web app deployed on the sheet, the same way the notes layer works (see [Writing notes back to a Google Sheet](API.md#writing-notes-back-to-a-google-sheet)). There is no sign-in. The script runs as the sheet owner, so any visitor can edit through amche without authenticating.

The script:

- **`GET ?action=list`** returns both tabs as `{status: "ok", locations: [...], routes: [...]}`, keyed by the canonical column names. amche reads through the script, not the CSV export, when the layer has a `saveUrl`. The script reads the live sheet, while the CSV export can lag behind recent edits by a minute or more, which would hide conflicts.
- **`POST {action: "apply", ops: [...]}`** applies a batch of `insert`, `update` and `delete` operations atomically under a script lock. Each `update` and `delete` carries `base`, the row as the client last saw it. If any row in the batch no longer matches its `base`, or an `insert` id is already taken, nothing is written and the response is `{status: "conflict", conflicts: [{table, id, remote, reason}]}`. Otherwise every written row gets `version + 1` and a fresh `updated_at`, and the response is `{status: "ok", rows: {locations, routes}, deleted: {locations, routes}}`.
- A single operation can also be posted on its own: `{action: "insert" | "update" | "delete", table, id, row, base}`.
- **`onEdit`** (optional) bumps `version` and `updated_at` on rows edited by hand in the sheet. Conflicts are detected without it, because `base` is compared field by field, but with it the `version` column shows every change.

### How conflicts are detected

1. When the user starts editing, amche reads the sheet and keeps that copy as the *base snapshot* (`RouteSheetSync.refresh()`).
2. On save or delete, amche reads the sheet again. Each row being written is compared with its base: its content (`id`, names, coordinates, `pinned`, stops, colour, profile, service) and its `version` / `updated_at`. A row that changed, was deleted upstream, or whose id was taken by a new row since is a conflict. Nothing is written.
3. The script repeats the comparison under a lock, which catches a write that lands between steps 2 and 3.
4. While conflicts remain, amche refuses further updates and deletes to those rows. Each conflict is settled in one of two ways: **insert as new** writes the local version as a new row with a fresh id (`heritage` becomes `heritage_2`) and leaves the sheet's row as it is, and **discard** drops the local version and takes the sheet's. Conflict mode ends when none remain.

### Script

Open the sheet → **Extensions → Apps Script**, delete the placeholder and paste:

```javascript
var TABLES = {
  locations: { tabs: ['locations'], gidParam: 'locationsGid',
               columns: ['id', 'name', 'lng', 'lat', 'description', 'pinned', 'version', 'updated_at'],
               content: ['id', 'name', 'lng', 'lat', 'description', 'pinned'] },
  routes:    { tabs: ['routes', 'route'], gidParam: 'routesGid',
               columns: ['id', 'name', 'profile', 'service', 'color', 'locations', 'version', 'updated_at'],
               content: ['id', 'name', 'profile', 'service', 'color', 'locations'] }
};

var ALIASES = {
  id: ['id'],
  name: ['name', 'title', 'label'],
  lng: ['lng', 'lon', 'long', 'longitude', 'x'],
  lat: ['lat', 'latitude', 'y'],
  description: ['description', 'desc', 'notes'],
  pinned: ['pinned'],
  profile: ['profile', 'mode'],
  service: ['service', 'engine'],
  color: ['color', 'colour'],
  locations: ['locations'],
  version: ['version'],
  updated_at: ['updated_at', 'updatedat', 'updated']
};

function json(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function sheetFor(ss, table, gid, create) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (gid !== undefined && gid !== '' && String(sheets[i].getSheetId()) === String(gid)) return sheets[i];
  }
  for (var j = 0; j < sheets.length; j++) {
    if (TABLES[table].tabs.indexOf(sheets[j].getName().trim().toLowerCase()) !== -1) return sheets[j];
  }
  if (!create) return null;
  var sheet = ss.insertSheet(table);
  sheet.getRange(1, 1, 1, TABLES[table].columns.length).setValues([TABLES[table].columns]);
  return sheet;
}

function tableOfSheet(sheet) {
  var name = sheet.getName().trim().toLowerCase();
  for (var table in TABLES) if (TABLES[table].tabs.indexOf(name) !== -1) return table;
  return null;
}

// Header row -> { field: column index }, adding a header for any field the tab lacks when `addMissing`.
function columnsOf(sheet, table, addMissing) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var cols = {};
  headers.forEach(function (h, i) {
    var key = String(h).trim().toLowerCase();
    for (var field in ALIASES) {
      if (cols[field] === undefined && ALIASES[field].indexOf(key) !== -1) { cols[field] = i; break; }
    }
  });
  if (addMissing) {
    TABLES[table].columns.forEach(function (field) {
      if (cols[field] !== undefined) return;
      var col = headers.length;
      while (col < lastCol && headers[col] !== '') col++;
      headers[col] = field;
      cols[field] = col;
      sheet.getRange(1, col + 1).setValue(field);
      lastCol = Math.max(lastCol, col + 1);
    });
  }
  return cols;
}

function cellValue(v) {
  return v instanceof Date ? v.toISOString() : v;
}

function readTable(sheet, table) {
  if (!sheet) return { rows: [], byId: {}, cols: {}, lastRow: 1 };
  var cols = columnsOf(sheet, table, false);
  var values = sheet.getDataRange().getValues();
  var rows = [], byId = {}, lastRow = 1;
  for (var r = 1; r < values.length; r++) {
    var row = {};
    for (var field in cols) row[field] = cellValue(values[r][cols[field]]);
    var id = normalized(table, 'id', row.id);
    if (id === '') continue;
    lastRow = r + 1;
    rows.push(row);
    if (byId[id] === undefined) byId[id] = { row: row, rowNumber: r + 1 };
  }
  return { rows: rows, byId: byId, cols: cols, lastRow: lastRow };
}

function normalized(table, field, v) {
  var s = v === undefined || v === null ? '' : String(cellValue(v)).trim();
  if (field === 'id') return table === 'routes' ? s.replace(/^route-/, '') : s.replace(/\s+/g, '_');
  if ((field === 'lng' || field === 'lat') && s !== '' && isFinite(Number(s))) return String(parseFloat(Number(s).toFixed(6)));
  if (field === 'locations') return s.split(/[\s,;]+/).filter(String).join(',');
  if (field === 'pinned') return /^(true|yes|y|1|on|x|✓)$/i.test(s) ? 'true' : '';
  if (field === 'color' || field === 'profile' || field === 'service') return s.toLowerCase();
  return s;
}

// Whether the row in the sheet is still the row the client based its edit on.
function unchanged(table, current, base) {
  if (!base) return false;
  var fields = TABLES[table].content.concat(['version', 'updated_at']);
  for (var i = 0; i < fields.length; i++) {
    if (normalized(table, fields[i], current[fields[i]]) !== normalized(table, fields[i], base[fields[i]])) return false;
  }
  return true;
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if ((p.action || 'list') !== 'list') return json({ status: 'error', message: 'Unknown action' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = { status: 'ok' };
  for (var table in TABLES) result[table] = readTable(sheetFor(ss, table, p[TABLES[table].gidParam], false), table).rows;
  return json(result);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var data = JSON.parse(e.postData.contents);
    var ops = data.action === 'apply' ? (data.ops || [])
      : [{ op: data.action, table: data.table, id: data.id, row: data.row, base: data.base }];
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var state = {};
    ops.forEach(function (op) {
      if (!TABLES[op.table]) throw new Error('Unknown table ' + op.table);
      if (['insert', 'update', 'delete'].indexOf(op.op) === -1) throw new Error('Unknown op ' + op.op);
      if (!state[op.table]) {
        var sheet = sheetFor(ss, op.table, data[TABLES[op.table].gidParam], true);
        columnsOf(sheet, op.table, true);
        state[op.table] = { sheet: sheet, data: readTable(sheet, op.table) };
      }
    });

    // Check every op before writing any.
    var conflicts = [];
    ops.forEach(function (op) {
      var id = normalized(op.table, 'id', op.id);
      var current = state[op.table].data.byId[id];
      if (op.op === 'insert') {
        if (current) conflicts.push({ table: op.table, id: id, remote: current.row, reason: 'exists' });
      } else if (!current) {
        if (op.op === 'update') conflicts.push({ table: op.table, id: id, remote: null, reason: 'deleted' });
      } else if (!unchanged(op.table, current.row, op.base)) {
        conflicts.push({ table: op.table, id: id, remote: current.row, reason: 'changed' });
      }
    });
    if (conflicts.length) return json({ status: 'conflict', conflicts: conflicts });

    var now = new Date().toISOString();
    var rows = { locations: [], routes: [] }, deleted = { locations: [], routes: [] }, toDelete = {};
    ops.forEach(function (op) {
      var t = state[op.table], cols = t.data.cols, id = normalized(op.table, 'id', op.id);
      var current = t.data.byId[id];
      if (op.op === 'delete') {
        if (current) { (toDelete[op.table] = toDelete[op.table] || []).push(current.rowNumber); deleted[op.table].push(id); }
        return;
      }
      var row = {};
      TABLES[op.table].content.forEach(function (field) { row[field] = op.row[field] === undefined ? '' : op.row[field]; });
      row.id = id;
      if (op.table === 'locations') row.pinned = normalized('locations', 'pinned', row.pinned) === 'true';
      row.version = (current ? Number(current.row.version) || 0 : 0) + 1;
      row.updated_at = now;
      var rowNumber = current ? current.rowNumber : ++t.data.lastRow;
      // Only the data columns are written, so formula columns beside them are kept.
      TABLES[op.table].columns.forEach(function (field) {
        t.sheet.getRange(rowNumber, cols[field] + 1).setValue(row[field]);
      });
      t.data.byId[id] = { row: row, rowNumber: rowNumber };
      rows[op.table].push(row);
    });
    for (var table in toDelete) {
      toDelete[table].sort(function (a, b) { return b - a; }).forEach(function (n) { state[table].sheet.deleteRow(n); });
    }
    return json({ status: 'ok', rows: rows, deleted: deleted });
  } catch (err) {
    return json({ status: 'error', message: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// Optional: hand edits in the sheet bump the row's version too.
function onEdit(e) {
  var sheet = e.range.getSheet();
  var table = tableOfSheet(sheet);
  if (!table) return;
  var cols = columnsOf(sheet, table, false);
  if (cols.version === undefined) return;
  var first = Math.max(e.range.getRow(), 2), last = e.range.getLastRow();
  var c1 = e.range.getColumn() - 1, c2 = e.range.getLastColumn() - 1;
  var touchesContent = TABLES[table].content.some(function (f) { return cols[f] !== undefined && cols[f] >= c1 && cols[f] <= c2; });
  if (!touchesContent) return;
  for (var r = first; r <= last; r++) {
    var cell = sheet.getRange(r, cols.version + 1);
    cell.setValue((Number(cell.getValue()) || 0) + 1);
    if (cols.updated_at !== undefined) sheet.getRange(r, cols.updated_at + 1).setValue(new Date().toISOString());
  }
}
```

A write never touches a column the script doesn't own, so the formula columns from section 2 keep working. New rows go after the last row with an `id`, not after the last formula output.

### Deploy

1. **Save** the script, then **Deploy → New deployment**, type **Web app**.
2. **Execute as:** *Me*. **Who has access:** *Anyone*. Not "Anyone with Google account": that makes the browser's request fail with a CORS/401 error.
3. **Deploy**, authorize the script for your account, and copy the **Web app URL** (`https://script.google.com/macros/s/…/exec`).
4. Check it: open `<web app URL>?action=list` in an incognito window. It should return `{"status":"ok","locations":[…],"routes":[…]}`.
5. After any change to the script, use **Manage deployments → Edit → Version: New version**. The `/exec` URL stays the same.

The `onEdit` function runs as a simple trigger once the script is saved. It needs no deployment.

Anyone with the web app URL can write to the two tabs. Share the URL only through the layer config of the atlas meant to edit the network, and keep a version history (**File → Version history**) to undo unwanted edits.

## 4. The sheet as a route layer

A sheet-backed route network is a layer of `"type": "routes"`:

```json
{
  "id": "goa-cycle-network",
  "title": "Goa cycle network",
  "type": "routes",
  "url": "https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit",
  "locationsGid": "0",
  "routesGid": "123456789",
  "saveUrl": "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec"
}
```

| Field | Required | Notes |
|---|---|---|
| `url` | yes | The spreadsheet's URL. Share the sheet as *Anyone with the link can view*. |
| `locationsGid` | no | The `gid` of the locations tab (the `#gid=` in its URL). Without it, the tab named `locations` is used. |
| `routesGid` | no | The `gid` of the routes tab. Without it, the tab named `routes` or `route` is used. |
| `saveUrl` | no | The Apps Script web app URL. Without it the layer is read-only, and it is read through the CSV export instead of the script. |

Each route in the sheet is drawn the same way as a `route-<rid>:` entry in a link, through the routing service named in its row.

The layer type, the Find route cards and the export panel are being wired to these modules separately. The data side is `js/route-sheet-sync.js`:

```js
import { RouteSheetSync } from './route-sheet-sync.js';

const sync = new RouteSheetSync(layerConfig);
const { routes, markers, errors, fingerprint } = await sync.refresh(); // base snapshot for editing
// `markers` are the locations; a route's `waypoints` are its location ids in order

const result = await sync.save({ locations: [{ id: 'miramar', lng: 73.8079, lat: 15.4826, name: 'Miramar' }],
                                 routes: [{ id: 'coast', waypoints: ['panjim_market', 'miramar'], profile: 'cycling' }] });
if (result.conflict) {
  // result.conflicts: [{ table, id, local, remote, reason: 'changed' | 'deleted' | 'exists' }]
  await sync.conflicts.insertAsNew(result.conflicts[0]); // or sync.conflicts.discard('coast')
}
await sync.delete({ routes: ['fort'] });
```

`fingerprint` changes whenever any row in either tab changes, so polling `refresh({ rebase: false })` and comparing it is a cheap way to notice upstream edits.

## 5. CSV and GeoJSON from amche back into the sheet

**From a route layer.** Exporting a route layer as CSV from the export panel writes one row per feature. `routesFromCsv()` (or `routesFromGeojson()` for a GeoJSON export) reads it back into locations and routes:

| Exported column | Sheet column |
|---|---|
| waypoint feature `X`, `Y` | `locations.lng`, `locations.lat` |
| waypoint feature `name` | `locations.name` |
| waypoint feature `markerId`, or else its `name` made into an id (`Panjim Market` → `Panjim_Market`) | `locations.id`. Stops at the same point on several routes are one location. |
| route feature `routeId` without `route-` | `routes.id` |
| `routeName` | `routes.name` |
| route feature `profile` | `routes.profile` |
| route feature `source` | `routes.service` |
| `color`, when the route's colour was picked rather than the default | `routes.color` |
| waypoint features ordered by `index` | `routes.locations` |

Waypoint coordinates in an export are where the routing service snapped each stop to the road, so they can differ from the original location by a few metres.

**Into the sheet.** `routesToRows()` turns the result into the two tables, and `toCsv(rows.locations, LOCATION_COLUMNS)` / `toCsv(rows.routes, ROUTE_COLUMNS)` writes one CSV for each tab. The export panel's **Route sheet** option downloads both. In the sheet, open the tab and use **File → Import → Upload → Append to current sheet** for new rows, or **Replace data at selected cell** with A1 selected to replace the table. Replacing the data clears `version` / `updated_at`, which is safe: the next write through the script sets them again.

**From the sheet.** **File → Download → Comma-separated values** on each tab gives two CSVs that `routesFromCsv(locationsCsv, routesCsv)` reads back. The same rows also convert to an atlas config's `markers` / `routes` (see [Atlas-level markers and routes](API.md#atlas-level-markers-and-routes)) and to a link with `toAmcheUrl()`.

## Code reference

| Module | Exports |
|---|---|
| `js/route-sheet-format.js` | `routesToRows(routes, markers)`, `rowsToRoutes(locationRows, routeRows)`, `toAmcheUrl({routes, markers}, {base, atlas, routeIds, layers})`, `markersUrlValue(markers)`, `routeUrlValue(route)`, `toCsv(rows, columns)`, `fromCsv(text)`, `routesFromCsv(text, routesText)`, `routesFromGeojson(featureCollection)`, `locationToRow`, `routeToRow`, `normalizeRow`, `splitLocationIds`, `sanitizeRowId`, `freshId`, `LOCATION_COLUMNS`, `ROUTE_COLUMNS` |
| `js/route-sheet-geojson.js` | `routesFromGeojson(featureCollection)`, `featureRowsToGeojson(rows)` |
| `js/route-sheet-sync.js` | `RouteSheetSync` (`refresh`, `load`, `save`, `delete`, `rebase`, `conflicts`), `ConflictState`, `routeSheetSyncFor(layerConfig)` |
| `js/route-sheet-conflicts.js` | `ConflictState` (`active`, `list`, `has`, `add`, `blocking`, `insertAsNew`, `discard`), `rowFingerprint`, `networkFingerprint`, `sameContent`, `hashString` |

In these modules a route is `{id, name, service, profile, color?, waypoints: [locationId, …]}` and a location is `{id, lng, lat, name, description, pinned?}`, the same fields as an atlas config's `routes` and `markers`.
