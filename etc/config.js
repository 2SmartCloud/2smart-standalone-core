module.exports = {
    mqtt : {
        uri      : process.env.MQTT_URI  || 'mqtt://localhost:1883',
        username : process.env.MQTT_USER || '',
        password : process.env.MQTT_PASS || ''
    },
    extensions : {
        nameStartsWith           : '2smart-',
        keywords                 : [ 'simple-scenario' ],
        installPath              : process.env.EXTENSIONS_INSTALL_PATH,
        iconsDirName             : process.env.EXTENSIONS_ICONS_DIR_NAME,
        defaultSchemePath        : '/etc/scheme.json',
        defaultIconPath          : '/etc/icon.svg',
        checkUpdatesIntervalTime : 1000 * 60 * 60 * 24 // 24 hours
    },
    sysNotifications : {
        hash                                 : process.env.SYSTEM_NOTIFICATIONS_HASH,
        maxAgeReadNotificationSeconds        : process.env.MAX_AGE_READ_NOTIFICATIONS_SECONDS || 60 * 60 * 24 * 7,
        oldNotificationsCheckIntervalSeconds : process.env.OLD_NOTIFICATIONS_CHECKINTERVAL_SECONDS || 60 * 60 * 8,
        limit                                : process.env.SYSTEM_NOTIFICATIONS_LIMIT || 500
    }
};
