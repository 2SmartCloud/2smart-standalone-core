/* eslint-disable more/no-c-like-loops */

const request = require('request-promise');
const cheerio = require('cheerio');

class SmartApi {
    constructor({ domain, basePath = '/releases/bridge_types/' }) {
        this.domain = domain;
        this.basePath = basePath;
    }
    async getBridgeTypesList() {
        const $ = cheerio.load(await request(`https://${this.domain}${this.basePath}`));
        const elements = $('a');
        const result = [];
        for (let i = 0; i < elements.length; i++) {
            const href = $(elements[i]).attr('href').slice(0, -1);

            if (href !== '..') result.push(href);
        }

        return result;
    }
    async getBridgeTypeConfig(type) {
        return request(`https://${this.domain}${this.basePath}${type}/2smart.configuration.json`, { json: true });
    }
    getBridgeTypeFile(type, file) {
        return request(`https://${this.domain}${this.basePath}${type}/${file}`);
    }
}

module.exports = SmartApi;
