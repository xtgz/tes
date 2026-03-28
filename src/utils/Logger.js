const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

class Logger {
    constructor(resultDir) {
        this.resultDir = resultDir;
        if (!fs.existsSync(this.resultDir)) {
            fs.mkdirSync(this.resultDir, { recursive: true });
        }
        this.successFile = path.join(this.resultDir, 'success.txt');
        this.failedFile = path.join(this.resultDir, 'failed.txt');
        this.isSticky = false;
        this.headerHeight = 0;

        // Reset scroll region on exit
        process.on('exit', () => {
            if (this.isSticky) {
                process.stdout.write('\x1B[r\x1B[?25h'); // Reset scroll region and show cursor
            }
        });
    }

    initStickyHeader(headerText) {
        if (!process.stdout.isTTY) {
            console.log(headerText);
            return;
        }

        this.isSticky = true;
        const lines = headerText.split('\n');
        this.headerHeight = lines.length + 1;

        process.stdout.write('\x1B[2J'); // Clear screen
        process.stdout.write('\x1B[H');  // Cursor top
        process.stdout.write(headerText + '\n');

        const totalRows = process.stdout.rows || 24;

        // Set scrolling region (top margin = headerHeight, bottom = totalRows)
        process.stdout.write(`\x1B[${this.headerHeight};${totalRows}r`);

        // Move cursor to the first line of the scroll region
        process.stdout.write(`\x1B[${this.headerHeight};1H`);
    }

    getTimestamp() {
        return new Date().toLocaleString();
    }

    info(message) {
        console.log(`${chalk.blue(`[${this.getTimestamp()}]`)} ${chalk.cyan('INFO:')} ${message}`);
    }

    success(message, data = null) {
        const logMsg = `[${this.getTimestamp()}] SUCCESS: ${message}${data ? ' | ' + JSON.stringify(data) : ''}`;
        console.log(chalk.green(logMsg));
        fs.appendFileSync(this.successFile, logMsg + '\n');
    }

    error(message, error = null) {
        const errorDetail = error ? (error.message || error) : '';
        const logMsg = `[${this.getTimestamp()}] FAILED: ${message}${errorDetail ? ' | Error: ' + errorDetail : ''}`;
        console.log(chalk.red(logMsg));
        fs.appendFileSync(this.failedFile, logMsg + '\n');
    }

    warn(message) {
        console.log(`${chalk.yellow(`[${this.getTimestamp()}]`)} ${chalk.yellow('WARN:')} ${message}`);
    }
}

module.exports = Logger;
