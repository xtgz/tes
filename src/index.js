const path = require('path');
const ConfigLoader = require('./utils/ConfigLoader');
const Logger = require('./utils/Logger');
const BlinkAutoBot = require('./BlinkAutoBot');
const ProxyService = require('./services/ProxyService');
const inquirer = require('inquirer');
const figlet = require('figlet');
const gradient = require('gradient-string');
const chalk = require('chalk');

/**
 * Display the tool header with ASCII art and branding
 */
function getHeader() {
    const banner = figlet.textSync(' CUPANG  VENTURES', { font: 'Slant' });
    const headerLines = [
        gradient.pastel.multiline(banner),
        chalk.cyan(' ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'),
        chalk.bold.white(' 🚀 Tool: ') + chalk.yellow('Auto Generated Blink Account'),
        chalk.bold.white(' 👤 Created by: ') + chalk.blue('@bagusmaulana1337'),
        chalk.bold.white(' 📌 Features: ') + chalk.green('Auto Register + Auto Payment + Auto Get API Key'),
        chalk.cyan(' ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    ];
    return headerLines.join('\n');
}

/**
 * Show interactive menu for selecting mode
 * @returns {Promise<string>} Selected mode
 */
async function showMenu() {
    const questions = [
        {
            type: 'list',
            name: 'mode',
            message: chalk.bold.magenta('Select operation mode:'),
            choices: [
                { name: ` ${chalk.green('▶')} Register New Accounts`, value: 'register' },
                new inquirer.Separator(),
                { name: ` ${chalk.red('✖')} Exit`, value: 'exit' }
            ]
        }
    ];

    const answers = await inquirer.prompt(questions);
    return answers.mode;
}

async function main() {
    const rootPath = path.join(__dirname, '..');
    const configLoader = new ConfigLoader(rootPath);
    const resultDir = path.join(rootPath, 'result');
    const logger = new Logger(resultDir);

    // Initial clear and print header for menu
    process.stdout.write('\x1Bc');
    console.log(getHeader());
    console.log('');

    // If --register was passed via CLI, skip menu
    let mode;
    if (process.argv.includes('--register')) {
        mode = 'register';
    } else {
        mode = await showMenu();
    }

    if (mode === 'exit') {
        console.log(chalk.yellow('\n Goodbye! 👋\n'));
        process.exit(0);
    }

    // Initialize the fixed header and scrolling region for operational logs
    logger.initStickyHeader(getHeader());

    logger.info(`Starting ${mode} mode...`);
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const credits = configLoader.loadCredits();
    if (credits.length === 0) {
        logger.error('No valid cards found in credits.txt. Exiting.');
        process.exit(1);
    }

    const proxyList = configLoader.loadProxies();
    const proxyService = proxyList.length > 0 ? new ProxyService(proxyList, logger) : null;

    logger.info(`Loaded ${credits.length} cards and ${proxyList.length} proxies.`);

    const bot = new BlinkAutoBot({
        credits,
        proxyService,
        mode
    }, logger);

    try {
        await bot.run();
        logger.info('Bot execution finished.');
    } catch (error) {
        logger.error('Bot crashed during execution', error);
    }
}

main();
