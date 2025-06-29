# amche-goa

**amche-atlas** is designed to be a flexible and interactive web based GIS software to quickly visualize spatial data layers from a vareity of sources using the latest open source 

amche-atlas is currently deployed at the following urls:
- Homepage: https://amche.in/
- Development preview: https://amche.in/dev

**Forks**
- [Goa Department of Fire and Rescue services](https://github.com/alansaviolobo/dfes-dmp)

`amche` translates to 'ours' in the Indian language of [Konkani](https://en.wikipedia.org/wiki/Konkani_language), the native language in Goa.

**admche.in**

This is a citizen maintained map portal for the state of Goa, India that realizes the vision of [The National Geospatial Policy, 2022](https://dst.gov.in/sites/default/files/National%20Geospatial%20Policy.pdf).

> - 2.1.1. To make India a World Leader in Global Geospatial space with the best in the class ecosystem for
innovation.
> - 2.1.2. To develop a coherent national framework in the country and leverage it to move towards digital
economy and improve services to citizens.
> - 2.1.3. To enable easy availability of valuable Geospatial data collected utilizing public funds, to businesses
and general public.
> - 2.1.4. To have a thriving Geospatial industry in the country involving private enterprise.
>
> **Atmanirbhar Bharat**: The Policy recognizes the importance of locally available and locally
relevant Maps and Geospatial Data in improved planning and management of resources and better serving
the specific needs of the Indian population. The Policy aims to create an enabling ecosystem thereby
providing a conducive environment to Indian Companies that will enable them to make India self-reliant in
producing and using their own Geospatial data /information as also compete with foreign companies in the
global space.

![](./assets/img/og_image.jpg)

## Background

The [74th Amendment to the Constitution of India](https://www.india.gov.in/my-government/constitution-india/amendments/constitution-india-seventy-fourth-amendment-act-1992) that empowered local bodies with greater democratic powers specifically mentioned the common requirement of spatial planning between urban and rural areas.

> 243ZD (3) (A) (i) matters of common interest between the Panchayats and the Municipalities including spatial planning, sharing of water and other physical and natural resources, the integrated development of infrastructure and environmental conservation
> https://www.india.gov.in/my-government/constitution-india/amendments/constitution-india-seventy-fourth-amendment-act-1992

In pursuant to this goal, the Government of India has supported the creation of various critical datasets and tools to empower participatory planning at a local level alongside greater access to open spatial data:

**Portals**
- [Bhuvan Panchayat: Space-based Information Support for Decentralised Planning (SISDP)](https://bhuvanpanchayat.nrsc.gov.in/)
- [Gram Manchitra](https://informatics.nic.in/uploads/pdfs/51ebda15_28_30_egov_grammanchitra_jan_25.pdf)
- [eGramSwaraj](https://egramswaraj.gov.in/)

**Policy**
- [National Data Sharing and Accessibility Policy (NDSAP)](https://dst.gov.in/national-data-sharing-and-accessibility-policy-0)
- [The National Geospatial Policy, 2022](https://dst.gov.in/sites/default/files/National%20Geospatial%20Policy.pdf)

At the grassroots level, citizens continue to face difficulties in reliable access to these portals and datasets for effective use. The birth of amche-atlas has its roots in leveraging the best in class technology tools to simplify access to these public datasets in the state of Goa and empower grasroots level decentralized planning as envisaged by the Constitution.

## Data 

The various map layers are sourced from available open data published by government and community sources. Please check the individual layer details on amche.in for more complete source information. Please verify the accuracy of any dataset with the respective source. 

**State Level**
- [Town & Country Planning Department, Government of Goa (TCP)](https://tcp.goa.gov.in/)
- [Bhunaksha, Directorate of Settlement & Land Records, Government of Goa](https://bhunaksha.goa.gov.in/bhunaksha/)
- [amche.in Community](https://github.com/publicmap/amche-goa/issues)

**National level**
- [ISRO Space Based Earth Observation Applications](https://www.isro.gov.in/SpaceBasedEarthObservationServices.html) | [Bhuvan](https://bhuvan-app1.nrsc.gov.in/) ([Wiki](https://bhuvan.nrsc.gov.in/wiki/index.php/List_of_Vector_(Thematic_Maps)_datasets))
- [National Center For Sustainable Coastal Management (NCSCM)](https://czmp.ncscm.res.in/)
- [National Centre of Geo-Informatics (MeitY-NCOG)](https://mss.ncog.gov.in/login)
- [Ministry of Agriculture & Farmers Welfare, Government of India](https://soilhealth.dac.gov.in/slusi-visualisation/)
- [Ministry of Jal Shakti, Government of India](https://indiawris.gov.in/)
- [Swachh Bharat Mission](https://sbm-g-esriindia1.hub.arcgis.com/)
- [Bharatmaps (NIC)](https://bharatmaps.gov.in/BharatMaps/Home/Map)
- [Survey Of India](https://onlinemaps.surveyofindia.gov.in/FreeMapSpecification.aspx)
- [Election Commission of India (ECI)](https://www.eci.gov.in/delimitation)
- [Perry-Castañeda Library Map Collection, The University of Texas at Austin](https://maps.lib.utexas.edu/maps/ams/india/)
- [DataMeet.org - India Open Data Community](https://datameet.org/)

**Global Level**

- [NASA](https://asterweb.jpl.nasa.gov/gdem.asp)
- [OpenStreetMap Project](https://www.openstreetmap.org/#map=12/15.4661/73.8604) / [OSM India Community](https://www.openstreetmap.in/)

### Data hosting

Data is directly mirrored from external sources and is not hosted or controlled by amche.in

- [IndianOpenMaps](https://indianopenmaps.fly.dev) vector tile data mirror for government open datasets
- [mapwarper.net](https://mapwarper.net/layers/2054) for georeferencing and serving scanned or PDF maps via TMS
- [Github](https://gist.github.com) for GeoJSON hosting
- [Maphub](https://www.maphub.co/) for community spatial data hosting
- [Wikimedia Commons](https://commons.wikimedia.org/) for out of copyright scanned maps and data

See [/data](./data) for more information for any custom data processing code.

## Software

The development of amche.in was largely made pausible due to [Claude](https://claude.ai/) and [Cursor](https://www.cursor.com/). The website has a simple static site structure with minimal Javascript libraries and is intentionally developed to be as simple as possible to setup, contribute and build.

- To setup, open your terminal:
  - `git clone git@github.com:publicmap/amche-goa.git` and `cd amche-goa`
  - `npm install` to install all code dependencies. Requires [Node.JS](https://nodejs.org/en)
  - `npm start` to start a local server. Open `http://localhost:4035/` in your broswer
- Source code hosted on Github and served via [Github Pages](https://pages.github.com/)
  - Code on `main` branch deploys to https://amche.in and `dev` branch to https://amche.in/dev . Deployment time is currently under 1 minute.
- Take a look at the [Project Board](https://github.com/publicmap/amche-goa/projects) to take up an issue to contribute to
  - Make sure [issues](https://github.com/publicmap/amche-goa/issues) you are working on is clear and well documented before working on them
  - While working with AI coding, remember to `git commit <file> -m "Commiting these changes since it works` and `git reset --hard` if you need to discard all changes since the last commit when things do not work
  - Reload the page locally to test changes or use `git push origin HEAD:dev --force` to preview commits live for user testing on https://amche.in/dev

### Technical Stack

**Basemap**
- [amche-goa Mapbox Studio style](https://api.mapbox.com/styles/v1/planemad/cm3gyibd3004x01qz08rohcsg.html?title=copy&access_token=pk.eyJ1IjoicGxhbmVtYWQiLCJhIjoiY2x2MzZwbGRyMGdheDJtbXVwdDA4aDNyaCJ9.nbvz6aNGQo68xa4NtWH26A&zoomwheel=true&fresh=true#13.82/15.18819/73.96438)
- [Mapbox Streets v8 vector tiles](https://docs.mapbox.com/data/tilesets/reference/mapbox-streets-v8/) / OpenStreetMap Project
- [Mapbox Satellite imagery](https://www.mapbox.com/maps/satellite) / Maxar

**JS**
- [Mapbox GL JS](https://www.mapbox.com/mapbox-gljs) for client side map rendering and interactivity
- [jQuery](https://jquery.com/) for easy DOM manipulation

**CSS**
- [Shoelace](https://shoelace.style/) for UI components. Mainly used for layer control panel.
- [tailwindcss](https://tailwindcss.com/) for responsive CSS framework
- [Google Fonts](https://fonts.gstatic.com)



