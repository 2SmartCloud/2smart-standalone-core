const crypto = require('crypto');
const generator = require('generate-password');
const Base = require('./Base');
const { sequelize }   = require('./../sequelize');

const MqttUsers = sequelize.model('MqttUsers');
const MqttAcl = sequelize.model('MqttAcl');

class AclManager extends Base {
    constructor(props) {
        super(props);
    }

    async init() {}

    async register(username, password, { privilege = false, bridgeId } = {}) {
        this.debug.info('AclManager.register', `username=${username}`);

        if (!username) throw new Error('Please, specify the username.');

        if (!password) {
            // eslint-disable-next-line no-param-reassign
            password = generator.generate({
                length  : 15,
                numbers : true
            });
        }
        const hash = crypto.createHash('sha256').update(password).digest('hex');

        return sequelize.transaction(async (transaction) => {
            let mqttUser = await MqttUsers.findOne({
                where : {
                    username
                }
            }, { transaction });

            if (mqttUser) {
                await mqttUser.update({ password: hash }, { transaction });
            } else {
                mqttUser = await MqttUsers.create({
                    username,
                    password : hash
                }, { transaction });
            }

            await MqttAcl.destroy({ where: { username } }, { transaction });

            let mqttaclrecords;

            if (privilege) {
                mqttaclrecords = [
                    {
                        allow    : '1',
                        ipaddr   : null,
                        username,
                        clientid : null,
                        access   : 3,
                        topic    : '#'
                    }
                ];
            } else {
                mqttaclrecords = [
                    {
                        allow    : '1',
                        ipaddr   : null,
                        username,
                        clientid : null,
                        access   : 3,
                        topic    : `sweet-home/${username}/#`
                    },
                    {
                        allow    : '1',
                        ipaddr   : null,
                        username,
                        clientid : null,
                        access   : 3,
                        topic    : `errors/sweet-home/${username}/#`
                    },
                    {
                        allow    : '1',
                        ipaddr   : null,
                        username,
                        clientid : null,
                        access   : 3,
                        topic    : `request/+/${username}/#`
                    }
                ];

                if (bridgeId) {
                    mqttaclrecords.push({
                        allow    : '1',
                        ipaddr   : null,
                        username,
                        clientid : null,
                        access   : 3,
                        topic    : `bridges/${bridgeId}/#`
                    });
                }
            }

            await MqttAcl.bulkCreate(mqttaclrecords, { transaction });

            return password;
        });
    }
    async checkAndRegister(username, password) {
        if (!username) throw new Error('Please, specify the username.');

        this.debug.info('AclManager.checkAndRegister', `username=${username}`);

        const mqttUser = await MqttUsers.findOne({
            where : {
                username
            }
        });

        if (mqttUser && (!password || crypto.createHash('sha256').update(password).digest('hex') === mqttUser.password)) return password || null;

        return this.register(username, password);
    }
    async unregister(username) {
        this.debug.info('AclManager.unregister', `username=${username}`);

        return sequelize.transaction(async (transaction) => {
            const mqttUser = await MqttUsers.findOne({
                where : {
                    username
                }
            }, { transaction });

            if (!mqttUser) throw new Error(`Cannot find a user with username=${username}`);
            await MqttAcl.destroy({
                where : {
                    username
                }
            }, { transaction });
            await mqttUser.destroy({ transaction });
        });
    }
}

module.exports = AclManager;
