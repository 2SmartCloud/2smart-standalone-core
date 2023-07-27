const Base          = require('./Base');
const { sequelize } = require('./../sequelize');

const MqttUsers = sequelize.model('MqttUsers');
const MqttAcl   = sequelize.model('MqttAcl');

// Event types
const TYPES = {
    DEVICE           : 'DEVICE',
    THRESHOLD        : 'THRESHOLD',
    NODE             : 'NODE',
    SENSOR           : 'SENSOR',
    NODE_OPTION      : 'NODE_OPTION',
    DEVICE_OPTION    : 'DEVICE_OPTION',
    NODE_TELEMETRY   : 'NODE_TELEMETRY',
    DEVICE_TELEMETRY : 'DEVICE_TELEMETRY'
};

class SystemEvents extends Base {
    constructor(props) {
        super(props);

        this._handleUpdateEvent = this._handleUpdateEvent.bind(this);
        this._handleDeleteEvent = this._handleDeleteEvent.bind(this);
    }

    async init() {
        this.debug.info('SystemEvents.init');

        this.core.homie.on('events.update', this._handleUpdateEvent);
        this.core.homie.on('events.delete', this._handleDeleteEvent);

        this.debug.info('SystemEvents.init', 'finish');
    }

    async _handleDeleteEvent(payload) {
        try {
            const { value: { type, deviceId, nodeId, scenarioId, thresholdId, propertyId, groupId } } = payload;

            this.debug.info('SystemEvents._handleDeleteEvent', {
                deviceId,
                type,
                nodeId,
                propertyId,
                groupId
            });

            const {
                DEVICE,
                NODE,
                SENSOR,
                NODE_OPTION,
                THRESHOLD,
                DEVICE_OPTION,
                NODE_TELEMETRY,
                DEVICE_TELEMETRY
            } = TYPES;

            // Get device instance only for types which requires it
            const device = [
                DEVICE,
                NODE,
                SENSOR,
                NODE_OPTION,
                DEVICE_OPTION,
                NODE_TELEMETRY,
                DEVICE_TELEMETRY
            ].includes(type) ? this.core.homieServer.getDeviceById(deviceId) : undefined;

            const node = nodeId ? device.getNodeById(nodeId) : undefined;

            switch (type) {
                case DEVICE: {
                    this.debug.info('SystemEvents._handleDeleteEvent', `deleting device=${deviceId}`);

                    await sequelize.transaction(async (transaction) => {
                        await MqttUsers.destroy({ where: { username: deviceId }, transaction });
                        await MqttAcl.destroy({ where: { username: deviceId }, transaction });
                    });

                    this.core.homieMigrator.deleteDevice(device);
                    break;
                }
                case NODE: {
                    this.debug.info('SystemEvents._handleDeleteEvent', `deleting node(device=${deviceId} node=${nodeId})`);

                    this.core.homieMigrator.deleteNode(node);
                    break;
                }
                case THRESHOLD: {
                    const property = this.core.homieServer.getThresholdById(scenarioId, thresholdId);

                    this.deleteGroupFromProperty(groupId, property);
                    break;
                }
                case SENSOR: {
                    const property = node.getSensorById(propertyId);

                    this.deleteGroupFromProperty(groupId, property);
                    break;
                }
                case NODE_OPTION: {
                    const property = node.getOptionById(propertyId);

                    this.deleteGroupFromProperty(groupId, property);
                    break;
                }
                case DEVICE_OPTION: {
                    const property = device.getOptionById(propertyId);

                    this.deleteGroupFromProperty(groupId, property);
                    break;
                }
                case NODE_TELEMETRY: {
                    const property = node.getTelemetryById(propertyId);

                    this.deleteGroupFromProperty(groupId, property);
                    break;
                }
                case DEVICE_TELEMETRY: {
                    const property = device.getTelemetryById(propertyId);

                    this.deleteGroupFromProperty(groupId, property);
                    break;
                }
                default:
                    break;
            }
        } catch (e) {
            this.debug.warning('SystemEvents._handleDeleteEvent', `${e.message}`);
        }
    }

    async _handleUpdateEvent(payload) {
        try {
            const { value: { type, deviceId, scenarioId, thresholdId, nodeId, propertyId, groupId } } = payload;

            this.debug.info('SystemEvents._handleUpdateEvent', {
                deviceId,
                type,
                nodeId,
                propertyId,
                groupId
            });

            const {
                SENSOR,
                NODE_OPTION,
                DEVICE_OPTION,
                THRESHOLD,
                NODE_TELEMETRY,
                DEVICE_TELEMETRY
            } = TYPES;

            const device = deviceId ? this.core.homieServer.getDeviceById(deviceId) : null;
            const node = nodeId ? device.getNodeById(nodeId) : null;

            switch (type) {
                case SENSOR: {
                    const property = node.getSensorById(propertyId);

                    this.addGroupToProperty(groupId, property);
                    break;
                }
                case THRESHOLD: {
                    const property = this.core.homieServer.getThresholdById(scenarioId, thresholdId);

                    this.addGroupToProperty(groupId, property);
                    break;
                }
                case NODE_OPTION: {
                    const property = node.getOptionById(propertyId);

                    this.addGroupToProperty(groupId, property);
                    break;
                }
                case DEVICE_OPTION: {
                    const property = device.getOptionById(propertyId);

                    this.addGroupToProperty(groupId, property);
                    break;
                }
                case NODE_TELEMETRY: {
                    const property = node.getTelemetryById(propertyId);

                    this.addGroupToProperty(groupId, property);
                    break;
                }
                case DEVICE_TELEMETRY: {
                    const property = device.getTelemetryById(propertyId);

                    this.addGroupToProperty(groupId, property);
                    break;
                }
                default:
                    break;
            }
        } catch (e) {
            this.debug.warning('SystemEvents._handleUpdateEvent', `${e.message}`);
        }
    }

    deleteGroupFromProperty(groupId, property) {
        try {
            this.debug.info('SystemEvents.deleteGroupFromProperty', `GroupId - ${groupId} property - ${property.id}`);

            property.deleteGroup(groupId);
            property.publishSetting('groups', property.groups);
        } catch (e) {
            this.debug.warning('SystemEvents.deleteGroupFromProperty', `${e.message}`);
        }
    }

    addGroupToProperty(groupId, property) {
        try {
            this.debug.info('SystemEvents.addGroupToProperty', `GroupId - ${groupId} property - ${property.id}`);

            property.addGroup(groupId);
            property.publishSetting('groups', property.groups);
        } catch (e) {
            this.debug.warning('SystemEvents.addGroupToProperty', `${e.message}`);
        }
    }
}

module.exports = SystemEvents;
