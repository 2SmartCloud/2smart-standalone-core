const _pickBy = require('lodash/pickBy');
const _keys = require('lodash/keys');
const X = require('homie-sdk/lib/utils/X');
const { ERROR_CODES: { EXISTS, UNKNOWN_ERROR } } = require('homie-sdk/lib/etc/config');
const Base = require('./Base');
const { convertToType } = require('./../utils');

class GroupOfProperties extends Base {
    constructor(props) {
        super(props);

        this.entityType = 'GROUP_OF_PROPERTIES';
        this.rootTopic = undefined;
        this.errorTopic = undefined;

        this.handleCreateRequest = this.handleCreateRequest.bind(this);
        this.handleNewGroupAdded = this.handleNewGroupAdded.bind(this);
        this.handleSetEvent = this.handleSetEvent.bind(this);
    }

    async init() {
        this.debug.info('GroupOfProperties.init');
        this.rootTopic = this.core.homie.getEntityRootTopicByType(this.entityType);
        this.errorTopic = `${this.core.homie.errorTopic}/${this.rootTopic}`;

        const groups = this.getGroups();

        for (const id in groups) this.attachNewGroup(groups[id]);

        this.core.homie.on(`homie.entity.${this.entityType}.create`, this.handleCreateRequest);
        this.core.homie.on('new_entity', this.handleNewGroupAdded);
        this.debug.info('GroupOfProperties.init', 'finish');
    }

    async handleCreateRequest(data) {
        const { entityId, translated: { value } } = data;

        value.name = value.name.trim();

        try {
            this.validate(value);

            this.debug.info('GroupOfProperties.handleCreateRequest', `Create group=${value.name}`);
            const entity = await this.core.homieMigrator.attachEntity(this.entityType, { id: entityId, ...value });

            this.attachNewGroup(entity);
        } catch (e) {
            this.publishError(e, `${entityId}/create`);
        }
    }

    handleNewGroupAdded({ entityId, type }) {
        if (type !== this.entityType) return;

        this.debug.info('GroupOfProperties.handleNewGroupAdded', `id=${entityId}`);

        try {
            const entity = this.core.homie.getEntityById(this.entityType, entityId);

            this.attachNewGroup(entity);
        } catch (e) {
            this.debug.warning('GroupOfProperties.handleNewGroupAdded', `${e.message}`);
        }
    }

    validate({ name }) {
        if (_keys(_pickBy(this.getGroups(), g => g.name === name)).length) {
            throw new X({
                code   : EXISTS,
                fields : {
                    name : 'EXIST'
                },
                message : `Group with name - ${name} already exists!`
            });
        }
    }

    publishError(error, topic) {
        try {
            const prepErr = this.prepareError(error);

            this.debug.warning('GroupOfProperties.publishError', {
                code    : prepErr.code,
                fields  : prepErr.fields,
                message : prepErr.message
            });

            this.core.homie.publishToBroker(`${this.errorTopic}/${topic}`, JSON.stringify(prepErr), { retain: false });
        } catch (e) {
            this.debug.warning('GroupOfProperties.publishError', `${e.message}`);
        }
    }

    prepareError(error) {
        if (!(error instanceof X)) error = new X({ code: UNKNOWN_ERROR, fields: {}, message: 'Something went wrong' });

        return error;
    }

    attachNewGroup(group) {
        const homie = this.core.homie;
        const groupId = group.id;
        const deleteEvent = `homie.entity.${this.entityType}.${groupId}.delete`;
        const publishError = this.publishError.bind(this);

        const handleDeleteRequest = async () => {
            this.debug.info('GroupOfProperties.handleDeleteRequest');

            try {
                await this.core.homieMigrator.deleteEntity(group);
                homie.off(deleteEvent, handleDeleteRequest);
                this._removeGroupFromDevices(groupId);
            } catch (e) {
                publishError(e, `${groupId}/delete`);
            }
        };

        homie.on(deleteEvent, handleDeleteRequest);
        group.onAttributeSet(this.handleSetEvent);
    }

    handleSetEvent(data) {
        const { field, value, entity } = data;

        if (field === 'value') this._handleSetValue(entity, value);
    }

    getGroups() {
        return this.core.homie.getEntities(this.entityType);
    }

    _removeGroupFromDevices(groupId) {
        this.debug.info('GroupOfProperties._removeGroupFromDevices', `groupId - ${groupId}`);

        const homie = this.core.homieServer;
        const devices = homie.getDevices();

        for (const deviceId in devices) {
            try {
                const device = homie.getDeviceById(deviceId);
                const map = device.getMapByGroupId(groupId);

                if (!map) continue;

                for (const hash in map) this._deleteGroupFromProperty({ ...map[hash], groupId }, device);

                device.deleteMapByGroupId(groupId);
            } catch (e) {
                this.debug.warning('GroupOfProperties._removeGroupFromDevices', `${e.message}`);
            }
        }
    }

    async _handleSetValue(entity, value) {
        this.debug.info('GroupOfProperties._handleSetValue', `groupId - ${entity.id} value = ${value}`);

        const homie = this.core.homie;
        const devices = homie.getDevices();
        const scenarios = homie.getScenarios();
        const groupId = entity.id;

        for (const deviceId in devices) {
            try {
                const device = homie.getDeviceById(deviceId);
                const map = device.getMapByGroupId(groupId);

                if (!map) continue;

                for (const hash in map) this._updatePropertyValue({ ...map[hash], value }, device);
            } catch (e) {
                this.debug.warning('GroupOfProperties._handleSetValue', `${e.message}`);
            }
        }

        for (const scenarioId in scenarios) {
            try {
                const scenario = homie.getScenarioById(scenarioId);
                const map = scenario.getMapByGroupId(groupId);

                if (!map) continue;

                for (const hash in map) this._updatePropertyValue({ ...map[hash], value }, scenario);
            } catch (e) {
                this.debug.warning('GroupOfProperties._handleSetValue', `${e.message}`);
            }
        }

        await entity.publishAttribute('value', value);
    }

    async _updatePropertyValue(data, entity) {
        this.debug.info('GroupOfProperties._updatePropertyValue');

        try {
            let property;
            const { type, nodeId, propertyId, value } = data;
            const node = nodeId ? entity.getNodeById(nodeId) : undefined;

            switch (type) {
                case 'SENSOR':
                    property = node.getSensorById(propertyId);
                    break;
                case 'THRESHOLD':
                    property = entity.getThresholdById(propertyId);
                    break;
                case 'NODE_TELEMETRY':
                    property = node.getTelemetryById(propertyId);
                    break;
                case 'NODE_OPTION':
                    property = node.getOptionById(propertyId);
                    break;
                case 'DEVICE_OPTION':
                    property = entity.getOptionById(propertyId);
                    break;
                case 'DEVICE_TELEMETRY':
                    property = entity.getTelemetryById(propertyId);
                    break;
                default:
                    return;
            }

            if (property.getSettable() === 'false') {
                this.debug.warning('GroupOfProperties._updatePropertyValue', `Property - ${propertyId} is not settable!`);

                return;
            }

            const dataType = property.getDataType();
            const format = property.getFormat();

            const converted = convertToType({ dataType, format }, value);

            await property.setAttribute('value', converted);
        } catch (e) {
            this.debug.warning('GroupOfProperties._updatePropertyValue', e);
        }
    }

    _deleteGroupFromProperty(data, device) {
        this.debug.info('GroupOfProperties._deleteGroupFromProperty');

        try {
            let property;
            const { type, nodeId, propertyId, groupId } = data;
            const node = nodeId ? device.getNodeById(nodeId) : undefined;

            switch (type) {
                case 'SENSOR':
                    property = node.getSensorById(propertyId);
                    break;
                case 'NODE_TELEMETRY':
                    property = node.getTelemetryById(propertyId);
                    break;
                case 'NODE_OPTION':
                    property = node.getOptionById(propertyId);
                    break;
                case 'DEVICE_OPTION':
                    property = device.getOptionById(propertyId);
                    break;
                case 'DEVICE_TELEMETRY':
                    property = device.getTelemetryById(propertyId);
                    break;
                default:
                    return;
            }

            this.core.services.systemEvents.deleteGroupFromProperty(groupId, property);
        } catch (e) {
            this.debug.warning('GroupOfProperties._deleteGroupFromProperty', `${e.message}`);
        }
    }
}

module.exports = GroupOfProperties;
