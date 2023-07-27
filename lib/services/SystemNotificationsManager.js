/* eslint-disable more/force-native-methods */
const {
    EXISTS,
    UNKNOWN_ERROR,
    RACE_CONDITION,
    VALIDATION
} = require('homie-sdk/lib/utils/errors');

const _                    = require('underscore');
const X                    = require('homie-sdk/lib/utils/X');
const { sysNotifications } = require('../../etc/config');
const Base                 = require('./Base');

const NotificationEntityType = 'NOTIFICATION';

class SystemNotificationsManager extends Base {
    constructor(props) {
        super(props);

        this.handleNotificationCreateEvent = this.handleNotificationCreateEvent.bind(this);
        this.handleNewEntity               = this.handleNewEntity.bind(this);
        this.checkNotifications            = this.checkNotifications.bind(this);
        this.addEventToQueue               = this.addEventToQueue();

        this.notifications      = {};
        this.mutexes            = {};
        this.rootTopic          = undefined;
        this.errorTopic         = undefined;
        this.NotificationEntity = null;
    }

    async init() {
        this.debug.info('SystemNotificationsManager.init');

        this.NotificationEntity = this.core.homie.entitiesStore.classes[NotificationEntityType];

        this.rootTopic = this.core.homie.getEntityRootTopicByType(NotificationEntityType);
        this.errorTopic = `${this.core.homie.errorTopic}/${this.rootTopic}`;

        this.debug.info('SystemNotificationsManager.init', 'get entities');

        const entities = this.core.homie.getEntities(NotificationEntityType);

        for (const id in entities) {
            await this.attachNewNotificationEntity(entities[id]);
        }

        this.debug.info('SystemNotificationsManager.init', 'handlers');

        this.core.homie.on(`homie.entity.${NotificationEntityType}.create`, this.handleNotificationCreateEvent);
        this.core.homie.on('new_entity', this.handleNewEntity);

        this.debug.info('SystemNotificationsManager.init', 'finish');

        await this.checkNotifications();
    }

    async checkNotifications() {
        if (this.checkNotificationsRunning) return;
        clearTimeout(this.checkNotificationsTimeout);
        this.checkNotificationsRunning = true;
        for (const id in this.notifications) {
            // this.debug.info('SystemNotificationsManager.checkNotifications', id);
            const notification = this.notifications[id];
            const { entity } = this.notifications[id];

            if (
                entity.isRead &&
                (new Date() - entity.createdAt) > sysNotifications.maxAgeReadNotificationSeconds * 1000
            ) {
                this.debug.info('SystemNotificationsManager.checkNotifications', `delete old notification ${id}`);
                await this.doLockMutexAction(entity.id, async () => {
                    notification.delete();
                });
            }
        }
        // eslint-disable-next-line max-len
        this.checkNotificationsTimeout = setTimeout(
            this.checkNotifications,
            sysNotifications.oldNotificationsCheckIntervalSeconds * 1000
        );
        this.checkNotificationsRunning = false;
    }

    async handleNotificationCreateEvent(options) {
        try {
            const {
                translated,
                entityId
            } = options;
            const { value } = translated;

            this.debug.info('SystemNotificationsManager.handleNotificationCreateEvent', translated);
            let entity = null;

            try {
                entity = this.core.homie.getEntityById(NotificationEntityType, entityId);
                // eslint-disable-next-line no-empty
            } catch (e) {}
            if (entity) {
                throw new EXISTS({
                    fields : {
                        'entityId' : [ 'EXISTS' ]
                    },
                    message : 'EntityId is already in use. Try again later.'
                });
            }

            this.debug.info('SystemNotificationsManager.handleNotificationCreateEvent 1');

            entity = await this.core.homieMigrator.attachEntity(NotificationEntityType, {
                isRead     : false,
                ...value,
                senderName : this.getSenderName(value),
                createdAt  : new Date() / 1,
                senderType : value.senderType !== 'device' ? 'backend' : 'device',
                id         : entityId
            });
            this.debug.info('SystemNotificationsManager.handleNotificationCreateEvent 2');

            await this.attachNewNotificationEntity(entity);
        } catch (err) {
            await this.publishError(err, `${options.entityId}/create`);
        }
    }

    getSenderName({ senderType, senderId, senderHash }) {
        if (senderType === 'device') {
            const { name, title } = this.core.homieServer.getDeviceById(senderId);

            return title || name;
        } if (senderType === 'scenario-runner') {
            if (senderHash === sysNotifications.hash) return 'Scenarios';
            throw new VALIDATION('Wrong senderHash');
        } if (senderType === 'backend') return 'System';
        throw new VALIDATION(`Unknown senderType(${senderType})`);
    }

    async handleNewEntity({ entityId, type }) {
        if (type !== NotificationEntityType) return;
        let entity = null;

        try {
            entity = this.core.homie.getEntityById(NotificationEntityType, entityId);
        } catch (e) {
            this.debug.warning('SystemNotificationsManager.handleNewEntity', e);

            return;
        }

        await this.attachNewNotificationEntity(entity);
    }

    async attachNewNotificationEntity(entity) {
        this.debug.info('SystemNotificationsManager.attachNewNotificationEntity', `EntityId - ${entity.id}`);

        if (!(entity instanceof this.NotificationEntity)) throw new Error('!(entity instanceof NotificationEntity)');
        if (!entity._isValid) {
            this.debug.warning('SystemNotificationsManager.attachNewNotificationEntity', `Entity with id=${entity.id} is invalid`);

            return;
        }
        if (this.notifications[entity.id] && this.notifications[entity.id].entity) {
            this.debug.warning('SystemNotificationsManager.attachNewNotificationEntity', `Entity with id=${entity.id} is already attached`);

            return;
        }

        const homie = this.core.homie;
        const handleDelete = async () => {
            try {
                if (this.mutexes[entity.id]) {
                    this.debug.warning('SystemNotificationsManager.attachNewNotificationEntity', 'Notification is processing now, wait for the end of operation');
                    throw new RACE_CONDITION('Notification is processing now, wait for the end of operation.');
                }
                await this.doLockMutexAction(entity.id, async () => {
                    if (!this.notifications[entity.id]) return;
                    await _delete();
                });
            } catch (err) {
                await this.publishError(err, `${entity.id}/delete`);
            }
        };
        const _delete = async () => {
            await this.core.homieMigrator.deleteEntity(entity);
            delete this.notifications[entity.id];

            homie.off(`homie.entity.${entity.getType()}.${entity.id}.delete`, handleDelete);
            homie.off(`homie.entity.${entity.getType()}.${entity.id}.update`, handleUpdate);
            homie.off(entity._getSetEventName(), handleSet);
        };
        const handleUpdate = async (translated) => {
            try {
                if (this.mutexes[entity.id]) throw new RACE_CONDITION('Notification is processing now, wait for the end of operation.');
                await this.doLockMutexAction(entity.id, async () => {
                    if (!this.notifications[entity.id]) throw new Error('Notification has been deleted.');
                    const { value } = translated;

                    if (value.isRead === undefined) throw new VALIDATION('Please specify isRead field.');

                    if (value.isRead) {
                        await entity.publishAttribute('isRead', value.isRead, true);
                    }
                });
            } catch (err) {
                await this.publishError(err, `${entity.id}/update`);
            }
        };
        // eslint-disable-next-line func-style
        const handleSet = async (translated) => {
            const key = _.keys(translated)[0];

            try {
                if (this.mutexes[entity.id]) throw new RACE_CONDITION('Notification is processing now, wait for the end of operation.');
                await this.doLockMutexAction(entity.id, async () => {
                    if (!this.notifications[entity.id]) throw new Error('Notification has been deleted.');
                    if (key === 'isRead') {
                        await entity.publishAttribute('isRead', translated.isRead, true);
                    } else {
                        throw new VALIDATION({
                            fields : {
                                [key] : [ 'NOT_ALLOWED' ]
                            },
                            message : `You cannot set the field ${key}`
                        });
                    }
                });
            } catch (err) {
                await this.publishEntityError(err, entity, key);
            }
        };
        const notification = this.notifications[entity.id] = this.notifications[entity.id] || {};

        notification.entity = entity;
        notification.delete = _delete;
        homie.on(`homie.entity.${entity.getType()}.${entity.id}.delete`, handleDelete);
        homie.on(`homie.entity.${entity.getType()}.${entity.id}.update`, handleUpdate);
        homie.on(entity._getSetEventName(), handleSet);

        this.debug.info('SystemNotificationsManager.attachNewNotificationEntity', `Finish - ${entity.id}`);

        this.addEventToQueue(this.deleteExtraNotifications.bind(this));
    }

    async deleteExtraNotifications() {
        await Promise.allSettled(
            Object
                .values(this.notifications)
                .sort((a, b) => b.entity.createdAt - a.entity.createdAt)
                .slice(sysNotifications.limit)
                .map(notification => {
                    const entityId = notification.entity.id;

                    return this.doLockMutexAction(entityId, async () => {
                        try {
                            await notification.delete();

                            this.debug.info(
                                'SystemNotificationsManager.deleteExtraNotifications',
                                `delete extra notification with id="${entityId}"`
                            );
                        } catch (err) {
                            this.debug.warning(
                                'SystemNotificationsManager.deleteExtraNotifications',
                                `error with deleting notification with id="${entityId}"`,
                                err
                            );
                        }
                    });
                })
        );
    }

    async publishError(error, topic) {
        try {
            if (!(error instanceof X)) {
                this.debug.error(error);
                // eslint-disable-next-line no-param-reassign
                error = new UNKNOWN_ERROR();
            }

            this.debug.warning('SystemNotificationsManager.publishError', {
                code    : error.code,
                fields  : error.fields,
                message : error.message
            });

            this.core.homie.publishToBroker(`${this.errorTopic}/${topic}`, JSON.stringify(error), { retain: false });
        } catch (e) {
            this.debug.warning('SystemNotificationsManager.publishError', e);
        }
    }

    async publishEntityError(error, entity, key) {
        try {
            if (!(error instanceof X)) {
                this.debug.error(error);
                // eslint-disable-next-line no-param-reassign
                error = new UNKNOWN_ERROR();
            }

            this.debug.warning('SystemNotificationsManager.publishEntityError', {
                code    : error.code,
                fields  : error.fields,
                message : error.message
            });

            await entity.publishError(key, error);
        } catch (e) {
            this.debug.warning('SystemNotificationsManager.publishEntityError', e);
        }
    }
}


module.exports = SystemNotificationsManager;
