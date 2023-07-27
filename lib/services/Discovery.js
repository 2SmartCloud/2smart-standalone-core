const X                 = require('homie-sdk/lib/utils/X');
const { ERROR_CODES }   = require('homie-sdk/lib/etc/config');
const { UNKNOWN_ERROR } = require('homie-sdk/lib/utils/errors');

const Base = require('./Base');

const MSECS_IN_DAY = 1000 * 60 * 60 * 24;

/** Class for discovery device management  */
class Discovery extends Base {
    constructor(props) {
        super(props);
        this.watcherIntervalID     = null;
        this.watcherInterval       = 1000 * 60 * 10;
        this.discoveryNewEventName = 'discovery.new';
        this.entityType            = 'DISCOVERY';
        this.discoveryEntities     = {};

        this.handleDiscoveryNewEvent = this.handleDiscoveryNewEvent.bind(this);
        this.handleSetEvent          = this.handleSetEvent.bind(this);
        this.handleNewEntity         = this.handleNewEntity.bind(this);
        this.checkTokensValidity     = this.checkTokensValidity.bind(this);
    }

    /**
     * Method for service initialization
     */
    async init() {
        this.debug.info('Discovery.init');

        this.rootTopic = this.core.homie.getEntityRootTopicByType(this.entityType);
        this.errorTopic = `${this.core.homie.errorTopic}/${this.rootTopic}`;

        this.core.homie.on(this.discoveryNewEventName, this.handleDiscoveryNewEvent);
        this.core.homie.on('new_entity', this.handleNewEntity);

        const discovery = this.getDiscovery();

        Object.keys(discovery).forEach(id => this.attachNewDiscoveryEntity(discovery[id]));
        this.startWatcher();

        this.debug.info('Discovery.init', 'finish');
    }

    getDiscovery() {
        return this.core.homie.getEntities(this.entityType);
    }

    handleNewEntity({ entityId, type }) {
        if (type === this.entityType) {
            this.debug.info('Discovery.handleNewEntity', entityId);

            try {
                const discoveryEntity = this.core.homie.getEntityById(this.entityType, entityId);

                this.attachNewDiscoveryEntity(discoveryEntity);
            } catch (err) {
                this.debug.warning('Discovery.handleNewEntity', err);
            }
        }
    }

    async handleDiscoveryNewEvent(options) {
        try {
            const { id, name } = options;

            this.debug.info('Discovery.handleDiscoveryNewEvent', `Create discovery with name="${name}"`);

            try {
                const discoveryEntity = this.core.homie.getEntityById(this.entityType, id);

                // If device is already accepted then do nothing, it will receive its token from broker
                if (discoveryEntity.acceptedAt) return;
            } catch (err) {
                if (err.code !== 'NOT_FOUND') throw err;
            }

            const newDiscoveryEntity = await this.core.homieMigrator.attachEntity(this.entityType, {
                id,
                name
            });

            this.attachNewDiscoveryEntity(newDiscoveryEntity);
        } catch (err) {
            this.debug.warning('Discovery.handleDiscoveryNewEvent', err);
        }
    }

    attachNewDiscoveryEntity(discoveryEntity) {
        const discoveryEntityId = discoveryEntity.id;

        if (!discoveryEntity._isValid) {
            this.debug.warning(
                'Discovery.attachNewDiscoveryEntity',
                `Discovery entity with id="${discoveryEntityId} is invalid"`
            );

            return;
        }

        if (this.discoveryEntities[discoveryEntityId]) {
            this.debug.warning(
                'Discovery.attachNewDiscoveryEntity',
                `Discovery entity with id="${discoveryEntityId}" is already attached`
            );

            return;
        }

        const deleteEventName = `homie.entity.${this.entityType}.${discoveryEntityId}.delete`;

        const handleDeleteEvent = async () => {
            this.debug.info('Discovery.handleDelete', `delete entity with id="${discoveryEntityId}"`);

            try {
                discoveryEntity.clearRelatedTopics();
                await this.core.homieMigrator.deleteEntity(discoveryEntity);
                this.core.homie.off(deleteEventName, handleDeleteEvent);

                delete this.discoveryEntities[discoveryEntityId];
            } catch (err) {
                this.publishError(err, `${discoveryEntityId}/delete`);
            }
        };

        this.discoveryEntities[discoveryEntityId] = discoveryEntity;

        this.core.homie.on(deleteEventName, handleDeleteEvent);
        discoveryEntity.onAttributeSet(this.handleSetEvent);
    }

    async handleSetEvent(data) {
        const { entity, field: attribute, value } = data;

        if (attribute === 'event') {
            const eventCallbacks = {
                accept : async () => {
                    const token = await this.core.services.aclManager.register(entity.getId());
                    const deviceAcceptanceTime = Date.now(); // time when discovery device was accepted

                    entity.publishToken(token);
                    await entity.publishAttribute('acceptedAt', deviceAcceptanceTime);

                    this.debug.info(
                        'Discovery.handleSetEvent.event.accept',
                        `Device with id="${entity.getId()}" successfully accepted`
                    );
                }
            };
            const eventCallback = eventCallbacks[value];

            if (eventCallback) {
                await entity.publishAttribute(attribute, value);

                try {
                    await eventCallback();
                } catch (err) {
                    this.publishEntityError(err, entity, attribute);
                }
            }
        }
    }

    publishEntityError(error, entity, key) {
        if (!(error instanceof X)) {
            error = new UNKNOWN_ERROR();
        }

        this.debug.warning('Discovery.publishEntityError', {
            error,
            entityId : entity.getId(),
            key
        });

        entity.publishError(key, error);
    }

    publishError(error, topic) {
        try {
            const preparedError = this.prepareError(error);
            const jsonErrorString = JSON.stringify(preparedError);

            this.debug.info('Discovery.publishError', {
                code    : preparedError.code,
                fields  : preparedError.fields,
                message : preparedError.message
            });

            this.core.homie.publishToBroker(`${this.errorTopic}/${topic}`, jsonErrorString, { retain: false });
        } catch (err) {
            this.debug.warning('Discovery.publishError', err);
        }
    }

    prepareError(error) {
        if (!(error instanceof X)) {
            error = new X({
                code    : ERROR_CODES.UNKNOWN_ERROR,
                fields  : {},
                message : 'Something went wrong'
            });
        }

        return error;
    }

    /**
     * Start watcher to check discovery tokens in interval
     */
    startWatcher() {
        if (this.watcherIntervalID) this.stopWatcher();

        this.watcherIntervalID = setInterval(this.checkTokensValidity, this.watcherInterval);
    }

    /**
     * Stop started watcher
     */
    stopWatcher() {
        clearInterval(this.watcherIntervalID);
        this.watcherIntervalID = null;
    }

    /**
     * Check each discovery device token and clear the device when token
     * becomes expired
     */
    async checkTokensValidity() {
        try {
            for (const discoveryEntity of Object.values(this.discoveryEntities)) {
                const acceptedAt = discoveryEntity.acceptedAt;

                // if token was passed to device
                if (acceptedAt) {
                    const timeDiff = Date.now() - acceptedAt;

                    if (timeDiff > MSECS_IN_DAY) {
                        await discoveryEntity.deleteRequest();

                        this.debug.info(
                            'Discovery.checkTokensValidity',
                            `Discovery entity with id="${discoveryEntity.getId()} cleared by expiration time"`
                        );
                    }
                }
            }
        } catch (err) {
            this.debug.warning('Discovery.checkTokensValidity', err.message);
        }
    }

    async deleteDiscoveryById(id) {
        const discoveryEntity = this.discoveryEntities[id];

        if (!discoveryEntity) {
            this.debug.warning('Discovery.deleteDiscoveryById', `Discovery with id="${id} not found`);

            return;
        }

        await discoveryEntity.deleteRequest();
    }

    /**
     * Accept the discovery device with current uuid, publish token and
     * acceptance time for this device, so it can announce itself in the system
     * @param {string} deviceId - a device uuid
     * @deprecated use entity.setAttribute('event', 'accept') method instead
     */
    async acceptDevice(deviceId) {
        if (!deviceId) {
            throw new Error('Please, specify the device uuid');
        }

        const token = await this.core.services.aclManager.register(deviceId);
        const deviceAcceptanceTime = Date.now(); // time when device was accepted

        this.core.homie.publishToBroker(
            `discovery/accepted/${deviceId}`,
            token
        );
        this.core.homie.publishToBroker(
            `discovery/accepted/${deviceId}/$acceptedAt`,
            deviceAcceptanceTime
        );

        this.debug.info('Discovery.acceptDevice', `Device with uuid=${deviceId} successfully accepted!`);
    }

    /**
     * Clear discovery topics related to device with current uuid
     * @param {string} deviceId - a device uuid
     * @deprecated use entity.deleteRequest() method instead
     */
    clearDevice(deviceId) {
        const discovery = this.core.homieServer.getDiscovery(); // object with discovery devices

        if (!deviceId) {
            throw new Error('Please, specify the device uuid');
        }

        if (deviceId in discovery) {
            this.core.homie.publishToBroker(`discovery/new/${deviceId}`, '');
            this.core.homie.publishToBroker(`discovery/accepted/${deviceId}`, '');
            this.core.homie.publishToBroker(`discovery/accepted/${deviceId}/$acceptedAt`, '');

            this.debug.info('Discovery.removeAcceptedDevice', `Clear the device with uuid=${deviceId}`);
        }
    }
}

module.exports = Discovery;
