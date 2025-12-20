function logger(scope) {
    this.scope = scope;
    const color = {
        'INFO': '\x1b[32m',    // Green
        'WARN': '\x1b[33m',    // Yellow
        'ERROR': '\x1b[31m',    // Red
        'DEBUG': '\x1b[34m'     // Blue
    };
    this.log = (m) => console.log(`${color['INFO']}[${new Date().toISOString()}] [${this.scope}] [INFO]: ${m}\x1b[0m`);
    this.warn = (m) => console.warn(`${color['WARN']}[${new Date().toISOString()}] [${this.scope}] [WARN]: ${m}\x1b[0m`);
    this.error = (m) => console.error(`${color['ERROR']}[${new Date().toISOString()}] [${this.scope}] [ERROR]: ${m}\x1b[0m`);
    this.debug = (m) => console.debug(`${color['DEBUG']}[${new Date().toISOString()}] [${this.scope}] [DEBUG]: ${m}\x1b[0m`);

}
export default logger;