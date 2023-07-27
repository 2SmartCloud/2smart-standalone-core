const Base = require('./Base');

class PublishManager extends Base {
    constructor(props) {
        super(props);

        this.handlePublishAttribute = this._handlePublishAttribute.bind(this);
    }

    async init() {
        this.debug.info('PublishManager.init');

        this.core.on('homie.publish.sensor', this.handlePublishAttribute);
        this.core.on('homie.publish.node_option', this.handlePublishAttribute);
        this.core.on('homie.publish.node_telemetry', this.handlePublishAttribute);

        this.debug.info('PublishManager.init', 'finish');
    }

    _handlePublishAttribute(data) {
        const { type, node, field } = data;

        switch (type) {
            case 'SENSOR':
            case 'NODE_OPTION':
            case 'NODE_TELEMETRY':
                if (field === 'value') {
                    node.publishSetting('lastActivity', Date.now()); // publish the time of last activity of current node
                }
                break;
            default:
                break;
        }
    }
}

module.exports = PublishManager;
