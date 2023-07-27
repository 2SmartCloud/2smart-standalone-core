const fs                = require('fs');
const path              = require('path');
const NPM               = require('extensions-manager-sdk/src/npm');
const LIVR              = require('livr');
const nanoid            = require('nanoid');
const X                 = require('homie-sdk/lib/utils/X');
const { createMD5Hash } = require('homie-sdk/lib/utils');

const {
    UNKNOWN_ERROR,
    VALIDATION,
    EXISTS,
    RACE_CONDITION
} = require('homie-sdk/lib/utils/errors');

const {
    ERROR_CODES: {
        WRONG_TYPE
    }
} = require('homie-sdk/lib/etc/config');

const { extensions } = require('../../etc/config');
const Base           = require('./Base');

const { sequelize } = require('./../sequelize');

const Scenarios = sequelize.model('Scenarios');

class ExtensionsService extends Base {
    constructor(props) {
        super(props);

        this.entityType               = 'EXTENSION';
        this.extensions               = {};
        this.mutexes                  = {};
        this.rootTopic                = undefined;
        this.errorTopic               = undefined;
        this.installPath              = extensions.installPath;
        this.iconsDirName             = extensions.iconsDirName;
        this.iconsDirPath             = path.join(this.installPath, this.iconsDirName);
        this.extensionTypes           = extensions.keywords;
        this.defaultIconPath          = extensions.defaultIconPath;
        this.defaultSchemePath        = extensions.defaultSchemePath;
        this.extensionPrefix          = extensions.nameStartsWith;
        this.checkUpdatesIntervalTime = extensions.checkUpdatesIntervalTime;
        this.extensionClassType       = null;

        this.handleSetEvent      = this.handleSetEvent.bind(this);
        this.handleCreateRequest = this.handleCreateRequest.bind(this);
        this.handleNewEntity     = this.handleNewEntity.bind(this);
        this.handleHomieDelete   = this.handleHomieDelete.bind(this);

        this.addEventToQueue = this.addEventToQueue(); // make a closure
        this.checkUpdates    = this.checkUpdates.bind(this);
    }

    async init() {
        this.debug.info('ExtensionsManager.init', 'start');

        this.extensionClassType = this.core.homie.entitiesStore.classes[this.entityType];
        this.errorTopic         = `${this.core.homie.errorTopic}/${this.rootTopic}`;
        this.rootTopic          = this.extensionClassType.prototype._rootTopic;
        this.entityAttributes   = this.extensionClassType.prototype._attributes;
        // build an enum with entity states
        this.entityExtensionStates = this.entityAttributes.state.validation
            .find(rule => typeof rule === 'object' && rule.hasOwnProperty('one_of'))
            .one_of
            // eslint-disable-next-line no-sequences
            .reduce((obj, state) => (obj[state] = state, obj), {});

        const {
            name,
            version,
            description,
            link,
            type,
            language
        } = this.entityAttributes;

        this.extensionConfigValidationRules = {
            name        : name.validation,
            description : description.validation,
            version     : version.validation
        };

        this.createRequestValidationRules = {
            name        : name.validation,
            version     : version.validation,
            description : description.validation,
            link        : link.validation,
            type        : type.validation,
            language    : language.validation
        };

        this.extensionsManager = new NPM({
            extensionTypes               : this.extensionTypes,
            installPath                  : this.installPath,
            packagePrefix                : this.extensionPrefix,
            packageConfigValidationRules : this.extensionConfigValidationRules,
            defaultIconPath              : this.defaultIconPath,
            defaultSchemePath            : this.defaultSchemePath
        });

        this.core.homie.on('new_entity', this.handleNewEntity);
        this.core.homie.on(`homie.entity.${this.entityType}.create`, this.handleCreateRequest);
        this.core.homie.on('events.delete.success', this.handleHomieDelete);

        try {
            await fs.promises.mkdir(this.iconsDirPath, { recursive: true }); // try to create icons dir if not exists

            for (const extType of this.extensionTypes) { // create dir for each extension type
                await fs.promises.mkdir(path.join(this.installPath, extType), { recursive: true });
            }
        } catch (err) {
            if (err.code !== 'EEXIST') throw err;
        }

        const allExtensions = this.getExtensions();

        // attach each already existing extension
        for (const id of Object.keys(allExtensions)) {
            this.attachExtensionEntity(allExtensions[id]);
        }

        await this.extensionsManager.init();
        await this.sync();

        this.checkUpdates();
        this.checkUpdatesInterval = setInterval(this.checkUpdates, this.checkUpdatesIntervalTime);

        this.debug.info('ExtensionsManager.init', 'finish');
    }

    async sync() {
        const installedExtensions = await this.extensionsManager.getInstalledExtensions();

        for (const extension of installedExtensions) {
            const validatedExtensionObj = this.validateExtensionConfigObj(extension);

            const extensionEntityObj = {
                state       : 'installed',
                name        : validatedExtensionObj.name,
                description : validatedExtensionObj.description,
                version     : validatedExtensionObj.version,
                scheme      : await this.extensionsManager.getExtensionScheme(validatedExtensionObj.name),
                link        : await this.extensionsManager.getExtensionInfoURL(validatedExtensionObj.name),
                type        : await this.extensionsManager.getExtensionTypeByExtensionName(validatedExtensionObj.name),
                language    : this.extensionsManager.getLanguage()
            };

            const extensionId = createMD5Hash(extension.name);
            const extensionEntity = this.extensions[extensionId];

            if (extensionEntity) {
                await extensionEntity.publish(extensionEntityObj, false);
            } else {
                extensionEntityObj.id = extensionId;

                const newExtensionEntity = await this.core.homieMigrator.attachEntity(
                    this.entityType,
                    extensionEntityObj
                );

                this.attachExtensionEntity(newExtensionEntity);
            }
        }
    }

    checkUpdates() {
        Object
            .values(this.extensions)
            .forEach(async extension => {
                try {
                    await extension.setAttribute('event', 'check');
                } catch (err) {
                    this.debug.warning(
                        'ExtensionsService.checkUpdates',
                        `error with checking updates for extension with id = "${extension.id}"`
                    );
                    this.debug.warning('ExtensionsService.checkUpdates', err);
                }
            });
    }

    handleNewEntity({ entityId, type }) {
        if (type === this.entityType) {
            this.debug.info('ExtensionsService.handleNewEntity', entityId);

            let extensionEntity = null;

            try {
                extensionEntity = this.core.homie.getEntityById(this.entityType, entityId);
            } catch (err) {
                this.debug.warning('ExtensionsService.handleNewEntity', err);

                return;
            }

            this.attachExtensionEntity(extensionEntity);
        }
    }

    getExtensions() {
        return this.core.homie.getEntities(this.entityType);
    }

    async handleCreateRequest(options) {
        const { entityId, translated: { value } } = options;

        try {
            const extensionWithCurrentIdAlreadyExists = this.getExtensions()[entityId];

            if (extensionWithCurrentIdAlreadyExists) {
                throw new EXISTS({
                    fields : {
                        name : 'EXISTS'
                    },
                    message : `Extension with name = "${value.name}" already exists`
                });
            }

            const validator = new LIVR.Validator(this.createRequestValidationRules);
            const validData = validator.validate(value);

            if (validData) {
                this.debug.info('ExtensionsService.handleCreateRequest', `Create extension "${validData.name}"`);

                const newExtensionEntity = await this.core.homieMigrator.attachEntity(this.entityType, {
                    id    : entityId,
                    state : this.entityExtensionStates.uninstalled,
                    ...validData
                });

                this.attachExtensionEntity(newExtensionEntity);
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

    attachExtensionEntity(entity) {
        this.debug.info('ExtensionsService.attachExtensionEntity', `EntityId - ${entity.id}`);

        if (!(entity instanceof this.extensionClassType)) {
            throw new X({
                code   : WRONG_TYPE,
                fields : {}
            });
        }
        if (!entity._isValid) {
            this.debug.warning(
                'ExtensionsService.attachExtensionEntity', `Entity with id=${entity.id} is invalid`
            );

            return;
        }
        if (this.extensions[entity.id]) {
            this.debug.warning(
                'ExtensionsService.attachExtensionEntity', `Entity with id=${entity.id} is already attached`
            );

            return;
        }

        this.extensions[entity.id] = entity;

        entity.onAttributeSet(this.handleSetEvent);
    }

    installExtension(entity) {
        const { name, type } = entity;

        return this.extensionsManager.installExtension(name, type);
    }

    uninstallExtension(entity) {
        const { name, type } = entity;

        return this.extensionsManager.uninstallExtension(name, type);
    }

    updateExtension(entity) {
        const { name, type } = entity;

        return this.extensionsManager.updateExtension(name, type);
    }

    checkAvailableUpdate(entity) {
        const { name, type } = entity;

        return this.extensionsManager.hasAvailableUpdate(name, type);
    }

    async createExtensionIconSymlink(extensionName, extensionType) {
        const absoluteIconPath = await this.extensionsManager.getExtensionIconPath(extensionName, extensionType);

        // eslint-disable-next-line no-sync
        if (fs.existsSync(absoluteIconPath)) {
            const iconExt = path.extname(absoluteIconPath);
            const randomFilename = this.generateRandomID();
            const iconFilename = `${randomFilename}${iconExt}`;
            const symlinkPath = path.join(this.iconsDirPath, iconFilename);

            try {
                await fs.promises.symlink(absoluteIconPath, symlinkPath);

                return iconFilename;
            } catch (err) {
                this.debug.warning('ExtensionsService.createExtensionIconSymlink', err);
            }
        }
    }

    async syncExtensionEntity(entity) {
        this.debug.info('ExtensionsService.syncExtensionEntity', `Entity ID - ${entity.id}`);
        try {
            const extensionObj = await this.extensionsManager.getExtensionConfigObj(entity.name, entity.type);
            const validatedExtensionObj = this.validateExtensionConfigObj(extensionObj);

            const extensionEntityObj = {
                description : validatedExtensionObj.description,
                version     : validatedExtensionObj.version,
                scheme      : await this.extensionsManager.getExtensionScheme(validatedExtensionObj.name)
            };

            if (!entity.iconFilename) {
                extensionEntityObj.iconFilename = await this.createExtensionIconSymlink(
                    validatedExtensionObj.name, entity.type
                );
            }

            await entity.publish(extensionEntityObj, false);
        } catch (err) {
            this.debug.warning('ExtensionsService.syncExtensionEntity', err);
        }
    }

    async getExtensionEntityCurrentState(entity) {
        const isInstalled = await this.extensionsManager.isExtensionInstalled(entity.name, entity.type);

        return isInstalled ? this.entityExtensionStates.installed : this.entityExtensionStates.uninstalled;
    }

    /**
     * updating simple scenario status to "INACTIVE"
     * indicates scenario-runner service to stop
     * current scenario
     */
    async updateScenariosTimeByName(name) {
        await Scenarios.update({ type: name }, {
            where : {
                type : name
            }
        });
    }

    async deactivateScenariosByName(name) {
        await Scenarios.update({ status: 'INACTIVE' }, {
            where : {
                type : name
            }
        });
    }

    async handleSetEvent(data) {
        const { entity, field: attribute, value } = data;

        if (this.mutexes[entity.id]) {
            this.publishEntityError(
                new RACE_CONDITION(
                    `${entity.name} extension is processing now, please wait for the end of the operation`
                ),
                entity,
                attribute
            );

            return;
        }

        if (attribute === 'event') {
            // event callback executes immediate task first and then returns task that must be queued
            const eventCallbacks = {
                install : async () => {
                    await entity.publishAttribute('state', this.entityExtensionStates.installing);

                    return async () => {
                        try {
                            this.debug.info('ExtensionsService.handleSetEvent.install', `EntityID - ${entity.id}`);

                            await this.installExtension(entity);
                            await this.syncExtensionEntity(entity); // retrieve actual extension info after installation

                            if (entity.type === 'simple-scenario') await this.updateScenariosTimeByName(entity.name);

                            await entity.publishAttribute('state', this.entityExtensionStates.installed);
                        } catch (err) { // after failure installing must remove created entity
                            // publish error to handle it before removing the entity
                            this.publishEntityError(err, entity, attribute);

                            await this.core.homieMigrator.deleteEntity(entity);
                            delete this.extensions[entity.id];
                        }
                    };
                },
                uninstall : async () => {
                    await entity.publishAttribute('state', this.entityExtensionStates.uninstalling);

                    return async () => {
                        this.debug.info('ExtensionsService.handleSetEvent.uninstall', `EntityID - ${entity.id}`);
                        await this.uninstallExtension(entity);

                        if (entity.type === 'simple-scenario') await this.deactivateScenariosByName(entity.name);

                        if (entity.iconFilename) {
                            try {
                                const symlinkPath = path.join(this.iconsDirPath, entity.iconFilename);
                                await fs.promises.unlink(symlinkPath);
                            } catch (err) {
                                this.debug.warning('ExtensionsService.handleSetEvent.uninstall.unlink', err);
                            }
                        }

                        await this.core.homieMigrator.deleteEntity(entity);
                        delete this.extensions[entity.id];
                    };
                },
                update : async () => {
                    await entity.publishAttribute('state', this.entityExtensionStates.updating);

                    return async () => {
                        this.debug.info('ExtensionsService.handleSetEvent.update', `EntityID - ${entity.id}`);

                        await this.updateExtension(entity);
                        await this.syncExtensionEntity(entity); // retrieve actual extension info after updating

                        if (entity.type === 'simple-scenario') await this.updateScenariosTimeByName(entity.name);

                        await entity.publishAttribute('state', this.entityExtensionStates.installed);
                    };
                },
                check : async () => {
                    return async () => {
                        this.debug.info('ExtensionsService.handleSetEvent.check', `EntityID - ${entity.id}`);

                        const extensionHasAvailableUpdates = await this.checkAvailableUpdate(entity);

                        await entity.publishAttribute('state', extensionHasAvailableUpdates ?
                            this.entityExtensionStates['update-available'] :
                            this.entityExtensionStates['up-to-date']
                        );
                    };
                }
            };

            const entityTaskHandler = async (task) => {
                try {
                    return await task();
                } catch (err) {
                    const currentState = await this.getExtensionEntityCurrentState(entity);
                    await entity.publishAttribute('state', currentState);

                    this.publishEntityError(err, entity, attribute);
                }
            };

            const immediateTask = eventCallbacks[value];

            if (immediateTask) {
                await entity.publishAttribute(attribute, value);

                const queuedTask = await entityTaskHandler(immediateTask);

                // check operation is very fast and must not be blocked by install, uninstall or update operations
                if (value === 'check') {
                    process.nextTick(() => entityTaskHandler(queuedTask));

                    return;
                }

                // npm has issueses with concurrent execution of install, update and uninstall commands,
                // so this operations will be executed sequentially
                // see details here: https://docs.npmjs.com/common-errors#many-enoent--enotempty-errors-in-output
                this.addEventToQueue(this.doLockMutexAction.bind(this), entity.id, () => entityTaskHandler(queuedTask));
            }
        }
    }

    generateRandomID() {
        return nanoid();
    }

    validateExtensionConfigObj(obj) {
        const validator = new LIVR.Validator(this.extensionConfigValidationRules);

        const validData = validator.validate(obj);

        if (!validData) {
            throw new VALIDATION({
                fields  : validator.getErrors(),
                message : 'Validation errors'
            });
        }

        return validData;
    }

    prepareError(error) {
        if (!(error instanceof X)) {
            error = new X({
                code    : UNKNOWN_ERROR,
                fields  : {},
                message : 'Something went wrong'
            });
        }

        return error;
    }

    publishError(error, topic) {
        try {
            const preparedError = this.prepareError(error);
            const jsonErrorString = JSON.stringify(preparedError);

            this.debug.info('ExtensionsService.publishError', {
                code    : preparedError.code,
                fields  : preparedError.fields,
                message : preparedError.message
            });

            this.core.homie.publishToBroker(`${this.errorTopic}/${topic}`, jsonErrorString, { retain: false });
        } catch (err) {
            this.debug.warning('ExtensionsService.publishError', err);
        }
    }

    publishEntityError(error, entity, key) {
        if (!(error instanceof X)) {
            error = new UNKNOWN_ERROR();
        }

        this.debug.warning('ExtensionsService.publishEntityError', {
            error,
            entityId : entity.getId(),
            key
        });

        entity.publishError(key, error);
    }

    async handleHomieDelete({ type, entityId }) {
        if (type !== this.entityType) return;

        try {
            this.debug.info('ExtensionsService.handleHomieDelete', entityId);

            await this.doLockMutexAction(entityId, () => {
                if (!this.extensions[entityId]) return;

                delete this.extensions[entityId];
                this.debug.info('ExtensionsService.handleHomieDelete', `Homie entity (${entityId}) is deleted`);
            });
        } catch (err) {
            this.debug.warning('ExtensionsService.handleHomieDelete', err);
        }
    }
}

module.exports = ExtensionsService;
