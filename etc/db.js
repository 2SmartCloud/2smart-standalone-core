module.exports = {
    development : {
        username : process.env.DB_USERNAME,
        password : process.env.DB_PASSWORD,
        database : process.env.DB_NAME,
        host     : process.env.DB_HOSTNAME,
        port     : process.env.DB_PORT,
        dialect  : 'mysql'
    },
    test : {
        username : process.env.DB_TEST_USERNAME,
        password : process.env.DB_TEST_PASSWORD,
        database : process.env.DB_TEST_NAME,
        host     : process.env.DB_HOSTNAME,
        port     : process.env.DB_PORT,
        dialect  : 'mysql'
    },
    production : {
        username : process.env.DB_USERNAME,
        password : process.env.DB_PASSWORD,
        database : process.env.DB_NAME,
        host     : process.env.DB_HOSTNAME,
        port     : process.env.DB_PORT,
        dialect  : 'mysql'
    }
};
