/**
 * Button : Reset Map View
 */

export class ButtonResetMapView {

    onAdd(map) {
        this._container = $('<div>', {
            class: 'mapboxgl-ctrl mapboxgl-ctrl-group reset-map-view'
        })[0];

        $('<button>', {
            class: 'mapboxgl-ctrl-icon',
            type: 'button',
            'aria-label': 'Reset map view',
            css: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '30px',
                height: '30px'
            }
        })
            .append($('<img>', {
                src: 'assets/img/goa-icon.svg',
                alt: 'Fit Map to Goa',
                width: 20,
                height: 20,
                css: {display: 'block'}
            }))
            .on('click', () => {
                map.flyTo({
                    zoom: 9,
                    pitch: 28,
                    speed: 0.6,
                    curve: 1.42,
                    center: [73.8274, 15.4406],
                    bearing: 0,
                    duration: 4000,
                    essential: true
                });
            })
            .on('mouseenter', function () {
                $(this).css('backgroundColor', '#f0f0f0');
            })
            .on('mouseleave', function () {
                $(this).css('backgroundColor', '#ffffff');
            })
            .appendTo(this._container);

        return this._container;
    }

    onRemove() {
        $(this._container).remove();
    }
} 