document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('id_cor_grafico');
    if (!input) {
        return;
    }

    const swatches = [
        '#F44336', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5', '#2196F3', '#03A9F4', '#00BCD4',
        '#009688', '#4CAF50', '#8BC34A', '#CDDC39', '#FFEB3B', '#FFC107', '#FF9800', '#FF5722',
        '#795548', '#9E9E9E', '#607D8B', '#000000', '#FFFFFF'
    ];
    const fallbackColor = '#417690';

    const normalizeHex = (value, fallback = fallbackColor) => {
        const raw = String(value || '').trim();
        if (!raw) {
            return fallback;
        }
        const candidate = raw.startsWith('#') ? raw : `#${raw}`;
        return /^#[0-9A-Fa-f]{6}$/.test(candidate) ? candidate.toUpperCase() : fallback;
    };

    input.value = normalizeHex(input.value);
    input.maxLength = 7;
    input.style.maxWidth = '130px';
    input.style.textTransform = 'uppercase';

    const pickerHost = document.createElement('span');
    pickerHost.id = 'carteira-color-picker';
    pickerHost.style.display = 'inline-flex';
    pickerHost.style.marginLeft = '10px';
    pickerHost.style.verticalAlign = 'middle';
    input.insertAdjacentElement('afterend', pickerHost);

    const updateInputColor = (hexValue) => {
        const color = normalizeHex(hexValue);
        input.value = color;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const initializePickr = () => {
        if (!window.Pickr) {
            window.setTimeout(initializePickr, 80);
            return;
        }

        const pickr = window.Pickr.create({
            el: '#carteira-color-picker',
            theme: 'classic',
            default: normalizeHex(input.value),
            swatches,
            components: {
                preview: true,
                opacity: false,
                hue: true,
                interaction: {
                    hex: false,
                    rgba: false,
                    hsla: false,
                    hsva: false,
                    cmyk: false,
                    input: true,
                    clear: false,
                    save: true,
                },
            },
        });

        pickr.on('change', (color) => {
            if (!color) {
                return;
            }
            updateInputColor(color.toHEXA().toString());
        });

        pickr.on('save', (color, instance) => {
            if (color) {
                updateInputColor(color.toHEXA().toString());
            }
            instance.hide();
        });

        input.addEventListener('blur', () => {
            const normalized = normalizeHex(input.value);
            input.value = normalized;
            pickr.setColor(normalized, true);
        });
    };

    initializePickr();
});
