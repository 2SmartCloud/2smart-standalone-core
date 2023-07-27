const Sequelize = require('sequelize');
const sequelize = require('../sequelizeSingleton');

class MqttAcl extends Sequelize.Model {}

MqttAcl.init({
    id        : { type: Sequelize.INTEGER(11), primaryKey: true, autoIncrement: true },
    allow     : { type: Sequelize.INTEGER(1), defaultValue: null, comment: '0: deny, 1: allow' },
    ipaddr    : { type: Sequelize.STRING(60), defaultValue: null },
    username  : { type: Sequelize.STRING(100), defaultValue: null },
    clientid  : { type: Sequelize.STRING(100), defaultValue: null },
    access    : { type: Sequelize.INTEGER(2), allowNull: false, comment: '1: subscribe, 2: publish, 3: pubsub' },
    topic     : { type: Sequelize.STRING(100), defaultValue: '', allowNull: false },
    createdAt : { type: Sequelize.DATE(3) },
    updatedAt : { type: Sequelize.DATE(3) }
}, {
    sequelize,
    tableName : 'mqtt_acl'
});

MqttAcl.initRelation = function initRelation() {
};

module.exports = MqttAcl;
