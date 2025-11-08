class ViewControl {
    constructor(options = {}) {
        this.options = {
            initialView: {
                center: [73.8274, 15.4406],
                zoom: 9,
                pitch: 28,
                bearing: 0
            },
            iconUrl: 'assets/img/goa-icon.svg',
            ...options
        };
    }

    onAdd(map) {
        this._map = map;

        // Create container with jQuery
        this._container = $('<div>', {
            class: 'mapboxgl-ctrl mapboxgl-ctrl-group'
        })[0];

        // Create button with jQuery
        const $button = $('<button>', {
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
        });

        // Create image with jQuery
        const $img = $('<img>', {
            src: this.options.iconUrl,
            alt: 'Fit Map to Goa',
            width: 20,
            height: 20,
            css: {display: 'block'}
        });

        // Add event handlers using jQuery
        $button
            .append($img)
            .on('click', () => {
                this._map.flyTo({
                    ...this.options.initialView,
                    duration: 4000,
                    essential: true,
                    curve: 1.42,
                    speed: 0.6
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
        this._map = undefined;
    }
} 