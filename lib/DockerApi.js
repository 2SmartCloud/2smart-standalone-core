const request = require('request-promise');

class DockerApi {
    constructor({ GITLAB_SERVER, auth, REGISTRY_SERVER }) {
        this.GITLAB_SERVER = GITLAB_SERVER;
        this.auth = auth;
        this.REGISTRY_SERVER = REGISTRY_SERVER;
    }
    async getBearerToken({ scope }) {
        return request({
            uri  : `https://${this.GITLAB_SERVER}/jwt/auth`,
            auth : this.auth,
            qs   : { client_id: 'docker', service: 'container_registry', scope },
            json : true
        });
    }
    async getRepositoryDigest(data) {
        let repository, tag;

        if (typeof data === 'string') {
            data = data.split(`${this.REGISTRY_SERVER}/`).pop();
            data = data.split(':');
            repository = data[0];
            tag = data[1] || 'latest';
        } else {
            repository = data.repository;
            tag = data.tag;
        }
        const { token } = await this.getBearerToken({ scope: `repository:${repository}:pull` });
        const { config: { digest } }  = await request({
            uri     : `https://${this.REGISTRY_SERVER}/v2/${repository}/manifests/${tag}`,
            auth    : { bearer: token },
            headers : {
                'Accept' : 'application/vnd.docker.distribution.manifest.v2+json'
            },
            json : true
        });

        return digest;
    }
}

module.exports = DockerApi;
