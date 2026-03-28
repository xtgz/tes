const fs = require('fs');
const path = require('path');

class ConfigLoader {
    constructor(rootPath) {
        this.rootPath = rootPath;
    }

    loadCredits() {
        const filePath = path.join(this.rootPath, 'credits.txt');
        if (!fs.existsSync(filePath)) {
            console.warn('credits.txt not found. Please create it.');
            return [];
        }

        const content = fs.readFileSync(filePath, 'utf8');
        return content.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => {
                const parts = line.split('|');
                if (parts.length >= 4) {
                    return {
                        number: parts[0],
                        expMonth: parts[1],
                        expYear: parts[2].slice(-2),
                        cvc: parts[3]
                    };
                }
                return null;
            })
            .filter(card => card !== null);
    }

    loadProxies() {
        const filePath = path.join(this.rootPath, 'proxy.txt');
        if (!fs.existsSync(filePath)) {
            return [];
        }

        const content = fs.readFileSync(filePath, 'utf8');
        return content.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.startsWith('#'));
    }
}

module.exports = ConfigLoader;
