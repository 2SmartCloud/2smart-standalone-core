const EE            = require('events');
const _             = require('underscore');
const Promise       = require('bluebird');
const MQTT          = require('homie-sdk/lib/Broker/mqtt');
const Homie         = require('homie-sdk/lib/homie/Homie');
const HomieServer   = require('homie-sdk/lib/homie/HomieServer');
const HomieMigrator = require('homie-sdk/lib/homie/HomieMigrator');
const Debugger      = require('homie-sdk/lib/utils/debugger');

const DeviceSettings             = require('./services/DeviceSettings');
const SystemEvents               = require('./services/SystemEvents');
const GroupOfProperties          = require('./services/GroupOfProperties');
const AclManager                 = require('./services/AclManager');
const BridgesManager             = require('./services/BridgesManager');
const Discovery                  = require('./services/Discovery');
const BridgeTypesManager         = require('./services/BridgeTypesManager');
const PublishManager             = require('./services/PublishManager');
const TopicsAliases              = require('./services/TopicsAliases');
const ExtensionsService          = require('./services/ExtensionsService');
const SystemNotificationsManager = require('./services/SystemNotificationsManager');

const config = require('./../etc/config');

class Core extends EE {
    constructor() {
        super();
        this.mqttCreds = config.mqtt;
        this.homie = new Homie({ transport: new MQTT({ ...this.mqttCreds }) });
        this.homieServer = new HomieServer({ homie: this.homie });
        this.homieMigrator = new HomieMigrator({ homie: this.homie });

        const debugConfig = process.env.DEBUG || '*';
        this.debug = new Debugger(debugConfig);

        this.debug.initEvents();

        this.services = {
            deviceSettings             : new DeviceSettings({ core: this }),
            systemEvents               : new SystemEvents({ core: this }),
            aclManager                 : new AclManager({ core: this }),
            bridgesManager             : new BridgesManager({ core: this }),
            discovery                  : new Discovery({ core: this }),
            bridgeTypesManager         : new BridgeTypesManager({ core: this }),
            groupOfProperties          : new GroupOfProperties({ core: this }),
            publishManager             : new PublishManager({ core: this }),
            topicsAliases              : new TopicsAliases({ core: this }),
            extensionsService          : new ExtensionsService({ core: this }),
            systemNotificationsManager : new SystemNotificationsManager({ core: this })
        };

        this.debug.info('Core.constructor');
    }

    async init() {
        this.debug.info('Core.init');

        await this.homieServer.initWorld();
        const devices = this.homieServer.getDevices();

        Object.keys(devices).forEach(id => {
            devices[id].onAttributeSet(this._handleAttributeSet.bind(this));
            devices[id].onAttributePublish(this._handleAttributePublish.bind(this));
        });

        this.homieServer.onNewDeviceAdded(async ({ deviceId }) => {
            try {
                this.homieServer.getDeviceById(deviceId).onAttributeSet(this._handleAttributeSet.bind(this));
                this.homieServer.getDeviceById(deviceId).onAttributePublish(this._handleAttributePublish.bind(this));

                /**
                 * Clear discovery device entity, must do this when device
                 * announced itself successfully
                 */
                await this.services.discovery.deleteDiscoveryById(deviceId);
            } catch (e) {
                this.debug.warning('Core.init.onNewDeviceAdded', `${e.message}. DeviceId - ${deviceId}`);
            }
        });

        await this._initServices();
        this.debug.info('Core.init', 'Services initialized');
    }

    async _initServices() {
        await Promise.all(_.values(this.services).map(async (service) => {
            try {
                await service.init();
            } catch (e) {
                this.debug.error(e);
                process.exit(1);
            }
        }));
    }

    _handleAttributeSet(data) {
        this.debug.info('Core._handleAttributeSet', `deviceId=${data.device.getId()}, type=${data.type}, field=${data.field}, value=${data.value}`);

        switch (data.type) {
            case 'DEVICE':
            case 'NODE':
            case 'SENSOR':
            case 'NODE_OPTION':
            case 'NODE_TELEMETRY':
            case 'DEVICE_OPTION':
            case 'DEVICE_TELEMETRY':
                this.emit(`homie.change.${data.field}`, data);
                break;
            default:
                break;
        }
    }

    async _handleAttributePublish(data) {
        const { type, device, field, value } = data;

        switch (type) {
            case 'DEVICE':
                // Clear device from discovery when it publish ready state
                if (field === 'state' && value === 'ready') {
                    this.debug.info(
                        'Core._handleAttributePublish.deleteDiscoveryById',
                        `deviceId=${device.getId()}, type=${type}, field=${field}, value=${value}`
                    );
                    const deviceId = device.getId();
                    await this.services.discovery.deleteDiscoveryById(deviceId);
                }
                break;
            case 'SENSOR':
            case 'NODE_OPTION':
            case 'NODE_TELEMETRY':
                this.emit(`homie.publish.${type.toLowerCase()}`, data);
                break;
            default:
                break;
        }
    }
}

module.exports = Core;
