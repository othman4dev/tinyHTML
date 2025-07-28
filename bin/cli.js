#!/usr/bin/env node

const { Command } = require('commander');
const { TinyHTMLCompiler } = require('../dist/index');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const chalk = require('chalk');

const program = new Command();
let compiler = new TinyHTMLCompiler();

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('\n');
  log.info('Shutting down gracefully...');
  if (compiler) {
    compiler.dispose();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (compiler) {
    compiler.dispose();
  }
  process.exit(0);
});

// Styled console functions
const log = {
  success: (msg) => console.log(chalk.green('✅ ' + msg)),
  error: (msg) => console.log(chalk.red('❌ ' + msg)),
  warning: (msg) => console.log(chalk.yellow('⚠️  ' + msg)),
  info: (msg) => console.log(chalk.blue('ℹ️  ' + msg)),
  compile: (from, to) => console.log(chalk.cyan('📦 ') + chalk.white(from) + chalk.gray(' → ') + chalk.green(to)),
  watch: (msg) => console.log(chalk.magenta('👀 ' + msg)),
  title: (msg) => console.log(chalk.bold.blue('\n🚀 ' + msg + '\n')),
  dim: (msg) => console.log(chalk.dim(msg))
};

program
  .name('tinyhtml')
  .description(chalk.bold('TinyHTML') + ' - A lightweight transpiler for .tml files')
  .version('1.0.0');

program
  .name('tinyhtml')
  .description('TinyHTML to HTML transpiler')
  .version('1.0.0');

program
  .name('tinyhtml')
  .description(chalk.bold('TinyHTML') + ' - A lightweight transpiler for .tml files')
  .version('1.0.0');

// Default command (when no subcommand is provided)
program
  .argument('[input]', 'Input file or directory (defaults to project compilation)')
  .option('-o, --output <output>', 'Output file or directory')
  .option('-w, --watch', 'Watch for changes and recompile automatically')
  .option('-r, --recursive', 'Process directories recursively')
  .action(async (input, options) => {
    log.title('TinyHTML Compiler');
    
    // If no input specified, compile the whole project
    if (!input) {
      try {
        log.info('Compiling entire project...');
        log.dim('Source: tinyhtml-views/ → Output: views/');
        console.log();
        
        await compiler.compileProject('.');
        
        console.log();
        log.success('Project compilation complete!');
        log.dim('All .tml files have been compiled to HTML');
      } catch (error) {
        console.log();
        log.error('Project compilation failed: ' + error.message);
        log.dim('Make sure you have a tinyhtml-views/ directory with .tml files');
        log.info('To create a new project structure, run: ' + chalk.cyan('tinyhtml init'));
        process.exit(1);
      }
      return;
    }
    
    const inputPath = path.resolve(input);
    
    if (!fs.existsSync(inputPath)) {
      log.error(`Input path "${inputPath}" does not exist`);
      process.exit(1);
    }
    
    const isDirectory = fs.statSync(inputPath).isDirectory();
    
    const compileFiles = async () => {
      try {
        if (isDirectory) {
          const outputDir = options.output ? path.resolve(options.output) : undefined;
          log.info(`Compiling directory: ${chalk.cyan(inputPath)}`);
          
          await compiler.compileDirectory(inputPath, outputDir, { recursive: options.recursive });
          
          log.success('Directory compilation complete!');
        } else {
          const outputPath = options.output ? path.resolve(options.output) : undefined;
          const finalOutput = outputPath || inputPath.replace(/\.tml$/, '.html');
          
          await compiler.compileFile(inputPath, outputPath);
          log.compile(inputPath, finalOutput);
          log.success('File compiled successfully!');
        }
      } catch (error) {
        log.error('Compilation failed: ' + error.message);
        process.exit(1);
      }
    };
    
    await compileFiles();
    
    if (options.watch) {
      console.log();
      log.watch(`Watching for changes in ${chalk.cyan(inputPath)}...`);
      log.dim('Press Ctrl+C to stop watching');
      
      const pattern = isDirectory ? `${inputPath}/**/*.tml` : inputPath;
      
      chokidar.watch(pattern)
        .on('change', async (filePath) => {
          console.log();
          log.info(`File changed: ${chalk.cyan(path.relative(process.cwd(), filePath))}`);
          
          try {
            if (isDirectory) {
              const relativePath = path.relative(inputPath, filePath);
              const outputPath = options.output 
                ? path.join(options.output, relativePath.replace(/\.tml$/, '.html'))
                : filePath.replace(/\.tml$/, '.html');
              
              await compiler.compileFile(filePath, outputPath);
              log.compile(path.relative(process.cwd(), filePath), path.relative(process.cwd(), outputPath));
            } else {
              await compileFiles();
            }
            log.success('Recompiled successfully!');
          } catch (error) {
            log.error('Recompilation failed: ' + error.message);
          }
        })
        .on('error', (error) => {
          log.error('Watch error: ' + error.message);
        });
    }
  });

// Add explicit compile subcommand for backward compatibility
program
  .command('compile')
  .description('Compile TinyHTML files to HTML')
  .argument('[input]', 'Input file or directory')
  .option('-o, --output <output>', 'Output file or directory')
  .option('-w, --watch', 'Watch for changes and recompile')
  .option('-r, --recursive', 'Process directories recursively')
  .action(async (input, options) => {
    // Call the same logic as default command
    await program.commands[0].action(input, options);
  });

program
  .command('init')
  .description('Initialize a new TinyHTML project')
  .action(() => {
    log.title('TinyHTML Project Initialization');
    
    const packageJson = {
      name: 'my-tinyhtml-project',
      version: '1.0.0',
      description: 'A TinyHTML project',
      scripts: {
        build: 'tinyhtml',
        watch: 'tinyhtml --watch',
        dev: 'tinyhtml --watch'
      },
      devDependencies: {
        tinyhtml: '^1.0.0'
      }
    };
    
    const indexTml = `!DOCTYPE html
html[lang="en"]:
  head:
    meta[charset="UTF-8"]
    meta[name="viewport"][content="width=device-width, initial-scale=1.0"]
    title: "My TinyHTML Project"
    style: |
      body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
      .container { max-width: 800px; margin: 0 auto; }
      .highlight { background: #f0f8ff; padding: 10px; border-radius: 5px; }
  body:
    div.container:
      h1: "Hello, TinyHTML! 🚀"
      div.highlight:
        p: "Welcome to your new TinyHTML project!"
        p: "Edit files in the tinyhtml-views/ folder and run 'npm run build' to compile."
      footer:
        p: "Created with TinyHTML by othman4dev"
`;

    const aboutTml = `!DOCTYPE html
html[lang="en"]:
  head:
    meta[charset="UTF-8"]
    title: "About - TinyHTML Project"
    style: |
      body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
      .container { max-width: 800px; margin: 0 auto; }
  body:
    div.container:
      h1: "About 📖"
      p: "This is the about page of your TinyHTML project."
      p: "TinyHTML makes writing HTML faster and more enjoyable!"
      a[href="index.html"]: "← Back to Home"
`;
    
    let created = [];
    
    if (!fs.existsSync('package.json')) {
      fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));
      created.push('package.json');
    }
    
    if (!fs.existsSync('tinyhtml-views')) {
      fs.mkdirSync('tinyhtml-views');
      created.push('tinyhtml-views/ directory');
    }
    
    if (!fs.existsSync('views')) {
      fs.mkdirSync('views');
      created.push('views/ directory');
    }
    
    if (!fs.existsSync('tinyhtml-views/index.tml')) {
      fs.writeFileSync('tinyhtml-views/index.tml', indexTml);
      created.push('tinyhtml-views/index.tml');
    }
    
    if (!fs.existsSync('tinyhtml-views/about.tml')) {
      fs.writeFileSync('tinyhtml-views/about.tml', aboutTml);
      created.push('tinyhtml-views/about.tml');
    }
    
    console.log();
    created.forEach(item => {
      log.success(`Created ${chalk.cyan(item)}`);
    });
    
    console.log();
    log.success('Project initialized successfully!');
    log.dim('Your TinyHTML project is ready to use!');
    
    console.log();
    log.info('Next steps:');
    log.dim('1. Edit your TinyHTML files in the ' + chalk.cyan('tinyhtml-views/') + ' folder');
    log.dim('2. Run ' + chalk.cyan('npm run build') + ' to compile to HTML');
    log.dim('3. Run ' + chalk.cyan('npm run watch') + ' for automatic compilation');
    log.dim('4. Open files in the ' + chalk.cyan('views/') + ' folder to see the results');
  });

// Add cache management commands
program
  .command('cache')
  .description('Manage compilation cache')
  .option('--clear', 'Clear the compilation cache')
  .option('--stats', 'Show cache statistics')
  .action((options) => {
    log.title('TinyHTML Cache Manager');
    
    if (options.clear) {
      compiler.clearCache();
      log.success('Cache cleared successfully!');
    }
    
    if (options.stats || (!options.clear)) {
      const stats = compiler.getCacheStats();
      console.log();
      log.info(`Cache entries: ${chalk.cyan(stats.size)}`);
      log.info(`Memory usage: ${chalk.cyan(stats.memoryUsage)}`);
      console.log();
      
      if (stats.size === 0) {
        log.dim('Cache is empty. Compile some files to see cached entries.');
      }
    }
  });

program.parse();
