const LIVR = require('livr');
const X = require('homie-sdk/lib/utils/X');
const {
    ERROR_CODES
} = require('homie-sdk/lib/etc/config');
const {
    VALIDATION,
    EXISTS,
    UNKNOWN_ERROR
} = require('homie-sdk/lib/utils/errors');
const Base = require('./Base');

class TopicsAliases extends Base {
    constructor(props) {
        super(props);

        this.entityType = 'TOPICS_ALIASES';
        this.rootTopic = undefined;
        this.errorTopic = undefined;
    }

    async init() {
        this.debug.info('TopicsAliases.init');
        this.rootTopic = this.core.homie.getEntityRootTopicByType(this.entityType);
        this.errorTopic = `${this.core.homie.errorTopic}/${this.rootTopic}`;

        this.core.homie.on(`homie.entity.${this.entityType}.create`, this.handleCreateRequest.bind(this));
        this.core.homie.on('new_entity', this.handleNewEntity.bind(this));
        this.core.homie.on('events.delete.success', this.checkAndDeleteRelatedAliases.bind(this));

        const topicsAliases = this.getTopicsAliases();

        for (const id of Object.keys(topicsAliases)) {
            this.attachNewTopicAlias(topicsAliases[id]);
        }

        this.debug.info('TopicsAliases.init', 'finish');
    }

    async checkAndDeleteRelatedAliases(payload) {
        const { type, deviceId, nodeId } = payload;

        const topicsAliasesObjects = Object.values(this.getTopicsAliases());

        let aliasesToDelete = [];

        switch (type) {
            case 'DEVICE':
                aliasesToDelete = topicsAliasesObjects.filter(alias => {
                    const { parsedTopic } = alias.serialize();

                    return parsedTopic.deviceId === deviceId;
                });
                break;
            case 'NODE':
                aliasesToDelete = topicsAliasesObjects.filter(alias => {
                    const { parsedTopic } = alias.serialize();

                    return parsedTopic.deviceId === deviceId && parsedTopic.nodeId === nodeId;
                });
                break;
            default:
                break;
        }

        if (aliasesToDelete.length) {
            for (const alias of aliasesToDelete) {
                const aliasName = alias.name;

                try {
                    await this.core.homieMigrator.deleteEntity(alias);

                    this.debug.info('TopicsAliases.checkAndDeleteRelatedAliases', {
                        aliasName,
                        type,
                        deviceId,
                        nodeId
                    });
                } catch (err) {
                    this.debug.warning(`TopicsAliases.checkAndDeleteRelatedAliases: Error with removing alias="${aliasName}" ${err}`);
                }
            }
        }
    }

    async handleCreateRequest(options) {
        const { entityId, translated: { value } } = options;

        value.name = value.name.trim();

        const validationRules = {
            name  : [ 'required', 'trim', { like: '^[0-9a-z. ]{1,100}$' } ],
            topic : [ 'required', { like: '^(?!-)(([a-z0-9-]+/)+)((\\$?[a-z0-9-]+)*)((/[a-z0-9-]+)*)(?<!-)$' } ]
        };

        const topicsAliases = this.getTopicsAliases();

        try {
            const topicWithCurrentAliasNameAlreadyExists = Object.keys(topicsAliases)
                .some(id => topicsAliases[id].name === value.name);

            if (topicWithCurrentAliasNameAlreadyExists) {
                throw new EXISTS({
                    fields : {
                        name : 'EXISTS'
                    },
                    message : `Topic with alias "${value.name}" already exists`
                });
            }

            const validator = new LIVR.Validator(validationRules);
            const validData = validator.validate(value);

            if (validData) {
                this.debug.info('TopicsAliases.handleCreateRequest', `Create alias="${validData.name}" for topic="${validData.topic}"`);

                const newTopicAlias = await this.core.homieMigrator.attachEntity(this.entityType, {
                    id : entityId,
                    ...validData
                });

                this.attachNewTopicAlias(newTopicAlias);
            } else {
                throw new VALIDATION({
                    fields  : validator.getErrors(),
                    message : 'Validation errors'
                });
            }
        } catch (err) {
            this.publishError(err, `${entityId}/create`);
        }
    }

    async handleSetEvent(data) {
        // eslint-disable-next-line prefer-const
        let { entity, field, value } = data;

        try {
            switch (field) {
                // eslint-disable-next-line no-case-declarations
                case 'name':
                    if (entity.name === value) break; // if set same name as entity already has

                    if (value === '') {
                        throw new VALIDATION({
                            fields : {
                                name : 'CANNOT_BE_EMPTY'
                            },
                            message : 'Alias name cannot be empty string'
                        });
                    }

                    value = value.trim();

                    const isCorrectNameFormat = new RegExp('^[0-9a-z. ]{1,100}$').test(value);

                    if (!isCorrectNameFormat) {
                        throw new VALIDATION({
                            fields : {
                                name : 'WRONG_FORMAT'
                            },
                            message : `Wrong value - ${value} for field - ${field}`
                        });
                    }

                    const topicsAliases = this.getTopicsAliases();

                    const topicWithCurrentAliasNameAlreadyExists = Object.keys(topicsAliases)
                        .some(id => topicsAliases[id].name === value);

                    if (topicWithCurrentAliasNameAlreadyExists) {
                        throw new EXISTS({
                            fields : {
                                name : 'EXISTS'
                            },
                            message : `Topic with alias "${value}" already exists`
                        });
                    }
                    break;
                default:
                    break;
            }

            await entity.publishAttribute(field, value);

            this.debug.info('TopicsAliases.handleSetEvent', {
                entityId : entity.getId(),
                field,
                value
            });
        } catch (err) {
            this.publishEntityError(err, entity, field);
        }
    }

    handleNewEntity({ entityId, type }) {
        if (type === this.entityType) {
            this.debug.info('TopicsAliases.handleNewEntity', entityId);

            let topicAliasEntity = null;

            try {
                topicAliasEntity = this.core.homie.getEntityById(this.entityType, entityId);
            } catch (err) {
                this.debug.warning('TopicsAliases.handleNewEntity', err);

                return;
            }

            this.attachNewTopicAlias(topicAliasEntity);
        }
    }

    getTopicsAliases() {
        return this.core.homie.getEntities(this.entityType);
    }

    attachNewTopicAlias(topicAlias) {
        const topicAliasId = topicAlias.id;

        const deleteEvent = `homie.entity.${this.entityType}.${topicAliasId}.delete`;

        const handleDeleteRequest = async () => {
            this.debug.info('TopicsAliases.handleDeleteRequest');

            try {
                await this.core.homieMigrator.deleteEntity(topicAlias);

                this.core.homie.off(deleteEvent, handleDeleteRequest);
            } catch (err) {
                this.publishError(err, `${topicAliasId}/delete`);
            }
        };

        this.core.homie.on(deleteEvent, handleDeleteRequest);

        topicAlias.onAttributeSet(this.handleSetEvent.bind(this));
    }

    publishError(error, topic) {
        try {
            const preparedError = this.prepareError(error);
            const jsonErrorString = JSON.stringify(preparedError);

            this.debug.info('TopicsAliases.publishError', {
                code    : preparedError.code,
                fields  : preparedError.fields,
                message : preparedError.message
            });

            this.core.homie.publishToBroker(`${this.errorTopic}/${topic}`, jsonErrorString, { retain: false });
        } catch (err) {
            this.debug.warning('TopicsAliases.publishError', err);
        }
    }

    publishEntityError(error, entity, key) {
        try {
            if (!(error instanceof X)) {
                error = new UNKNOWN_ERROR();
            }

            entity.publishError(key, error);
        } catch (err) {
            this.debug.warning('TopicsAliases.publishEntityError', err);
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
}

module.exports = TopicsAliases;

