const EventEmitter = require('events');

class BaseService extends EventEmitter {
    // ! important: if you want to use mutexes in your inherited class,
    // then initialize this.mutexes = {} in its constructor
    constructor(props) {
        super();

        if (!props.core) throw new Error('Core is reqiured!');

        this.core  = props.core;
        this.debug = props.core.debug;
    }

    async init() {
        throw new Error('Abstract method BaseService.init');
    }

    async waitMutex(id) {
        if (this.mutexes[id]) {
            await new Promise(resolve => {
                this.once(`extension.mutex.unlocked.${id}`, resolve);
            });
        }
    }

    async lockMutex(id) {
        while (this.mutexes[id]) await this.waitMutex(id);
        this.mutexes[id] = { lockedAt: Date.now() };
        this.emit(`extension.mutex.locked.${id}`);
    }

    async unlockMutex(id) {
        if (this.mutexes[id]) delete this.mutexes[id];
        this.emit(`extension.mutex.unlocked.${id}`);
    }

    async doLockMutexAction(id, action) {
        try {
            await this.lockMutex(id);
            await action();
        } catch (err) {
            throw err;
        } finally {
            await this.unlockMutex(id);
        }
    }

    // you must create closure for this method in inherited classes
    // example:
    // this.addEventToQueue = this.addEventToQueue();
    addEventToQueue() {
        let pending = Promise.resolve();

        const run = async (event, ...args) => {
            try {
                await pending;
            } finally {
                return event(...args);
            }
        };

        return (event, ...args) => (pending = run(event, ...args));
    }
}

module.exports = BaseService;
