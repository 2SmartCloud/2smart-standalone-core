const LIVR = require('livr');
const Base = require('./Base');

class DeviceSettings extends Base {
    constructor(props) {
        super(props);
    }

    async init() {
        this.debug.info('DeviceSettings.init');

        this.core.on('homie.change.title', this._handleSettingSet.bind(this));
        this.core.on('homie.change.hidden', this._handleSettingSet.bind(this));
        this.core.on('homie.change.displayed', this._handleSettingSet.bind(this));

        this.debug.info('DeviceSettings.init', 'finish');
    }

    validate(data) {
        const rules = {};

        switch (data.field) {
            case 'title':
                rules.value = [ 'not_empty', 'trim', 'required' ];
                break;
            case 'displayed':
                rules.value = [ 'required', { 'one_of': [ 'true', 'false' ] } ];
                break;
            case 'hidden':
                rules.value = [ 'required', { 'one_of': [ 'true', 'false' ] } ];
                break;
            default:
                break;
        }

        const validator = new LIVR.Validator(rules);
        const validated = validator.validate(data);

        if (!validated) {
            return ({ errors: validator.getErrors() });
        }

        return validated;
    }

    _handleSettingSet(data) {
        const { device, node, type, property, field } = data;
        const validated = this.validate(data);

        if (validated.errors) {
            this._publishError(data, validated.errors);

            return;
        }

        switch (type) {
            case 'DEVICE':
                if (field === 'title') device.publishSetting(field, validated.value);
                break;
            case 'NODE':
                if (field === 'title' || field === 'hidden') node.publishSetting(field, validated.value);
                break;
            case 'SENSOR':
                if (field === 'title' || field === 'displayed') property.publishSetting(field, validated.value);
                break;
            case 'NODE_OPTION':
            case 'NODE_TELEMETRY':
            case 'DEVICE_OPTION':
            case 'DEVICE_TELEMETRY':
                if (field === 'title') property.publishSetting(field, validated.value);
                break;
            default:
                break;
        }
    }

    _publishError(data, errors) {
        const { device, node, type, property, field } = data;
        const err = { code: errors.value };

        this.debug.warning('DeviceSetting._publishError', `deviceId=${device.getId()}, type=${type}, field=${field}, err=${JSON.stringify(err)}`);

        switch (field) {
            case 'title':
                err.message = 'Title can\'t be empty';
                break;
            case 'displayed':
                err.message = 'Displayed must be "true" or "false"';
                break;
            default:
                break;
        }

        switch (type) {
            case 'DEVICE':
                if (field === 'title') device.publishSettingError(field, err);
                break;
            case 'NODE':
                if (field === 'title' || field === 'hidden') node.publishSettingError(field, err);
                break;
            case 'SENSOR':
                if (field === 'title' || field === 'displayed') property.publishSettingError(field, err);
                break;
            case 'NODE_OPTION':
            case 'NODE_TELEMETRY':
            case 'DEVICE_OPTION':
            case 'DEVICE_TELEMETRY':
                if (field === 'title') property.publishSettingError(field, err);
                break;
            default:
                break;
        }
    }
}

module.exports = DeviceSettings;
