const Sequelize = require('sequelize');
const sequelize = require('../sequelizeSingleton');

class Scenarios extends Sequelize.Model {}

Scenarios.init({
    id        : { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
    name      : { type: Sequelize.STRING, allowNull: false, unique: true },
    title     : { type: Sequelize.STRING, allowNull: false },
    mode      : { type: Sequelize.ENUM('ADVANCED', 'SIMPLE'), defaultValue: 'ADVANCED' },
    status    : { type: Sequelize.ENUM('ACTIVE', 'INACTIVE'), defaultValue: 'INACTIVE' },
    script    : { type: Sequelize.TEXT, defaultValue: '' },
    params    : { type: Sequelize.JSON, defaultValue: null },
    language  : { type: Sequelize.ENUM('JS'), defaultValue: 'JS' },
    type      : { type: Sequelize.STRING, allowNull: true },
    createdAt : { type: Sequelize.DATE(3) },
    updatedAt : { type: Sequelize.DATE(3) }
}, { sequelize });

Scenarios.initRelation = function initRelation() {};

module.exports = Scenarios;
