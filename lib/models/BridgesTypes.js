const Sequelize = require('sequelize');
const sequelize = require('../sequelizeSingleton');

class BridgeTypes extends Sequelize.Model {}

BridgeTypes.init({
    id            : { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
    title         : { type: Sequelize.STRING, allowNull: false },
    type          : { type: Sequelize.STRING, allowNull: false },
    configuration : { type: Sequelize.JSON, defaultValue: null },
    registry      : { type: Sequelize.STRING, defaultValue: '' },
    icon          : { type: Sequelize.STRING, defaultValue: '' },
    createdAt     : { type: Sequelize.DATE(3) },
    updatedAt     : { type: Sequelize.DATE(3) }
}, {
    sequelize,
    tableName : 'bridgetypes'
});

BridgeTypes.initRelation = function initRelation() {};

module.exports = BridgeTypes;
