const Sequelize = require('sequelize');
const config    = require('../etc/db.js');

const { database, username, password, dialect, host, port } = config[process.env.MODE || 'development'];
const sequelize = new Sequelize(database, username, password, {
    host,
    port,
    dialect,
    logging        : false,
    dialectOptions : {
        'supportBigNumbers' : true,
        'bigNumberStrings'  : true
    }
});


module.exports = sequelize;
