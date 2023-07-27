/**
 *
 * @param {Object: { dataType: String, format: String }} property
 * @param {String} value
 *
 * Convert rules(<valueType> to <dataType> => <value>)
 * string to string => value
 * number to integer => Number.parseInt(number, 10)
 * string to integer|float => 1|0 (0 for empty string)
 * boolean to integer|float => 1|0 (0 for empty string)
 * number to float => Number.parseFloat(number);
 * string to boolean => false|true (false for empty string)
 * number to boolean => false|true (false for 0)
 * string|number to enum => value if exist (or first value from format)
 * string|number to color => value if valid (or 0,0,100 (for format 'hsv') | 255,255,255 (for format 'rgb'))
 */
function convertToType(property, value) {
    // remove whitespaces from begin and end of string
    value = value.trim();
    let converted = value;
    let valueType = 'string';
    const { dataType, format } = property;

    if (!isNaN(value) && value !== '') valueType = 'number';
    else if ([ 'true', 'false' ].includes(value)) valueType = 'boolean';

    switch (dataType) {
        case 'integer':
            if (valueType === 'number') converted = Number.parseInt(value, 10);
            else if (valueType === 'boolean') converted = value === 'true' ? 1 : 0;
            else converted = value ? 1 : 0;
            break;
        case 'float':
            if (valueType === 'number') converted = Number.parseFloat(value);
            else if (valueType === 'boolean') converted = value === 'true' ? 1 : 0;
            else converted = value ? 1 : 0;
            break;
        case 'boolean':
            if (valueType === 'number') converted = Boolean(+value);
            else {
                converted = Boolean(value);
                if (value === 'false') converted = false;
            }
            break;
        case 'enum': {
            const list = format.split(',');

            if (list.includes(value)) converted = value;
            else converted = list[0] || '';
            break;
        }
        case 'color': {
            const color = value.split(',');

            if (format === 'hsv') {
                if (
                    (color[0] >= 0 && color[0] <= 100) &&
                    (color[1] >= 0 && color[1] <= 100) &&
                    (color[2] >= 0 && color[2] <= 100)
                ) converted = value;
                else converted = '0,0,100';
            } else if (format === 'rgb') {
                if (
                    (color[0] >= 0 && color[0] <= 255) &&
                    (color[1] >= 0 && color[1] <= 255) &&
                    (color[2] >= 0 && color[2] <= 255)
                ) converted = value;
                else converted = '255,255,255';
            }
            break;
        }
        default:
            break;
    }

    return `${converted}`;
}

module.exports = {
    convertToType
};
