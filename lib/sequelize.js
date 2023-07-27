const sequelize = require('./sequelizeSingleton.js');

const MqttUsers    = require('./models/MqttUsers');
const MqttAcl      = require('./models/MqttAcl');
const BridgesTypes = require('./models/BridgesTypes');
const Scenarios    = require('./models/Scenarios');

MqttUsers.initRelation();
MqttAcl.initRelation();
BridgesTypes.initRelation();
Scenarios.initRelation();

module.exports = {
    sequelize
};
